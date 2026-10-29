/**
 * 资产锁定 Agent 工具（manju-laoli 资产层专精引擎）
 * 模块级单例 — episodeId + dramaId 通过 RequestContext 按请求注入
 *
 * 单 Agent 一步流程「资产锁定」：
 * 1. 读取原始文本（ep.content 优先）
 * 2. 读取项目中已存在的角色/场景/道具（用于去重 + 资产编号接续）
 * 3. 按 manju-laoli 三清单法提取并智能去重后保存（含 asset_code / material_form / voice_description）
 * 4. 按红果图面格式产出最终提示词（角色参考图【正视图默认 / 四视图 / 脸部三视图】 / 场景地点板 / 道具三视图道具板，含 sheet_mode 视图开关），保存时注入项目视觉风格
 * 5. 产出《素材接线单》/《资产编号册》写入 asset_ledgers（素材形态 M0/M1/M2 的文字侧产物）
 */
import { createTool } from '@mastra/core/tools'
import type { ToolExecutionContext } from '@mastra/core/tools'
import { z } from 'zod'
import { db, getInsertId, schema } from '../../db/index.js'
import { eq, and } from 'drizzle-orm'
import { now } from '../../utils/response.js'
import { logTaskProgress, logTaskSuccess } from '../../utils/task-logger.js'
import { getDramaStylePrompt, getDramaStyleInfo } from '../../services/style-preset.js'
import { getDramaId, getEpisodeId } from '../context.js'

/** 项目视觉风格（中文名 + 描述），供【风格】段使用；未绑定风格时描述给出兜底默认值 */
async function getVisualStyle(dramaId: number | null | undefined) {
  const info = await getDramaStyleInfo(dramaId)
  return info
    ? { name: info.name, description: info.description || '' }
    : { name: '', description: '精致国漫美型 3DCG 角色设计渲染' }
}

/**
 * 确定性拼装「四视图人设图」最终提示词（3D CG 风格内嵌【Style】段）。
 * 不依赖 LLM 自由发挥版式与风格词——LLM 产出偶尔会跑成 photorealistic / 自由排版，
 * 这里用代码固定 fourview-sheet 骨架，保证与神豪系统等规范项目完全一致。
 */
function buildFourViewPrompt(name: string, appearance: string, styling: string, style: string): string {
  const subject = (appearance || '').trim() || 'character design'
  const stylingLine = (styling || '').trim() ? `\n\n**Styling**: ${(styling || '').trim()}` : ''
  const title = ((name || '').trim().toUpperCase()) || 'CHARACTER'
  return [
    'A character design reference sheet. **Vertical 9:16 aspect ratio. Maximum resolution output.** Pure solid white studio backdrop.',
    '',
    '【Layout】',
    '',
    '**2x2 grid with unequal panel heights**:',
    '- Top row: two smaller panels (each approximately 1/3 of total canvas height) — head/face close-ups',
    '- Bottom row: two larger panels (each approximately 2/3 of total canvas height) — full body shots',
    '- Thin neutral light-grey dividing lines between all four panels',
    '- All four panels share the same pure solid white backdrop',
    '',
    '【4 Panels】',
    '',
    '**Top-left panel — FRONT FACE CLOSE-UP**: Tight close-up of the character\'s face, framed from approximately collarbone-line up to top of head. Subject facing camera directly. Both eyes intact, face fully visible.',
    '',
    '**Top-right panel — SIDE FACE CLOSE-UP (PROFILE)**: Tight close-up of the face in pure side profile, framed from collarbone-line up to top of head. Subject facing camera-right. Face fully visible.',
    '',
    '**Bottom-left panel — FULL BODY FROM NECK DOWN, FRONT VIEW (NO FACE)**: Full body shot from collarbone-line down to feet, facing camera directly. **The face/head is intentionally cropped out of frame at the top of this panel—only the neck, shoulders, torso, arms, hips, legs, and feet are visible.** Zero face involvement so this panel survives any future face replacement edit.',
    '',
    '**Bottom-right panel — FULL BODY BACK VIEW (INCLUDING BACK OF HEAD)**: Full body shot from head to feet, facing directly away from camera (back of subject toward camera). Includes back of head.',
    '',
    '【Subject — same character across all 4 panels】',
    '',
    `${name}: ${subject}${stylingLine}`,
    '',
    '【Color Palette】',
    'Muted natural palette consistent with the described outfit, hair and skin tone; ALL materials rendered in the 3D CG style below.',
    '',
    '【Pose - same across all 4 panels】',
    'Default standing pose with feet shoulder-width apart, weight evenly distributed, arms relaxed at the sides. Subtle calm, natural energy—NOT aggressive action pose, NOT showy, NOT slouching.',
    '',
    '【Critical consistency】',
    'SAME individual character in all 4 panels—identical face, identical hairstyle, identical outfit, identical build. Same pure solid white studio backdrop across all 4 panels.',
    '',
    '【Style】',
    style,
    '',
    '【Quality】',
    'Maximum resolution output. 8k ultra clean rendering. Sharp clean edges. Every strand of hair, fold of fabric, and contour of the face clearly defined.',
    '',
    '【Panel Labels】',
    'Small clean monospace sans-serif black text below each panel:',
    '- Top-left: "FRONT FACE"',
    '- Top-right: "SIDE FACE"',
    '- Bottom-left: "BODY FRONT (NO FACE)"',
    '- Bottom-right: "BACK"',
    '',
    `Title at top center of canvas (small clean black sans-serif): "${title} — CHARACTER DESIGN SHEET"`,
    '',
    '【Constraints】',
    '**Ethnic accuracy (CRITICAL)**: Must match the described appearance; NOT a Western face unless specified, NOT a stylized anime face.',
    '**Body, age & framing**: Must match the described age and build. Bottom-left panel must show NO face — head cropped out at the top edge.',
    '**Equipment differentiation**: No weapon, no prop in hand unless specified.',
    '**Aesthetic**: NOT photographic, NOT live-action photo, NOT photorealistic, NOT 2D flat cel shading, NOT anime line art, NOT illustration, NOT plastic waxy skin.',
    '**Layout & background**: NOT 1:1 square aspect (must be vertical 9:16), NOT equal-sized 4 panels (top row smaller, bottom row larger), NOT face visible in bottom-left panel (face strictly cropped out), NOT colored or gradient background (must be pure solid white), NOT any text beyond the four panel labels and the top title.',
  ].join('\n')
}

/**
 * 确定性拼装「正视图立绘」最终提示词（默认板式，单视图全身正面）。
 * 与四视图同套规范（纯白色背景 + 3D CG 风格内嵌），
 * 仅把「四视图四格」换成「单张全身正视图」，其余版式/风格/负面纪律一致。
 */
function buildFrontViewPrompt(name: string, appearance: string, styling: string, style: string): string {
  const subject = (appearance || '').trim() || 'character design'
  const stylingLine = (styling || '').trim() ? `\n\n**Styling**: ${(styling || '').trim()}` : ''
  const title = ((name || '').trim().toUpperCase()) || 'CHARACTER'
  return [
    'A character design reference sheet. **Vertical 9:16 aspect ratio. Maximum resolution output.** Pure solid white studio backdrop.',
    '',
    '【Layout】',
    '',
    '**Single full-frame vertical panel** — one full-body front view filling the entire canvas, no grid, no multiple panels.',
    '',
    '【1 Panel】',
    '',
    '**FRONT FULL BODY**: Full body shot from head to feet, facing camera directly, framed so the whole figure is fully visible with a thin margin of backdrop. Face fully visible, both eyes intact.',
    '',
    '【Subject — same character across all frames】',
    '',
    `${name}: ${subject}${stylingLine}`,
    '',
    '【Color Palette】',
    'Muted natural palette consistent with the described outfit, hair and skin tone; ALL materials rendered in the 3D CG style below.',
    '',
    '【Pose - same across all frames】',
    'Default standing pose with feet shoulder-width apart, weight evenly distributed, arms relaxed at the sides. Subtle calm, natural energy—NOT aggressive action pose, NOT showy, NOT slouching.',
    '',
    '【Critical consistency】',
    'SAME individual character across all regenerations—identical face, identical hairstyle, identical outfit, identical build. Same pure solid white studio backdrop.',
    '',
    '【Style】',
    style,
    '',
    '【Quality】',
    'Maximum resolution output. 8k ultra clean rendering. Sharp clean edges. Every strand of hair, fold of fabric, and contour of the face clearly defined.',
    '',
    '【Panel Labels】',
    'Small clean monospace sans-serif black text below the figure:',
    '- "FRONT"',
    '',
    `Title at top center of canvas (small clean black sans-serif): "${title} — CHARACTER DESIGN SHEET"`,
    '',
    '【Constraints】',
    '**Ethnic accuracy (CRITICAL)**: Must match the described appearance; NOT a Western face unless specified, NOT a stylized anime face.',
    '**Body, age & framing**: Must match the described age and build. Full body from head to feet fully in frame, face fully visible.',
    '**Equipment differentiation**: No weapon, no prop in hand unless specified.',
    '**Aesthetic**: NOT photographic, NOT live-action photo, NOT photorealistic, NOT 2D flat cel shading, NOT anime line art, NOT illustration, NOT plastic waxy skin.',
    '**Layout & background**: NOT 1:1 square aspect (must be vertical 9:16), NOT multiple panels (single full-body front view only), NOT colored or gradient background (must be pure solid white), NOT any text beyond the single panel label and the top title.',
  ].join('\n')
}

// ─── 关联辅助 ────────────────────────────────────────────────
async function linkCharToEpisode(episodeId: number, characterId: number) {
  const ts = now()
  const existing = await db.select().from(schema.episodeCharacters)
    .where(and(eq(schema.episodeCharacters.episodeId, episodeId), eq(schema.episodeCharacters.characterId, characterId)))
  if (!existing.length) {
    await db.insert(schema.episodeCharacters).values({ episodeId, characterId, createdAt: ts })
  }
}

async function linkSceneToEpisode(episodeId: number, sceneId: number) {
  const ts = now()
  const existing = await db.select().from(schema.episodeScenes)
    .where(and(eq(schema.episodeScenes.episodeId, episodeId), eq(schema.episodeScenes.sceneId, sceneId)))
  if (!existing.length) {
    await db.insert(schema.episodeScenes).values({ episodeId, sceneId, createdAt: ts })
  }
}

async function linkPropToEpisode(episodeId: number, propId: number) {
  const ts = now()
  const existing = await db.select().from(schema.episodeProps)
    .where(and(eq(schema.episodeProps.episodeId, episodeId), eq(schema.episodeProps.propId, propId)))
  if (!existing.length) {
    await db.insert(schema.episodeProps).values({ episodeId, propId, createdAt: ts })
  }
}

// ─── 名字归一化（近名去重） ───────────────────────────────────
function normalizeName(name: string): string {
  return (name || '')
    .replace(/[（(][^（()）]*[）)]/g, '')
    .replace(/[（(].*$/, '')
    .replace(/[\s　]+/g, '')
    .toLowerCase()
    .trim()
}

function normalizeLocation(loc: string): string {
  return (loc || '').replace(/[\s　]+/g, '').toLowerCase().trim()
}

type ToolContext = ToolExecutionContext | undefined

function requireIds(context: ToolContext): { episodeId: number; dramaId: number } | { error: string } {
  const episodeId = getEpisodeId(context?.requestContext)
  const dramaId = getDramaId(context?.requestContext)
  if (!episodeId || !dramaId) return { error: 'Missing episodeId/dramaId in request context' }
  return { episodeId, dramaId }
}

// ─── 1. 读取原始文本 ─────────────────────────────────────────
const readScriptForExtraction = createTool({
  id: 'read_script_for_extraction',
  description: 'Read the raw source text (novel/story) for asset locking (三清单提取).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
    if (!ep) return { error: 'Episode not found' }
    const content = ep.content || ep.scriptContent
    if (!content) return { error: 'Episode has no source text' }
    logTaskSuccess('AssetTool', 'read-script', { episodeId, dramaId, scriptLength: content.length })
    return { script: content }
  },
})

// ─── 1b. 读取整部剧全部剧情原文（人物特征需把握整体剧情与人设弧光） ──
const readDramaPlot = createTool({
  id: 'read_drama_plot',
  description: 'Read the full plot of the whole drama (all episodes source text) to derive a character 人物特征 (age/personality/behavior/voice/language style) grounded in the complete story arc.',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const eps = (await db.select().from(schema.episodes).where(eq(schema.episodes.dramaId, dramaId)))
      .filter(e => !e.deletedAt)
      .sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0))
    const plot = eps.map(e => `【第${e.episodeNumber}集 ${e.title || ''}】\n${e.content || e.scriptContent || ''}`).join('\n\n')
    logTaskSuccess('AssetTool', 'read-drama-plot', { dramaId, episodeCount: eps.length, plotLength: plot.length })
    return { drama_id: dramaId, episode_count: eps.length, plot }
  },
})

// ─── 2. 读取已有角色（去重 + 编号接续） ──────────────────────
const readExistingCharacters = createTool({
  id: 'read_existing_characters',
  description: 'Read all characters already existing in this drama project (for deduplication and asset-code continuity).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const links = await db.select().from(schema.episodeCharacters)
      .where(eq(schema.episodeCharacters.episodeId, episodeId))
    const linkedIds = new Set(links.map(link => link.characterId))
    const chars = (await db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)))
      .filter(c => !c.deletedAt)
    const visibleChars = chars.map(c => ({
      id: c.id,
      name: c.name,
      role: c.role || '',
      appearance: c.appearance || '',
      styling: c.styling || '',
      asset_code: c.assetCode || '',
      material_form: c.materialForm || '',
      voice_description: c.voiceDescription || '',
      final_prompt: c.finalPrompt || '',
      image_url: c.imageUrl || '',
      normalized_name: normalizeName(c.name),
    }))
    const payload = {
      count: visibleChars.length,
      characters: visibleChars,
      current_episode_characters: visibleChars.filter(c => linkedIds.has(c.id)),
    }
    logTaskSuccess('AssetTool', 'read-characters', {
      episodeId, dramaId,
      projectCharacters: payload.count,
      episodeCharacters: payload.current_episode_characters.length,
    })
    return payload
  },
})

// ─── 3. 读取已有场景 ─────────────────────────────────────────
const readExistingScenes = createTool({
  id: 'read_existing_scenes',
  description: 'Read all scenes already existing in this drama project (for deduplication and asset-code continuity).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const links = await db.select().from(schema.episodeScenes)
      .where(eq(schema.episodeScenes.episodeId, episodeId))
    const linkedIds = new Set(links.map(link => link.sceneId))
    const scenes = (await db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)))
      .filter(s => !s.deletedAt)
    const visibleScenes = scenes.map(s => ({
      id: s.id,
      location: s.location,
      time: s.time || '',
      prompt: s.prompt || '',
      lighting: s.lighting || '',
      asset_code: s.assetCode || '',
      material_form: s.materialForm || '',
      final_prompt: s.finalPrompt || '',
      image_url: s.imageUrl || '',
      normalized_location: normalizeLocation(s.location),
    }))
    const payload = {
      count: visibleScenes.length,
      scenes: visibleScenes,
      current_episode_scenes: visibleScenes.filter(s => linkedIds.has(s.id)),
    }
    logTaskSuccess('AssetTool', 'read-scenes', {
      episodeId, dramaId,
      projectScenes: payload.count,
      episodeScenes: payload.current_episode_scenes.length,
    })
    return payload
  },
})

// ─── 4. 读取已有道具 ─────────────────────────────────────────
const readExistingProps = createTool({
  id: 'read_existing_props',
  description: 'Read all props already existing in this drama project (for deduplication and asset-code continuity).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const links = await db.select().from(schema.episodeProps)
      .where(eq(schema.episodeProps.episodeId, episodeId))
    const linkedIds = new Set(links.map(link => link.propId))
    const props = (await db.select().from(schema.props).where(eq(schema.props.dramaId, dramaId)))
      .filter(p => !p.deletedAt)
    const visibleProps = props.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type || '',
      description: p.description || '',
      asset_code: p.assetCode || '',
      material_form: p.materialForm || '',
      final_prompt: p.finalPrompt || '',
      image_url: p.imageUrl || '',
      normalized_name: normalizeName(p.name),
    }))
    const payload = {
      count: visibleProps.length,
      props: visibleProps,
      current_episode_props: visibleProps.filter(p => linkedIds.has(p.id)),
    }
    logTaskSuccess('AssetTool', 'read-props', {
      episodeId, dramaId,
      projectProps: payload.count,
      episodeProps: payload.current_episode_props.length,
    })
    return payload
  },
})

// ─── 5. 保存角色（去重 + 资产字段） ──────────────────────────
const saveDedupCharacters = createTool({
  id: 'save_dedup_characters',
  description: 'Save extracted characters with deduplication. Existing characters (same name) are merged/updated; new ones are created. Each may carry asset_code (图N), material_form (M0/M1/M2) and voice_description (音色/声纹描述). All are linked to the current episode.',
  inputSchema: z.object({
    characters: z.array(z.object({
      name: z.string(),
      role: z.string().optional(),
      description: z.string().optional(),
      appearance: z.string().optional(),
      styling: z.string().optional(),
      asset_code: z.string().optional(),
      material_form: z.string().optional(),
      voice_description: z.string().optional(),
    })),
  }),
  execute: async ({ characters }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const ts = now()
    const results = { created: 0, merged: 0 }
    logTaskProgress('AssetTool', 'save-characters-begin', {
      episodeId, dramaId,
      names: characters.map(char => char.name).join(','),
    })

    for (const char of characters) {
      const charsInProject = (await db.select().from(schema.characters)
        .where(eq(schema.characters.dramaId, dramaId)))
        .filter(c => !c.deletedAt)
      const exact = charsInProject.find(c => c.name === char.name)
      const normName = normalizeName(char.name)
      const existing = exact || (normName ? charsInProject.find(c => c.name && normalizeName(c.name) === normName) : undefined)
      const matchedViaNorm = !!existing && existing !== exact

      if (existing) {
        if (matchedViaNorm) logTaskProgress('AssetTool', 'save-characters-reuse', { episodeId, dramaId, extracted: char.name, reused: existing.name })
        const patch: Record<string, any> = {
          role: char.role || existing.role,
          description: char.description || existing.description,
          appearance: char.appearance || existing.appearance,
          styling: char.styling || char.description || existing.styling,
          updatedAt: ts,
        }
        if (char.asset_code !== undefined) patch.assetCode = char.asset_code
        if (char.material_form !== undefined) patch.materialForm = char.material_form
        if (char.voice_description !== undefined) patch.voiceDescription = char.voice_description
        await db.update(schema.characters).set(patch).where(eq(schema.characters.id, existing.id))
        await linkCharToEpisode(episodeId, existing.id)
        results.merged++
      } else {
        const res = await db.insert(schema.characters).values({
          name: char.name,
          role: char.role || '',
          description: char.description || '',
          appearance: char.appearance || '',
          styling: char.styling || char.description || '',
          assetCode: char.asset_code || '',
          materialForm: char.material_form || '',
          voiceDescription: char.voice_description || '',
          dramaId,
          createdAt: ts,
          updatedAt: ts,
        })
        const charId = getInsertId(res)
        await linkCharToEpisode(episodeId, charId)
        results.created++
      }
    }

    const payload = { message: `角色保存完成：新增 ${results.created}，合并更新 ${results.merged}`, ...results }
    logTaskSuccess('AssetTool', 'save-characters-complete', { episodeId, ...results })
    return payload
  },
})

// ─── 6. 保存场景（去重 + 资产字段） ──────────────────────────
const saveDedupScenes = createTool({
  id: 'save_dedup_scenes',
  description: 'Save extracted scenes with deduplication. Existing scenes (same location+time) are reused; new ones are created. Each may carry asset_code (图N) and material_form (M0/M1/M2). All are linked to the current episode.',
  inputSchema: z.object({
    scenes: z.array(z.object({
      location: z.string(),
      time: z.string().optional(),
      prompt: z.string().optional(),
      description: z.string().optional(),
      lighting: z.string().optional(),
      asset_code: z.string().optional(),
      material_form: z.string().optional(),
    })),
  }),
  execute: async ({ scenes }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const ts = now()
    const results = { created: 0, reused: 0 }
    logTaskProgress('AssetTool', 'save-scenes-begin', {
      episodeId, dramaId,
      scenes: scenes.map(scene => `${scene.location}@${scene.time || ''}`).join(','),
    })

    for (const scene of scenes) {
      const scenesInProject = (await db.select().from(schema.scenes)
        .where(eq(schema.scenes.dramaId, dramaId)))
        .filter(s => !s.deletedAt)
      const normLocation = normalizeLocation(scene.location)
      const existing = scenesInProject.find(s => s.location === scene.location && s.time === (scene.time || ''))
        || (normLocation ? scenesInProject.find(s => normalizeLocation(s.location) === normLocation && s.time === (scene.time || '')) : undefined)

      if (existing) {
        const patch: Record<string, any> = {
          prompt: scene.prompt || scene.description || existing.prompt,
          lighting: scene.lighting || existing.lighting,
          updatedAt: ts,
        }
        if (scene.asset_code !== undefined) patch.assetCode = scene.asset_code
        if (scene.material_form !== undefined) patch.materialForm = scene.material_form
        await db.update(schema.scenes).set(patch).where(eq(schema.scenes.id, existing.id))
        await linkSceneToEpisode(episodeId, existing.id)
        results.reused++
      } else {
        const res = await db.insert(schema.scenes).values({
          dramaId,
          location: scene.location,
          time: scene.time || '',
          prompt: scene.prompt || scene.description || scene.location,
          lighting: scene.lighting || '',
          assetCode: scene.asset_code || '',
          materialForm: scene.material_form || '',
          createdAt: ts,
          updatedAt: ts,
        })
        const sceneId = getInsertId(res)
        await linkSceneToEpisode(episodeId, sceneId)
        results.created++
      }
    }

    const payload = { message: `场景保存完成：新增 ${results.created}，复用已有 ${results.reused}`, ...results }
    logTaskSuccess('AssetTool', 'save-scenes-complete', { episodeId, ...results })
    return payload
  },
})

// ─── 7. 保存道具（去重 + 资产字段） ──────────────────────────
const saveDedupProps = createTool({
  id: 'save_dedup_props',
  description: 'Save extracted props with deduplication. Existing props (same name) are merged/updated; new ones are created. Each may carry asset_code (图N) and material_form (M0/M1/M2). All are linked to the current episode.',
  inputSchema: z.object({
    props: z.array(z.object({
      name: z.string(),
      type: z.string().optional(),
      description: z.string().optional(),
      asset_code: z.string().optional(),
      material_form: z.string().optional(),
    })),
  }),
  execute: async ({ props }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids
    const ts = now()
    const results = { created: 0, merged: 0 }
    logTaskProgress('AssetTool', 'save-props-begin', {
      episodeId, dramaId,
      names: props.map(prop => prop.name).join(','),
    })

    for (const prop of props) {
      const propsInProject = (await db.select().from(schema.props)
        .where(eq(schema.props.dramaId, dramaId)))
        .filter(p => !p.deletedAt)
      const exact = propsInProject.find(p => p.name === prop.name)
      const normName = normalizeName(prop.name)
      const existing = exact || (normName ? propsInProject.find(p => p.name && normalizeName(p.name) === normName) : undefined)
      const matchedViaNorm = !!existing && existing !== exact

      if (existing) {
        if (matchedViaNorm) logTaskProgress('AssetTool', 'save-props-reuse', { episodeId, dramaId, extracted: prop.name, reused: existing.name })
        const patch: Record<string, any> = {
          type: prop.type || existing.type,
          description: prop.description || existing.description,
          finalPrompt: prop.description ? null : existing.finalPrompt,
          updatedAt: ts,
        }
        if (prop.asset_code !== undefined) patch.assetCode = prop.asset_code
        if (prop.material_form !== undefined) patch.materialForm = prop.material_form
        await db.update(schema.props).set(patch).where(eq(schema.props.id, existing.id))
        await linkPropToEpisode(episodeId, existing.id)
        results.merged++
      } else {
        const res = await db.insert(schema.props).values({
          name: prop.name,
          type: prop.type || '',
          description: prop.description || '',
          assetCode: prop.asset_code || '',
          materialForm: prop.material_form || '',
          dramaId,
          createdAt: ts,
          updatedAt: ts,
        })
        const propId = getInsertId(res)
        await linkPropToEpisode(episodeId, propId)
        results.created++
      }
    }

    const payload = { message: `道具保存完成：新增 ${results.created}，合并更新 ${results.merged}`, ...results }
    logTaskSuccess('AssetTool', 'save-props-complete', { episodeId, ...results })
    return payload
  },
})

// ─── 8. 角色最终提示词 ───────────────────────────────────────
const readCharacters = createTool({
  id: 'read_characters',
  description: '读取当前剧集项目中的所有角色信息（含资产编号/素材形态/音色描述/视图模式），用于生成角色参考图（正视图立绘默认 / 四视图人设图 / 脸部放大三视图）最终提示词。',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const chars = (await db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)))
      .filter(c => !c.deletedAt)
    return {
      drama: { visual_style: await getVisualStyle(dramaId) },
      characters: chars.map(c => ({
        id: c.id,
        name: c.name,
        role: c.role || '',
        description: c.description || '',
        appearance: c.appearance || '',
        styling: c.styling || '',
        sheet_mode: c.sheetMode || '',
        asset_code: c.assetCode || '',
        material_form: c.materialForm || '',
        voice_description: c.voiceDescription || '',
        traits: c.traits || '',
        final_prompt: c.finalPrompt || '',
      })),
    }
  },
})

const saveCharacterFinalPrompt = createTool({
  id: 'save_character_final_prompt',
  description: '保存为角色创作的参考图最终提示词（正视图立绘默认 / 四视图人设图 / 脸部放大三视图，按 sheet_mode 决定）。正视图立绘与四视图人设图都由工具自动拼装同套 3D CG 母版（忽略 prompt 正文）；脸部放大三视图由工具自动拼接项目视觉风格。',
  inputSchema: z.object({
    character_id: z.number(),
    prompt: z.string().describe('仅脸部放大三视图需要手写提示词正文（画面内不含任何文字标签或标题，使用会话语言指令指定的目标语言）；正视图立绘 / 四视图人设图正文由工具自动拼装，此参数传一句简短说明即可（会被忽略）。'),
    appearance: z.string().optional().describe('用户补充想法融合后更新过的样貌描述（appearance），写回数据库并用于正视图/四视图的工具自动拼装。'),
    styling: z.string().optional().describe('用户补充想法融合后更新过的妆造描述（styling），写回数据库并用于正视图/四视图的工具自动拼装。'),
    asset_code: z.string().optional(),
    material_form: z.string().optional(),
    voice_description: z.string().optional(),
    traits: z.string().optional().describe('角色「人物特征」：根据整部剧剧情推导，格式为「名字：年龄/外形；性格气质；行为表现；音色；语言风格」五段，全角分号分隔，整段包在【】内（如【周玄安：18-20岁左右；温和开朗…；行为松弛…；温润青年音…；标准普通话…】）。'),
    skip_style_prefix: z.boolean().optional().describe('仅脸部放大三视图生效：省略或 false 由工具拼接项目视觉风格，true 跳过；正视图立绘/四视图人设图忽略此参数（工具自动拼装）。'),
  }),
  execute: async ({ character_id, prompt, asset_code, material_form, voice_description, traits, skip_style_prefix, appearance, styling }, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const [c] = await db.select().from(schema.characters).where(eq(schema.characters.id, character_id))
    if (!c) return { error: 'Character not found' }

    // 正视图立绘（默认）与四视图人设图：模板自带风格、版式固定，由代码确定性拼装（不信任 LLM 自由发挥）；
    // 脸部放大三视图：风格词由工具拼接（skip_style_prefix 控制）。
    // appearance / styling：用户补充想法融合后的更新值，优先于库中原值参与拼装，并写回数据库。
    const sheetMode = c.sheetMode || ''
    const appearanceVal = appearance !== undefined ? appearance : c.appearance
    const stylingVal = styling !== undefined ? styling : c.styling
    let finalPrompt: string
    if (sheetMode === 'face-three-view') {
      const stylePrompt = skip_style_prefix ? '' : await getDramaStylePrompt(dramaId)
      finalPrompt = stylePrompt ? `${stylePrompt}, ${prompt}` : prompt
    } else if (sheetMode === 'four-view') {
      finalPrompt = buildFourViewPrompt(c.name, appearanceVal || c.description || '', stylingVal || '', await getDramaStylePrompt(dramaId))
    } else {
      finalPrompt = buildFrontViewPrompt(c.name, appearanceVal || c.description || '', stylingVal || '', await getDramaStylePrompt(dramaId))
    }
    const patch: Record<string, any> = { finalPrompt, updatedAt: now() }
    if (appearance !== undefined) patch.appearance = appearance
    if (styling !== undefined) patch.styling = styling
    if (asset_code !== undefined) patch.assetCode = asset_code
    if (material_form !== undefined) patch.materialForm = material_form
    if (voice_description !== undefined) patch.voiceDescription = voice_description
    if (traits !== undefined) patch.traits = traits
    await db.update(schema.characters).set(patch).where(eq(schema.characters.id, character_id))

    return { character_id: c.id, character_name: c.name, saved: true, final_prompt: finalPrompt, traits: traits || '' }
  },
})

// ─── 9. 场景最终提示词 ───────────────────────────────────────
const readScenes = createTool({
  id: 'read_scenes',
  description: '读取当前剧集项目中的所有场景信息（含资产编号/素材形态），用于生成场景地点板（广角空镜、地理优先、无人物）最终提示词。',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const scenes = (await db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)))
      .filter(s => !s.deletedAt)
    return {
      drama: { visual_style: await getVisualStyle(dramaId) },
      scenes: scenes.map(s => ({
        id: s.id,
        location: s.location,
        time: s.time || '',
        prompt: s.prompt || '',
        lighting: s.lighting || '',
        asset_code: s.assetCode || '',
        material_form: s.materialForm || '',
        final_prompt: s.finalPrompt || '',
      })),
    }
  },
})

const saveSceneFinalPrompt = createTool({
  id: 'save_scene_final_prompt',
  description: '保存为场景创作的地点板（广角空镜、地理优先、无人物）最终提示词。项目视觉风格会由工具自动拼接，prompt 参数中不要包含风格词。',
  inputSchema: z.object({
    scene_id: z.number(),
    prompt: z.string().describe('场景地点板最终提示词（使用会话语言指令指定的目标语言；无人物空镜）'),
    asset_code: z.string().optional(),
    material_form: z.string().optional(),
  }),
  execute: async ({ scene_id, prompt, asset_code, material_form }, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const [s] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, scene_id))
    if (!s) return { error: 'Scene not found' }

    const stylePrompt = await getDramaStylePrompt(dramaId)
    const finalPrompt = stylePrompt ? `${stylePrompt}, ${prompt}` : prompt
    const patch: Record<string, any> = { finalPrompt, updatedAt: now() }
    if (asset_code !== undefined) patch.assetCode = asset_code
    if (material_form !== undefined) patch.materialForm = material_form
    await db.update(schema.scenes).set(patch).where(eq(schema.scenes.id, scene_id))

    return { scene_id: s.id, location: s.location, saved: true, final_prompt: finalPrompt }
  },
})

// ─── 10. 道具最终提示词 ──────────────────────────────────────
const readProps = createTool({
  id: 'read_props',
  description: '读取当前剧集项目中的所有道具信息（含资产编号/素材形态/视图模式），用于生成道具三视图道具板（正面/侧面/背面）或四视图设计板最终提示词。',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const props = (await db.select().from(schema.props).where(eq(schema.props.dramaId, dramaId)))
      .filter(p => !p.deletedAt)
    return {
      drama: { visual_style: await getVisualStyle(dramaId) },
      props: props.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type || '',
        description: p.description || '',
        sheet_mode: p.sheetMode || '',
        asset_code: p.assetCode || '',
        material_form: p.materialForm || '',
        final_prompt: p.finalPrompt || '',
      })),
    }
  },
})

const savePropFinalPrompt = createTool({
  id: 'save_prop_final_prompt',
  description: '保存为道具创作的最终提示词（三视图道具板或四视图设计板或正视图单品，按 sheet_mode 决定）。项目视觉风格会由工具自动拼接，prompt 参数中不要包含风格词。',
  inputSchema: z.object({
    prop_id: z.number(),
    prompt: z.string().describe('道具最终提示词（三视图道具板含正面/侧面/背面三视图要求，或四视图设计板含 SIDE/FRONT/TOP/3-4 VIEW 四格要求，或正视图单品；使用会话语言指令指定的目标语言）'),
    asset_code: z.string().optional(),
    material_form: z.string().optional(),
  }),
  execute: async ({ prop_id, prompt, asset_code, material_form }, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const [p] = await db.select().from(schema.props).where(eq(schema.props.id, prop_id))
    if (!p) return { error: 'Prop not found' }

    const stylePrompt = await getDramaStylePrompt(dramaId)
    const finalPrompt = stylePrompt ? `${stylePrompt}, ${prompt}` : prompt
    const patch: Record<string, any> = { finalPrompt, updatedAt: now() }
    if (asset_code !== undefined) patch.assetCode = asset_code
    if (material_form !== undefined) patch.materialForm = material_form
    await db.update(schema.props).set(patch).where(eq(schema.props.id, prop_id))

    return { prop_id: p.id, prop_name: p.name, saved: true, final_prompt: finalPrompt }
  },
})

// ─── 11. 资产台账（素材接线单 / 资产编号册） ────────────────
const saveAssetLedger = createTool({
  id: 'save_asset_ledger',
  description: '保存资产台账文本：《素材接线单》（kind=wiring_sheet，图号→类型→用途→你该挂哪张→不控制什么）或《资产编号册/图册》（kind=asset_roster）。同一项目同 kind 覆盖式保存（幂等 upsert）。',
  inputSchema: z.object({
    kind: z.enum(['wiring_sheet', 'asset_roster']),
    content: z.string().describe('台账完整 Markdown 文本（素材接线单含图号表格，每行必写「只控制什么/不控制什么」）'),
  }),
  execute: async ({ kind, content }, context) => {
    const dramaId = getDramaId(context?.requestContext)
    if (!dramaId) return { error: 'Missing dramaId in request context' }
    const episodeId = getEpisodeId(context?.requestContext) || undefined
    const ts = now()
    const existing = await db.select().from(schema.assetLedgers)
      .where(and(eq(schema.assetLedgers.dramaId, dramaId), eq(schema.assetLedgers.kind, kind)))
      .orderBy(schema.assetLedgers.id)

    if (existing.length) {
      await db.update(schema.assetLedgers)
        .set({ content, episodeId: episodeId ?? existing[0].episodeId, updatedAt: ts })
        .where(eq(schema.assetLedgers.id, existing[0].id))
      logTaskSuccess('AssetTool', 'save-ledger', { dramaId, kind, mode: 'update', length: content.length })
      return { kind, saved: true, updated: true, length: content.length }
    }

    await db.insert(schema.assetLedgers).values({
      dramaId,
      episodeId,
      kind,
      content,
      createdAt: ts,
      updatedAt: ts,
    })
    logTaskSuccess('AssetTool', 'save-ledger', { dramaId, kind, mode: 'create', length: content.length })
    return { kind, saved: true, created: true, length: content.length }
  },
})

export const assetTools = {
  readScriptForExtraction,
  readDramaPlot,
  readExistingCharacters,
  readExistingScenes,
  readExistingProps,
  saveDedupCharacters,
  saveDedupScenes,
  saveDedupProps,
  readCharacters,
  saveCharacterFinalPrompt,
  readScenes,
  saveSceneFinalPrompt,
  readProps,
  savePropFinalPrompt,
  saveAssetLedger,
}
