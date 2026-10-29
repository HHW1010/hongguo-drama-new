import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateImage } from '../services/generation.js'
import { getDramaStylePrompt } from '../services/style-preset.js'
import { ensurePropFinalPrompt } from '../services/final-prompt.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()
// 道具图：三视图道具板（正面/侧面/背面横向排列）或四视图设计板（SIDE/FRONT/TOP/3-4 VIEW，2x2 均等），均为横版画布
const PROP_IMAGE_SIZE = '1920x1080'

// POST /props — 手动新增道具（传入 episode_id 时关联到该集）
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id 必填')
  if (!body.name?.trim()) return badRequest(c, '名称必填')
  const ts = now()
  const res = await db.insert(schema.props).values({
    name: body.name.trim(),
    type: body.type || '',
    description: body.description || '',
    dramaId: body.drama_id,
    createdAt: ts,
    updatedAt: ts,
  })
  const propId = getInsertId(res)
  if (body.episode_id) {
    const existing = await db.select().from(schema.episodeProps)
      .where(and(eq(schema.episodeProps.episodeId, Number(body.episode_id)), eq(schema.episodeProps.propId, propId)))
    if (!existing.length) {
      await db.insert(schema.episodeProps).values({ episodeId: Number(body.episode_id), propId, createdAt: ts })
    }
  }
  const [row] = await db.select().from(schema.props).where(eq(schema.props.id, propId))
  return created(c, toSnakeCase(row))
})

// DELETE /props/:id — 软删除
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.update(schema.props).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.props.id, id))
  return success(c)
})

// PUT /props/:id — 更新道具（物品外貌/类型/最终提示词）
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = body.name
  if (body.type !== undefined) updates.type = body.type
  if (body.description !== undefined) updates.description = body.description
  if (body.sheet_mode !== undefined) updates.sheetMode = body.sheet_mode || null
  else if (body.sheetMode !== undefined) updates.sheetMode = body.sheetMode || null
  // 用户上传道具图：直接写入图片地址与本地路径
  if (body.image_url !== undefined) updates.imageUrl = body.image_url
  else if (body.imageUrl !== undefined) updates.imageUrl = body.imageUrl
  if (body.local_path !== undefined) updates.localPath = body.local_path
  else if (body.localPath !== undefined) updates.localPath = body.localPath
  // 手动编辑最终提示词时以传入值为准；未传入则保留原值（修改信息时不再自动置空）
  if (body.final_prompt !== undefined) updates.finalPrompt = body.final_prompt || null
  else if (body.finalPrompt !== undefined) updates.finalPrompt = body.finalPrompt || null
  await db.update(schema.props).set(updates).where(eq(schema.props.id, id))
  return success(c)
})

/** 道具板的视图模式：four-view=四视图设计板，front-view=正视图单品，其它/空=三视图道具板；请求参数 sheet_mode 优先，其次道具已存的 sheetMode */
function resolveSheetMode(prop: typeof schema.props.$inferSelect, body: Record<string, any>): string {
  const v = body.sheet_mode ?? body.sheetMode ?? prop.sheetMode ?? ''
  return v === 'four-view' || v === 'front-view' ? v : ''
}

/** 本地兜底提示词：三视图道具板 / 四视图设计板 / 正视图单品 */
function propImagePrompt(prop: typeof schema.props.$inferSelect, stylePrompt = '', sheetMode = '') {
  if (sheetMode === 'four-view') {
    return [
      stylePrompt || '',
      '道具设计参考图，横版 16:9 比例，2x2 均等宫格：左上 SIDE VIEW、右上 FRONT VIEW、左下 TOP VIEW、右下 3/4 VIEW，四格同一道具',
      `道具主体：${prop.name}`,
      prop.description || '',
      '纯色中性浅暖灰摄影棚背景，单侧侧轮廓背光',
      '四格共用同一背景与灯光，四格之间细中性浅灰分隔线',
      '每格下方标 SIDE、FRONT、TOP、3/4 VIEW',
      '高清细节',
    ].filter(Boolean).join(', ')
  }
  if (sheetMode === 'front-view') {
    return [
      stylePrompt || '',
      '道具设计参考图，横版 16:9 比例，单一正视图，正对镜头，完整居中入镜，不做侧面/背面/俯视',
      `道具主体：${prop.name}`,
      prop.description || '',
      '纯色中性浅暖灰摄影棚背景，单侧侧轮廓背光',
      '高清细节',
    ].filter(Boolean).join(', ')
  }
  return [
    stylePrompt || '',
    `同一画布中仅包含三个正交视图：正面视图、侧面视图、背面视图，三个视图横向等距排列、底部对齐同一水平基准线`,
    `道具主体：${prop.name}`,
    prop.description || '',
    '三个视图高度、宽度、厚度、结构比例和部件位置完全一致，正交投影，静止展示，禁止透视变形',
    '统一正面平光，柔和均匀照明',
    '纯白色背景，无渐变、无纹理、无装饰元素',
    '高清细节，产品级渲染',
    '画面中不要出现任何文字说明、标签、尺寸标注、箭头或额外布局',
  ].filter(Boolean).join(', ')
}

// POST /props/:id/generate-prompt — 独立生成/重新生成三视图道具板最终提示词（不生图）
app.post('/:id/generate-prompt', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [prop] = await db.select().from(schema.props).where(eq(schema.props.id, id))
  if (!prop) return badRequest(c, '道具不存在')
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')

  logTaskStart('FinalPrompt', 'prop-generate', { propId: id, episodeId: ep.id, force: !!body.force })
  const finalPrompt = await ensurePropFinalPrompt(prop, ep.id, !!body.force, { model: body.text_model, configId: body.text_config_id ?? undefined }, resolveSheetMode(prop, body))
  if (!finalPrompt) {
    logTaskError('FinalPrompt', 'prop-generate', { propId: id, error: 'agent returned empty prompt' })
    return badRequest(c, '最终提示词生成失败，请重试')
  }
  logTaskSuccess('FinalPrompt', 'prop-generate', { propId: id })
  return success(c, { final_prompt: finalPrompt })
})

// POST /props/:id/generate-image — 生成道具三视图道具板图
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [prop] = await db.select().from(schema.props).where(eq(schema.props.id, id))
  if (!prop) return badRequest(c, '道具不存在')
  if (!body.episode_id) return badRequest(c, 'episode_id 必填')

  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id)))
  if (!ep) return badRequest(c, '剧集不存在')

  const stylePrompt = await getDramaStylePrompt(prop.dramaId)
  const sheetMode = resolveSheetMode(prop, body)
  const finalPrompt = await ensurePropFinalPrompt(prop, ep.id, false, { model: body.text_model, configId: body.text_config_id ?? undefined }, sheetMode)
  const prompt = finalPrompt || propImagePrompt(prop, stylePrompt, sheetMode)
  const size = PROP_IMAGE_SIZE
  try {
    logTaskStart('PropImage', 'generate', { propId: id, episodeId: ep.id, dramaId: prop.dramaId })
    const genId = await generateImage({ propId: id, dramaId: prop.dramaId, prompt, model: body.model, size, configId: body.config_id ?? ep.imageConfigId ?? undefined })
    logTaskSuccess('PropImage', 'generate', { propId: id, generationId: genId })
    return success(c, { image_generation_id: genId })
  } catch (err: any) {
    logTaskError('PropImage', 'generate', { propId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

export default app
