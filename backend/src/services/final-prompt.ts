/**
 * 最终提示词服务
 * 生图前确保角色/场景/道具已有「最终提示词」（红果图面格式）：
 * - 角色 → 正视图立绘（默认，单张全身正面）；勾选四视图 → 四视图人设图（竖版 9:16 不等大 2x2：正脸/侧脸/正面无脸/背面）；勾选脸部放大三视图 → 脸部放大三视图
 * - 场景 → 地点板（广角空镜、地理优先、无人物）
 * - 道具 → 三视图道具板（正面/侧面/背面）；勾选四视图 → 四视图设计板（横版 16:9，SIDE/FRONT/TOP/3-4 VIEW）；勾选正视图 → 正视图单品
 * 声音（voice_description）仍由 asset Agent 按剧本为每个角色生成，不在本服务处理。
 * 「人物特征」（traits）随最终提示词一并生成：由 asset Agent 调用 read_drama_plot 读取整部剧剧情推导，五段式「年龄/外形；性格；行为；音色；语言风格」。
 * 缺失时运行 asset Agent 创作并保存；失败返回 ''，由调用方回退到本地拼接提示词
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { mastra } from '../mastra/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { logTaskError, logTaskProgress } from '../utils/task-logger.js'
import { now } from '../utils/response.js'

type CharacterRow = typeof schema.characters.$inferSelect
type SceneRow = typeof schema.scenes.$inferSelect
type PropRow = typeof schema.props.$inferSelect

/** 顶栏选择的文本模型/配置覆盖（不传则跟随 Agent 与文本配置默认） */
export interface PromptAgentOptions { model?: string; configId?: number }

async function runPromptAgent(episodeId: number, dramaId: number, message: string, opts?: PromptAgentOptions) {
  const agent = mastra.getAgent('asset')
  if (!agent) throw new Error('资产锁定 Agent 不可用')
  const requestContext = buildAgentRequestContext({
    episodeId,
    dramaId,
    modelOverride: opts?.model || undefined,
    textConfigId: opts?.configId || undefined,
  })
  await agent.generate([{ role: 'user', content: message }], { maxSteps: 12, requestContext })
}

/** 确保角色拥有最终提示词：默认 → 正视图立绘；勾选四视图 → 四视图人设图；勾选脸部放大三视图 → 脸部放大三视图。返回最终提示词（失败返回 ''）；force 时忽略已有提示词强制重新生成 */
export async function ensureCharacterFinalPrompt(char: CharacterRow, episodeId: number, force = false, opts?: PromptAgentOptions, sheetMode = '', userNote = ''): Promise<string> {
  // 视图模式（正视图/四视图/脸部三视图）只有与 DB 已存的 sheet_mode 一致时才复用缓存提示词；
  // 在弹窗里切换模式后不点「保存」直接生图/生提示词，旧缓存（如正视图）必须作废重新生成。
  const requestedMode = sheetMode || 'front-view'
  const storedMode = char.sheetMode || 'front-view'
  if (char.finalPrompt && !force && requestedMode === storedMode) return char.finalPrompt
  try {
    // 先把请求的视图模式落库：save_character_final_prompt 按 char.sheet_mode 确定性拼装，
    // 确保 final_prompt 与 sheet_mode 始终一致，避免拿旧模式拼出错误板式。
    if (requestedMode !== storedMode) {
      await db.update(schema.characters).set({ sheetMode: requestedMode, updatedAt: now() }).where(eq(schema.characters.id, char.id))
    }
    logTaskProgress('FinalPrompt', 'character-generate', { characterId: char.id, episodeId })
    const sheet = sheetMode === 'face-three-view'
      ? '脸部放大三视图（横版 16:9，左 1/3 面部特写 + 右 2/3 三视图 Front/Profile/Back，纯白色背景）'
      : sheetMode === 'four-view'
        ? '四视图人设图'
        : '正视图立绘（竖版 9:16，单张全身正面，不做四视图）'
    const autoAssembled = sheetMode !== 'face-three-view'
    const userNoteBlock = userNote?.trim()
      ? `\n\n用户对角色「${char.name}」的形象/妆容/着装提出了以下补充想法，请优先遵从并融入（在剧本不冲突的前提下）：\n\n${userNote.trim()}\n\n${autoAssembled ? '请先调用 read_characters 读取该角色当前的 appearance（样貌）与 styling（妆造），结合上面的用户想法与剧本，产出更新后的 appearance 与 styling，并在调用 save_character_final_prompt 时通过 appearance、styling 参数一并写回（正视图/四视图的工具自动拼装会用到你的更新结果）。' : '请把上面的用户想法直接融合进你手写的提示词正文。'}`
      : ''
    await runPromptAgent(episodeId, char.dramaId,
      `为角色「${char.name}」(character_id=${char.id}) 处理参考图最终提示词并调用 save_character_final_prompt 保存。${autoAssembled ? `${sheet}的提示词正文由工具自动拼装（3D CG 风格内嵌），你无需手写正文，prompt 参数传一句简短说明即可。` : '请生成提示词正文，用 prompt 参数传入。'}${userNoteBlock}\n\n同时为这个角色生成「人物特征」：先调用 read_drama_plot 读取整部剧全部剧情原文，据此把握该角色的整体人设与剧情弧光，生成人物特征文本，格式为「【名字：年龄/外形；性格气质；行为表现；音色；语言风格】」五段、全角分号「；」分隔、整段包在【】内（年龄写如「18-20岁左右」；非人类/系统音首段写外形，如「外形6-8岁小女孩感」）。把这段人物特征通过 save_character_final_prompt 的 traits 参数一并保存（与最终提示词同一次调用）。`, opts)
    const [fresh] = await db.select().from(schema.characters).where(eq(schema.characters.id, char.id))
    return fresh?.finalPrompt || ''
  } catch (err: any) {
    logTaskError('FinalPrompt', 'character-generate', { characterId: char.id, error: err.message })
    return ''
  }
}

/** 确保场景拥有地点板（广角空镜、地理优先）最终提示词，返回最终提示词（失败返回 ''）；force 时忽略已有提示词强制重新生成 */
export async function ensureSceneFinalPrompt(scene: SceneRow, episodeId: number, force = false, opts?: PromptAgentOptions): Promise<string> {
  if (scene.finalPrompt && !force) return scene.finalPrompt
  try {
    logTaskProgress('FinalPrompt', 'scene-generate', { sceneId: scene.id, episodeId })
    await runPromptAgent(episodeId, scene.dramaId,
      `为场景「${scene.location}」(scene_id=${scene.id}) 生成地点板（广角空镜、地理优先）最终提示词，并调用 save_scene_final_prompt 保存。注意：这是无人物空镜——场景图中不能出现任何的人（含背影、剪影、倒影、照片里的人），即使场景描述提到人物活动也必须剔除，只保留场景本身。`, opts)
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id))
    return fresh?.finalPrompt || ''
  } catch (err: any) {
    logTaskError('FinalPrompt', 'scene-generate', { sceneId: scene.id, error: err.message })
    return ''
  }
}

/** 确保道具拥有三视图道具板 / 四视图设计板 / 正视图单品 最终提示词，返回最终提示词（失败返回 ''）；force 时忽略已有提示词强制重新生成 */
export async function ensurePropFinalPrompt(prop: PropRow, episodeId: number, force = false, opts?: PromptAgentOptions, sheetMode = ''): Promise<string> {
  // 道具视图模式（four-view / front-view / ''=三视图道具板）只有与 DB 已存 sheet_mode 一致时才复用缓存
  const requestedMode = sheetMode || ''
  const storedMode = prop.sheetMode || ''
  if (prop.finalPrompt && !force && requestedMode === storedMode) return prop.finalPrompt
  try {
    if (requestedMode !== storedMode) {
      await db.update(schema.props).set({ sheetMode: requestedMode || null, updatedAt: now() }).where(eq(schema.props.id, prop.id))
    }
    logTaskProgress('FinalPrompt', 'prop-generate', { propId: prop.id, episodeId })
    const sheet = sheetMode === 'four-view'
      ? '四视图设计板（横版 16:9，2x2 均等：SIDE/FRONT/TOP/3-4 VIEW）'
      : sheetMode === 'front-view'
        ? '正视图单品（单一正视图）'
        : '三视图道具板（正面/侧面/背面）'
    await runPromptAgent(episodeId, prop.dramaId,
      `为道具「${prop.name}」(prop_id=${prop.id}) 生成${sheet}最终提示词，并调用 save_prop_final_prompt 保存。`, opts)
    const [fresh] = await db.select().from(schema.props).where(eq(schema.props.id, prop.id))
    return fresh?.finalPrompt || ''
  } catch (err: any) {
    logTaskError('FinalPrompt', 'prop-generate', { propId: prop.id, error: err.message })
    return ''
  }
}
