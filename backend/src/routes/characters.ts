import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateImage } from '../services/generation.js'
import { getDramaStylePrompt } from '../services/style-preset.js'
import { ensureCharacterFinalPrompt } from '../services/final-prompt.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()
// 角色图：正视图（默认）/ 四视图人设图 = 竖版 9:16；脸部放大三视图 = 横版 16:9
const CHARACTER_IMAGE_SIZE = '1080x1920'
const CHARACTER_IMAGE_SIZE_FACE_THREE_VIEW = '1920x1080'

// POST /characters — 手动新增角色（传入 episode_id 时关联到该集）
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id 必填')
  if (!body.name?.trim()) return badRequest(c, '名称必填')
  const ts = now()
  const res = await db.insert(schema.characters).values({
    name: body.name.trim(),
    role: body.role || '',
    description: body.description || '',
    appearance: body.appearance || '',
    styling: body.styling || '',
    traits: body.traits || '',
    dramaId: body.drama_id,
    createdAt: ts,
    updatedAt: ts,
  })
  const charId = getInsertId(res)
  if (body.episode_id) {
    const existing = await db.select().from(schema.episodeCharacters)
      .where(and(eq(schema.episodeCharacters.episodeId, Number(body.episode_id)), eq(schema.episodeCharacters.characterId, charId)))
    if (!existing.length) {
      await db.insert(schema.episodeCharacters).values({ episodeId: Number(body.episode_id), characterId: charId, createdAt: ts })
    }
  }
  const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, charId))
  return created(c, toSnakeCase(row))
})

/** 角色板的视图模式：face-three-view=脸部放大三视图，four-view=四视图人设图，其它/空=正视图（默认）；请求参数 sheet_mode 优先，其次角色已存的 sheetMode */
function resolveCharacterSheetMode(char: typeof schema.characters.$inferSelect, body: Record<string, any>): string {
  const v = body.sheet_mode ?? body.sheetMode ?? char.sheetMode ?? ''
  return v === 'face-three-view' || v === 'four-view' ? v : 'front-view'
}

function characterImagePrompt(char: typeof schema.characters.$inferSelect, stylePrompt = '', sheetMode = '') {
  if (sheetMode === 'face-three-view') {
    // 脸部放大三视图：左 1/3 面部特写 + 右 2/3 三视图（Front/Profile/Back）
    return [
      stylePrompt || '',
      '角色设计参考图，横版 16:9 比例，左侧 1/3 区域为超大高清面部特写正对镜头，右侧 2/3 区域整齐排布角色三张全身三视图（正面 Front、侧面 Profile、背面 Back），纯白色背景',
      '视觉对齐：所有角度的比例必须严格一致，角色身高、五官位置、服装褶皱在不同视角下完美契合',
      char.name,
      char.appearance || char.description || '人物立绘',
      char.styling || '',
      '画面中不要出现任何文字、标签、标题、水印',
      '--no photograph, live-action, real human, cosplay, internet celebrity face, revealing outfit, erotic pose, heavy coarse fabric, studio lighting',
      '高质量',
    ].filter(Boolean).join(', ')
  }
  if (sheetMode === 'four-view') {
    return [
    `A character design reference sheet. Vertical 9:16 aspect ratio, maximum resolution output. Pure solid white studio backdrop. high-quality 3D CG animation still, modern game-engine cinematic render, Unreal Engine and Pixar grade quality, semi-realistic stylized characters with refined facial features, clean sculpted anatomy, detailed skin shader with subtle subsurface scattering, PBR materials with crisp detailed textures, rich depth of field, polished film color grading, detailed environment art, sharp focus, consistent character design across shots, 8K resolution, 85mm prime lens, f/2.0 aperture, clean cinematic composition, bright clean exposure, high dynamic range, physically-based surface response, sharp micro-normal detail, individual hair strands with natural falloff, soft cloth simulation with physically accurate folds, expressive readable face, fine iris texture, unified color palette across the sequence, avoid plastic waxy skin, avoid low-poly blurry look, avoid 2D flat cel shading, avoid anime line art, avoid flat color blocks, avoid oily shiny skin, avoid over-smoothed skin, avoid influencer face, avoid uncanny valley, avoid cheap game-cinematic glow, avoid excessive bloom, avoid oversaturated colors, avoid underexposure, avoid film grain, avoid chromatic aberration, avoid deformed hands, avoid extra fingers, avoid extra limbs, avoid garbled text, avoid subtitles, avoid watermark, avoid logo. 2x2 grid with unequal panel heights: top-left FRONT FACE close-up (collarbone-line up to top of head, facing camera, both eyes intact, face fully visible); top-right SIDE FACE pure side profile (facing camera-right); bottom-left full body from neck down facing camera with the face/head intentionally cropped out of frame (BODY FRONT NO FACE, zero face involvement); bottom-right full body back view including back of head (BACK). Same individual character in all four panels. Small clean labels below each panel: "FRONT FACE", "SIDE FACE", "BODY FRONT (NO FACE)", "BACK"; small title at top center of canvas.`,
    char.name,
    char.appearance || char.description || 'character design',
    char.styling || '',
  ].filter(Boolean).join(', ')
  }
  // 正视图（默认）：单张全身正面立绘（与四视图同套规范：纯白色背景 + 3D CG 风格）
  return [
    'A character design reference sheet. Vertical 9:16 aspect ratio, maximum resolution output. Pure solid white studio backdrop',
    'single full-frame vertical panel, one full-body front view from head to feet, facing camera directly, face fully visible, both eyes intact',
    char.name,
    char.appearance || char.description || 'character design',
    char.styling || '',
    stylePrompt || '',
    'NOT photographic, NOT live-action photo, NOT photorealistic, NOT 2D flat cel shading, NOT anime line art, NOT illustration',
    'no text beyond a small "FRONT" label below the figure and the title at top center',
    '高质量',
  ].filter(Boolean).join(', ')
}

// PUT /characters/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [existing] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  const updates: Record<string, any> = { updatedAt: now() }
  for (const key of ['name', 'role', 'description', 'appearance', 'styling', 'traits', 'sheetMode', 'imageUrl', 'localPath']) {
    const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
    if (snakeKey in body) updates[key] = body[snakeKey]
    else if (key in body) updates[key] = body[key]
  }
  // 手动编辑最终提示词时以传入值为准；未传入则保留原值（修改信息时不再自动置空）
  if (body.final_prompt !== undefined) updates.finalPrompt = body.final_prompt || null
  else if (body.finalPrompt !== undefined) updates.finalPrompt = body.finalPrompt || null
  // 视图模式（正视图/四视图/脸部放大-三视图）变化时使旧提示词失效，避免拿缓存的旧板式提示词生图
  else if (existing && updates.sheetMode !== undefined && (updates.sheetMode || '') !== (existing.sheetMode || '')) updates.finalPrompt = null
  await db.update(schema.characters).set(updates).where(eq(schema.characters.id, id))
  return success(c)
})

// DELETE /characters/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.update(schema.characters).set({ deletedAt: now() }).where(eq(schema.characters.id, id))
  return success(c)
})

// POST /characters/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, '角色不存在')
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')

  const stylePrompt = await getDramaStylePrompt(char.dramaId)
  const sheetMode = resolveCharacterSheetMode(char, body)
  const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: body.text_model, configId: body.text_config_id ?? undefined }, sheetMode)
  const prompt = finalPrompt || characterImagePrompt(char, stylePrompt, sheetMode)
  try {
    logTaskStart('CharacterImage', 'generate', { characterId: id, episodeId: ep.id, dramaId: char.dramaId })
    const genId = await generateImage({ characterId: id, dramaId: char.dramaId, prompt, model: body.model, size: sheetMode === 'face-three-view' ? CHARACTER_IMAGE_SIZE_FACE_THREE_VIEW : CHARACTER_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined })
    logTaskSuccess('CharacterImage', 'generate', { characterId: id, generationId: genId })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    logTaskError('CharacterImage', 'generate', { characterId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /characters/:id/generate-prompt — 独立生成/重新生成角色最终提示词（不生图）
app.post('/:id/generate-prompt', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  if (!char) return badRequest(c, '角色不存在')
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')

  logTaskStart('FinalPrompt', 'character-generate', { characterId: id, episodeId: ep.id, force: !!body.force })
  const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, !!body.force, { model: body.text_model, configId: body.text_config_id ?? undefined }, resolveCharacterSheetMode(char, body), body.user_note ?? body.userNote ?? '')
  if (!finalPrompt) {
    logTaskError('FinalPrompt', 'character-generate', { characterId: id, error: 'agent returned empty prompt' })
    return badRequest(c, '最终提示词生成失败，请重试')
  }
  const [fresh] = await db.select().from(schema.characters).where(eq(schema.characters.id, id))
  logTaskSuccess('FinalPrompt', 'character-generate', { characterId: id })
  return success(c, { final_prompt: finalPrompt, traits: fresh?.traits || '', appearance: fresh?.appearance || '', styling: fresh?.styling || '' })
})

// POST /characters/batch-generate-images
app.post('/batch-generate-images', async (c) => {
  const body = await c.req.json()
  const ids: number[] = body.character_ids || []
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')
  const results: number[] = []
  const stylePrompt = await getDramaStylePrompt(ep.dramaId)
  for (const cid of ids) {
    const [char] = await db.select().from(schema.characters).where(eq(schema.characters.id, cid))
    if (!char) continue
    const sheetMode = resolveCharacterSheetMode(char, body)
    const finalPrompt = await ensureCharacterFinalPrompt(char, ep.id, false, { model: body.text_model, configId: body.text_config_id ?? undefined }, sheetMode)
    const prompt = finalPrompt || characterImagePrompt(char, stylePrompt, sheetMode)
    try {
      const genId = await generateImage({ characterId: cid, dramaId: char.dramaId, prompt, model: body.model, size: sheetMode === 'face-three-view' ? CHARACTER_IMAGE_SIZE_FACE_THREE_VIEW : CHARACTER_IMAGE_SIZE, configId: body.config_id ?? ep.imageConfigId ?? undefined })
      results.push(genId)
    } catch {}
  }
  logTaskSuccess('CharacterImage', 'batch-generate', { episodeId: ep.id, requested: ids.length, started: results.length })
  return success(c, { count: results.length, ids: results })
})

export default app
