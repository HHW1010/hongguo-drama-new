/**
 * Mastra Agent 注册表
 * 启动时注册静态 Agent；instructions/model 用 DynamicArgument 按请求解析
 * （workspace/prompts/<agent_type>.md 文件 + RequestContext 中的 model/config_id 覆盖），
 * episodeId/dramaId 由工具从 RequestContext 读取
 *
 * manju-laoli 换脑后的三 Agent 拓扑：
 *   asset（资产锁定）→ storyboard（分镜）→ feed（七段式投喂）
 * AI 改写（script_rewriter）已整体移除；原始文本由 asset Agent 直接消费。
 */
import { Agent } from '@mastra/core/agent'
import type { RequestContext } from '@mastra/core/request-context'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { getTextConfig, getTextProviderBaseUrl, getConfigById } from '../services/ai.js'
import { logTaskProgress } from '../utils/task-logger.js'
import { assetTools } from './tools/asset-tools.js'
import { storyboardTools } from './tools/storyboard-tools.js'
import { feedTools } from './tools/feed-tools.js'
import { loadAgentSkills, skillWorkspaces } from './skills.js'
import { loadAgentPromptFile, loadBasePromptFile } from './prompts.js'
import { buildLanguageDirective } from './language.js'
import { getContentLanguageFromRC } from './context.js'

// Default prompts (used when workspace/prompts/<type>.md 文件缺失时兜底)
export const DEFAULT_PROMPTS: Record<string, { name: string; instructions: string }> = {
  asset: {
    name: '资产锁定',
    instructions: `你是资产锁定阶段的专精引擎（manju-laoli sd-asset-engine），负责把原始文本翻译成「可出图的资产提示词 + 编号 + 《素材接线单》」。

工作流程：
1. 调用 read_script_for_extraction 读取本集原始文本（小说/故事原文，非格式化剧本）
2. 调用 read_existing_characters / read_existing_scenes / read_existing_props 读取项目已有资产（用于去重 + 图号接续）
3. 按 manju-laoli「三清单」法提取：
   - 角色外观：年龄/性别/肤色/发型发色/五官特征/服装（整段文字，性格转译为外在气质融入样貌），并配 voice_description（音色/声纹描述）
   - 独立道具：只提取直接推动剧情且值得单独出图的关键道具（0-3 个，宁少勿多），description 只写物品物理外貌
   - 独立场景：正面全景微俯视大白话 + 空间要素分析，prompt（空间陈设）+ lighting（光影）
4. 用 save_dedup_characters / save_dedup_scenes / save_dedup_props 保存（同名/近名去重合并，关联当前集），并为每个资产分配 asset_code（图N，接续项目最大编号）与 material_form（素材形态，默认 M1）
5. 调用 read_characters / read_scenes / read_props 读取资产信息，按对应模板产出最终提示词，逐个调用 save_character_final_prompt / save_scene_final_prompt / save_prop_final_prompt 保存（风格词由工具自动注入，不要手写风格词）。角色同时生成「人物特征」（traits）：先调用 read_drama_plot 读取整部剧全部剧情原文，据此推导该角色整体人设与弧光，按「【名字：年龄/外形；性格气质；行为表现；音色；语言风格】」五段式（全角分号「；」分隔、整段包在【】内）生成，并在同一次 save_character_final_prompt 调用里用 traits 参数保存（非人类/系统音首段写外形，如「外形6-8岁小女孩感」）。
6. 末尾调用 save_asset_ledger 保存《素材接线单》（kind=wiring_sheet，图号→类型→用途只控制什么→你该挂哪张→不控制什么），可选再保存《资产编号册》（kind=asset_roster）

素材形态四铁律：不索要图片 · 不因缺图阻断 · 不写不存在的图号/不假称已核验 · 每次声明形态（默认 M1；用户说「没有图/只要提示词」降 M0，此时不得出现图号）。
图面纪律（角色）：正视图立绘 = 竖版 9:16 单格全身正面（与四视图同套规范：纯白色背景、无灯光），提示词正文由工具自动拼装——这是默认，所有角色都走这条；sheet_mode=four-view → 四视图人设图（竖版 9:16 2x2 不等大：左上正脸特写 / 右上侧脸特写 / 左下脖子以下正面无脸 / 右下背面含后脑勺，正文由工具自动拼装）；sheet_mode=face-three-view → 脸部放大三视图（横版 16:9，左 1/3 面部特写 + 右 2/3 三视图 Front/Profile/Back，纯白色背景、画面内无任何文字）。
图面纪律（场景）：地点板（广角空镜、地理优先、无人物）——完整交代入口/路线/固定锚点及其相对关系，画面中不能出现任何的人。
图面纪律（道具）：三视图道具板（正面/侧面/背面横向等距、底部对齐）；sheet_mode=four-view → 四视图设计板（横版 16:9，SIDE/FRONT/TOP/3-4 VIEW）；sheet_mode=front-view → 正视图单品；禁人物/手/肢体入画。`,
  },
  storyboard: {
    name: '分镜',
    instructions: `你是文戏/日常戏分镜专精引擎（manju-laoli sd-storyboard-engine 短剧视感版），把原始文本转化为极简文字分镜脚本。

核心定义：一个分镜 = 一个「分镜段落」= 一个视频生成任务。每个段落 8-15 秒，内部承载 2-4 个子镜头；子镜头之间可切镜，但不跨场景。

工作流程：
1. 调用 read_storyboard_context 读取原始文本、角色、场景、道具列表
2. 内部分析（不输出）：场景空间类型、情绪节奏曲线、人物数量与空间关系、权力关系/情绪爆点、激进机位机会点、机位配比（侧45度默认，常规平视正面压缩到三成左右）
3. 识别叙事节拍后拆为 1 到多个分镜段落，逐段补全生产字段（description 画面描述 + dialogue 台词 + atmosphere 氛围）
4. 分批调用 save_storyboards 保存：第一批必须带 replace_existing: true，后续批次省略，每批最多 8 段，shot_number 顺序递增；全部保存完才可结束

硬约束：
- 台词零擅删：原文每句台词默认原样进 dialogue；确需精简须在末尾「台词精简建议清单」征询用户，未经确认一句不许删
- 每句台词必挂「具体神态 + 具体动作」两项；含台词镜行同时写神态（面部/眼神/呼吸）与动作（手部/重心/走向）
- 表演克制藏七分露三分；站桩说话不超 3 秒；长台词必须切镜；禁 BGM
- 镜头服务叙事，不为炫技；每个镜头必须有存在理由，能删则删、能并则并
- 不输出规划/分析/解释性文本，输出只允许工具调用
- 优先复用 read_storyboard_context 返回的 scene_id / character_ids / prop_ids，不要凭空创造新场景

每个段落字段：
- shot_number：分镜号顺序递增
- scene_id：匹配已有场景必填，无匹配置空
- character_ids / prop_ids：从列表选择，可为空
- duration：8-15 秒
- description：按【镜头1】【镜头2】…逐子镜头描述画面（谁+具体动作+肢体细节+表情）+ 台词（「角色名说：「台词」」）+ 旁白（「旁白：内容」）
- dialogue：本段台词全文（供七段式投喂与导出使用）
- atmosphere：氛围、光线、色调`,
  },
  feed: {
    name: '七段式投喂',
    instructions: `你是投喂适配引擎（manju-laoli sd-feed-engine 交付层），把分镜稿封装为可投喂视频模型的「七段式」提示词。

七段式格式（唯一命名，字段顺序固定）：
【画幅风格】→【场景资产】→【核心人物】→【站位声明】→【时间轴分镜】→【音效】→【强制禁止项】

工作流程：
1. 调用 read_feed_context 读取本集分镜（description/dialogue/atmosphere/duration/绑定）、资产（图号 asset_code + 素材形态 material_form + 音色 voice_description）、以及《素材接线单》
2. 为每个分镜生成 video_prompt，七段写法见下
3. 调用 save_video_prompt 保存（参数只传 storyboard_id 和 video_prompt 两个键，不要回传该分镜其他字段）

各段要点：
- 【画幅风格】：画幅 + 风格/光影/色调/质感一句话（句尾可写 model=）
- 【场景资产】：@SCN-场景名（参考图N）+ 关键道具 @PRP-道具名（参考图M）+ 时段光影（主光方向·光质·光色冷暖·天空/时段·暗部补色）；有图时只 @ 资产与图号，禁二次介绍外观；无图（M0）才写文字外观复述
- 【核心人物】：@CHR-角色名（参考图K，声线锁：音色与语速描述）；有图时只 @ 角色与图号 + 声线锁，禁二次介绍年龄/五官/服装
- 【站位声明】：一行式四要素（位置+依托物+朝向+姿态）+ 轴线行 + 位移行
- 【时间轴分镜】：\`00:00-00:05 [镜头N] 景别 · 视角角度 · 运镜。动作。声音：…。台词：…。\`；每镜行尾必带声音与台词；有台词的镜行台词字段必带语气位 \`台词：【角色（语气）："…"】\`；图号引用与接线单双向一致
- 【音效】：环境音列举（默认模型生成）
- 【强制禁止项】：默认只写「画面：禁字幕、禁水印（含 Logo）；音频：禁背景音乐、禁旁白」，禁再加长清单

铁律：素材形态 M0 时稿件内不得出现任何图号；M1 时每个图号必须在接线单有对应行；不索要图片、不因缺图阻断、不假称已核验。`,
  },
}

export const validAgentTypes = Object.keys(DEFAULT_PROMPTS)

// Agent 每一步都会重新解析模型，相同端点只打一次日志避免刷屏
let lastLoggedTextEndpointKey = ''

/**
 * 关闭思考(thinking)模式
 *
 * 背景：new-api 类中转站对 thinking 模型强制要求多轮请求回传 reasoning_content,
 * 而 Agent 多轮工具调用无法回传,会被中转站 400 拒绝
 * ("The `reasoning_content` in the thinking mode must be passed back to the API")。
 * 这里在请求体注入各厂商风格的关思考参数,让模型不产出 reasoning_content。
 *
 * - 默认开启;AI_DISABLE_THINKING=false 可关闭注入
 * - 官方 OpenAI / Gemini 端点跳过(官方 API 会拒绝未知参数)
 * - AI_THINKING_OFF_PATCH 可传 JSON 覆盖注入的 OpenAI 风格参数(适配不同中转站)
 */
const thinkingOffEnabled = (process.env.AI_DISABLE_THINKING ?? 'true').toLowerCase() !== 'false'

function isOfficialTextHost(baseURL: string) {
  return /api\.openai\.com|generativelanguage\.googleapis\.com/.test(baseURL)
}

function openaiThinkingOffPatch(): Record<string, any> {
  const fallback = {
    thinking: { type: 'disabled' },   // new-api 通用 / DeepSeek
    enable_thinking: false,           // Qwen / 阿里系
    reasoning_effort: 'none',         // OpenAI 风格枚举(Gemini 渠道映射为 budget 0)
  }
  const raw = process.env.AI_THINKING_OFF_PATCH
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

function createThinkingOffFetch(providerName: string, baseURL: string): typeof fetch | undefined {
  if (!thinkingOffEnabled || isOfficialTextHost(baseURL)) return undefined
  const openaiPatch = openaiThinkingOffPatch()

  return async (input: any, init?: any) => {
    try {
      if (init?.body && typeof init.body === 'string') {
        const body = JSON.parse(init.body)
        if (providerName === 'gemini' && Array.isArray(body?.contents)) {
          // Gemini 原生格式。Gemini 3 系列思考参数改名 thinkingLevel(low/high)，
          // 旧参数 thinkingBudget 会被 400 拒绝("requires thinkingLevel, not thinkingBudget")；
          // 2.x 及更早仍用 thinkingBudget: 0。模型名从 URL(/models/<model>:)或 body 嗅探
          const url = String(typeof input === 'string' ? input : input?.url || '')
          const isGemini3 = /gemini-3/i.test(url) || /gemini-3/i.test(String(body?.model || ''))
          body.generationConfig = {
            ...(body.generationConfig || {}),
            thinkingConfig: isGemini3
              ? { thinkingLevel: 'low' }
              : { thinkingBudget: 0, includeThoughts: false },
          }
          init = { ...init, body: JSON.stringify(body) }
        } else if (Array.isArray(body?.messages)) {
          // OpenAI 兼容格式
          Object.assign(body, openaiPatch)
          init = { ...init, body: JSON.stringify(body) }
        }
      }
    } catch { /* 解析失败则原样透传 */ }
    return fetch(input, init)
  }
}

/**
 * 在请求体中写入配置的温度
 *
 * 背景：部分模型服务端强制固定温度（如 kimi-k2 系只允许 0.6，
 * 报 "invalid temperature: only 0.6 is allowed for this model"），
 * 需要在文本服务配置里显式指定并随每个请求下发。
 * inner 传 thinking-off fetch 时可链式叠加两个补丁。
 */
function createTemperatureFetch(providerName: string, temperature: number, inner?: typeof fetch): typeof fetch {
  const base = inner || fetch
  return async (input: any, init?: any) => {
    try {
      if (init?.body && typeof init.body === 'string') {
        const body = JSON.parse(init.body)
        if (providerName === 'gemini' && Array.isArray(body?.contents)) {
          // Gemini 原生格式
          body.generationConfig = { ...(body.generationConfig || {}), temperature }
          init = { ...init, body: JSON.stringify(body) }
        } else if (Array.isArray(body?.messages)) {
          // OpenAI 兼容格式
          body.temperature = temperature
          init = { ...init, body: JSON.stringify(body) }
        }
      }
    } catch { /* 解析失败则原样透传 */ }
    return base(input, init)
  }
}

/**
 * 在请求体中注入输出上限
 *
 * 背景：Agent 输出可能包含大段规划文本 + 工具调用（尤其分批保存时），
 * 而服务商默认 max_tokens 很小（如 DeepSeek 默认 4096/8192），
 * 模型写作到一半被截断、工具调用从未生成，表现为「Agent 正常结束但什么都没保存」。
 * 这里显式抬高输出上限，给足模型完整生成工具调用的空间。
 * AI_MAX_TOKENS 可覆盖默认值（如某些中转站限制更严）。
 *
 * 官方 OpenAI 端点不注入：reasoning 模型（o 系/gpt-5 系）拒绝 max_tokens
 * （要求 max_completion_tokens），且官方默认输出上限足够大，
 * 截断问题主要出现在中转站/DeepSeek 类端点。
 */
const defaultMaxTokens = Number(process.env.AI_MAX_TOKENS || 16384)

function isOfficialOpenAIHost(baseURL: string) {
  return /api\.openai\.com/.test(baseURL)
}

function createMaxTokensFetch(providerName: string, inner?: typeof fetch): typeof fetch {
  const base = inner || fetch
  return async (input: any, init?: any) => {
    try {
      if (init?.body && typeof init.body === 'string') {
        const body = JSON.parse(init.body)
        if (providerName === 'gemini' && Array.isArray(body?.contents)) {
          // Gemini 原生格式
          body.generationConfig = { ...(body.generationConfig || {}), maxOutputTokens: defaultMaxTokens }
          init = { ...init, body: JSON.stringify(body) }
        } else if (Array.isArray(body?.messages)) {
          // OpenAI 兼容格式
          body.max_tokens = defaultMaxTokens
          init = { ...init, body: JSON.stringify(body) }
        }
      }
    } catch { /* 解析失败则原样透传 */ }
    return base(input, init)
  }
}

async function getModel(fileModel: string | undefined, modelOverride?: string, textConfigId?: number) {
  // 请求可指定文本配置（含其 provider/baseUrl/apiKey），否则回退到当前启用配置
  const textConfig = (textConfigId ? await getConfigById(textConfigId) : null) || await getTextConfig()
  const modelName = modelOverride || fileModel || textConfig.model
  const providerName = textConfig.provider.toLowerCase()
  const resolvedBaseURL = getTextProviderBaseUrl(textConfig)
  const temperature = textConfig.temperature ?? null
  const endpointKey = `${providerName}|${resolvedBaseURL}|${modelName}|t=${temperature ?? 'default'}`
  if (endpointKey !== lastLoggedTextEndpointKey) {
    lastLoggedTextEndpointKey = endpointKey
    logTaskProgress('AIConfig', 'text-model-endpoint', {
      provider: textConfig.provider,
      baseUrl: resolvedBaseURL,
      model: modelName,
      ...(temperature !== null ? { temperature } : {}),
    })
  }

  // 叠加请求补丁：thinking-off（非官方端点）+ 配置温度 + 输出上限（非官方 OpenAI）
  const thinkingOffFetch = createThinkingOffFetch(providerName, resolvedBaseURL)
  const tempFetch = temperature !== null
    ? createTemperatureFetch(providerName, temperature, thinkingOffFetch)
    : thinkingOffFetch
  const fetchImpl = isOfficialOpenAIHost(resolvedBaseURL)
    ? tempFetch
    : createMaxTokensFetch(providerName, tempFetch)

  if (providerName === 'gemini') {
    const googleProvider = createGoogleGenerativeAI({
      apiKey: textConfig.apiKey,
      baseURL: resolvedBaseURL,
      fetch: fetchImpl,
    })
    return googleProvider(modelName)
  }

  const provider = createOpenAI({
    baseURL: resolvedBaseURL,
    apiKey: textConfig.apiKey,
    fetch: fetchImpl,
  } as any)
  return provider.chat(modelName)
}

const AGENT_TOOLS: Record<string, Record<string, any>> = {
  asset: assetTools,
  storyboard: storyboardTools,
  feed: feedTools,
}

/** instructions 按请求解析：prompt 文件（或默认）+ 技能全文拼接 + 目标语言指令块
 *  prompt/skill 文本随内容语言切换语言变体（<type>.<lang>.md / SKILL.<lang>.md），缺失回退中文版 */
function buildInstructions(type: string) {
  return async ({ requestContext }: { requestContext?: RequestContext }) => {
    const defaults = DEFAULT_PROMPTS[type]
    const lang = getContentLanguageFromRC(requestContext)
    const promptFile = await loadAgentPromptFile(type, lang)
    const baseInstructions = promptFile?.instructions || defaults.instructions
    const skillInstructions = await loadAgentSkills(type, lang)
    const languageDirective = buildLanguageDirective(lang)
    return [baseInstructions, skillInstructions, languageDirective]
      .filter(Boolean)
      .join('\n\n')
  }
}

/** model 按请求解析：基础版 prompt 文件 frontmatter + RequestContext 的 modelOverride/textConfigId 覆盖
 *  （model 只认基础版 prompts/<type>.md，语言变体不参与 model 解析） */
function buildModel(type: string) {
  return async ({ requestContext }: { requestContext?: RequestContext }) => {
    const promptFile = await loadBasePromptFile(type)
    const modelOverride = requestContext?.get('modelOverride' as never) as string | undefined
    const textConfigId = requestContext?.get('textConfigId' as never) as number | undefined
    return getModel(promptFile?.model || undefined, modelOverride, textConfigId)
  }
}

/** 启动时注册的静态 Agent 表（供 Mastra 实例挂载） */
export const agentRegistry: Record<string, Agent> = Object.fromEntries(
  validAgentTypes.map(type => [
    type,
    new Agent({
      id: type,
      name: DEFAULT_PROMPTS[type].name,
      instructions: buildInstructions(type),
      model: buildModel(type),
      tools: AGENT_TOOLS[type],
      workspace: skillWorkspaces[type],
      skillsFormat: 'markdown',
    }),
  ]),
)
