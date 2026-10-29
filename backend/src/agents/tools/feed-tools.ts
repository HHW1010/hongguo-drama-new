/**
 * 七段式投喂 Agent 工具（manju-laoli 投喂层 sd-feed-engine）
 * 模块级单例 — episodeId + dramaId 通过 RequestContext 按请求注入
 *
 * 把分镜稿（description + dialogue + atmosphere + 绑定的场景/角色/道具 + 素材接线单）
 * 封装为 manju-laoli 七段式投喂提示词（video_prompt）：
 * 【画幅风格】→【场景资产】→【核心人物】→【站位声明】→【时间轴分镜】→【音效】→【强制禁止项】
 */
import { createTool } from '@mastra/core/tools'
import type { ToolExecutionContext } from '@mastra/core/tools'
import { z } from 'zod'
import { db, schema } from '../../db/index.js'
import { eq, and } from 'drizzle-orm'
import { now } from '../../utils/response.js'
import { logTaskSuccess } from '../../utils/task-logger.js'
import { getDramaId, getEpisodeId } from '../context.js'
import { validateVideoPrompt, gateCheck } from '../../services/machine-check.js'

type ToolContext = ToolExecutionContext | undefined

function requireIds(context: ToolContext): { episodeId: number; dramaId: number } | { error: string } {
  const episodeId = getEpisodeId(context?.requestContext)
  const dramaId = getDramaId(context?.requestContext)
  if (!episodeId || !dramaId) return { error: 'Missing episodeId/dramaId in request context' }
  return { episodeId, dramaId }
}

/** 读取投喂所需上下文：分镜稿 + 资产（含图号/素材形态/音色）+ 素材接线单 */
const readFeedContext = createTool({
  id: 'read_feed_context',
  description: '读取七段式投喂所需上下文：本集分镜（description/dialogue/atmosphere/duration/绑定）、资产（角色/场景/道具含图号 asset_code 与素材形态）、以及《素材接线单》台账文本。',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids

    const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
    if (!ep) return { error: 'Episode not found' }

    const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))

    const sbs = await db.select().from(schema.storyboards)
      .where(eq(schema.storyboards.episodeId, episodeId))
      .orderBy(schema.storyboards.storyboardNumber)

    const chars = (await db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)))
      .filter(c => !c.deletedAt)
    const scns = (await db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)))
      .filter(s => !s.deletedAt)
    const prps = (await db.select().from(schema.props).where(eq(schema.props.dramaId, dramaId)))
      .filter(p => !p.deletedAt)

    const ledgers = await db.select().from(schema.assetLedgers)
      .where(and(eq(schema.assetLedgers.dramaId, dramaId), eq(schema.assetLedgers.kind, 'wiring_sheet')))
      .orderBy(schema.assetLedgers.id)

    const storyboardPayload = await Promise.all(sbs
      .filter(sb => !sb.deletedAt)
      .map(async (sb) => {
        const charLinks = await db.select().from(schema.storyboardCharacters)
          .where(eq(schema.storyboardCharacters.storyboardId, sb.id))
        const propLinks = await db.select().from(schema.storyboardProps)
          .where(eq(schema.storyboardProps.storyboardId, sb.id))
        return {
          id: sb.id,
          shot_number: sb.storyboardNumber,
          title: sb.title || '',
          scene_id: sb.sceneId,
          character_ids: charLinks.map(link => link.characterId),
          prop_ids: propLinks.map(link => link.propId),
          shot_type: sb.shotType || '',
          angle: sb.angle || '',
          movement: sb.movement || '',
          duration: sb.duration || 0,
          description: sb.description || '',
          dialogue: sb.dialogue || '',
          atmosphere: sb.atmosphere || '',
          video_prompt: sb.videoPrompt || '',
        }
      }))

    const payload = {
      episode: { id: ep.id, title: ep.title, episode_number: ep.episodeNumber },
      // 生产锁（六道前置锁中的 B 画幅 / A 模型版本 / 年代锚）— 由用户在剧集设置中配置
      locks: {
        aspect_ratio: drama?.aspectRatio || '16:9',
        model_version: drama?.modelVersion || 'seedance-2.5',
        era_anchor: drama?.eraAnchor || '',
      },
      characters: chars.map(c => ({
        id: c.id, name: c.name, role: c.role || '',
        asset_code: c.assetCode || '', material_form: c.materialForm || '',
        voice_description: c.voiceDescription || '',
        appearance: c.appearance || '', styling: c.styling || '',
        image_url: c.imageUrl || '',
      })),
      scenes: scns.map(s => ({
        id: s.id, location: s.location, time: s.time || '',
        asset_code: s.assetCode || '', material_form: s.materialForm || '',
        image_url: s.imageUrl || '',
      })),
      props: prps.map(p => ({
        id: p.id, name: p.name, type: p.type || '',
        asset_code: p.assetCode || '', material_form: p.materialForm || '',
        image_url: p.imageUrl || '',
      })),
      storyboards: storyboardPayload,
      wiring_sheet: ledgers[0]?.content || '',
    }
    logTaskSuccess('FeedTool', 'read-context', {
      episodeId, dramaId,
      storyboards: storyboardPayload.length,
      wiringSheet: ledgers[0] ? 'present' : 'missing',
    })
    return payload
  },
})

/** 保存某分镜的七段式投喂提示词（video_prompt），可选同步 dialogue */
const saveVideoPrompt = createTool({
  id: 'save_video_prompt',
  description: '保存某分镜的七段式投喂提示词（video_prompt）到 storyboard_id。只传 storyboard_id 与 video_prompt 两个键（可选 dialogue），不要回传该分镜其他字段。',
  inputSchema: z.object({
    storyboard_id: z.number(),
    video_prompt: z.string(),
    dialogue: z.string().optional(),
  }),
  execute: async ({ storyboard_id, video_prompt, dialogue }, context) => {
    const ids = requireIds(context)
    if ('error' in ids) return ids
    const { episodeId, dramaId } = ids

    const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboard_id))
    if (!sb) return { error: `Storyboard ${storyboard_id} not found` }

    const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))

    // 生产锁映射：seedance-2.5 → '2.5' · seedance-2.0 → '2.0'（其余按 2.5 判）
    const modelVersion = drama?.modelVersion || 'seedance-2.5'
    const model = modelVersion.includes('2.0') ? ('2.0' as const) : ('2.5' as const)
    const aspect = drama?.aspectRatio || null

    // 资产库大小（角色 + 场景 + 道具，各占一个图号）— 供闸门6A 编号越界判定
    const charCount = (await db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId)))
      .filter(c => !c.deletedAt).length
    const sceneCount = (await db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId)))
      .filter(s => !s.deletedAt).length
    const propCount = (await db.select().from(schema.props).where(eq(schema.props.dramaId, dramaId)))
      .filter(p => !p.deletedAt).length
    const assets = charCount + sceneCount + propCount

    // 全量机检（C1~C30 Seedance 侧 + 六道闸门）—— 结果回传 feed agent 自纠
    const check = validateVideoPrompt(video_prompt, {
      model,
      track: '1',
      combat: 'auto',
      c23: 'auto',
      styleSource: null,
      aspect,
      plugin: 'auto',
    })
    const gate = gateCheck(video_prompt, { model, assets, mode: 'auto' })

    const patch: Record<string, any> = { videoPrompt: video_prompt, updatedAt: now() }
    if (dialogue !== undefined) patch.dialogue = dialogue
    await db.update(schema.storyboards).set(patch).where(eq(schema.storyboards.id, storyboard_id))

    logTaskSuccess('FeedTool', 'save-video-prompt', {
      storyboardId: storyboard_id,
      length: video_prompt.length,
      episodeId,
      passed: check.passed && gate.passed,
      issues: check.issues.length + gate.fails.length,
      warns: check.warns.length + gate.warns.length,
    })
    return {
      storyboard_id,
      saved: true,
      check: {
        passed: check.passed && gate.passed,
        issues: [...check.issues, ...gate.fails],
        warns: [...check.warns, ...gate.warns],
        blockingWarns: check.blockingWarns,
        stats: check.stats,
        gate: { passed: gate.passed, units: gate.units, mode: gate.mode },
      },
    }
  },
})

export const feedTools = { readFeedContext, saveVideoPrompt }
