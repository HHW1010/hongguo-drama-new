/**
 * 批量资产最终提示词任务 — 异步为当前集全部角色/场景/道具逐个运行 asset Agent「强制重新生成」最终提示词。
 * 声音（voice_description）不在本任务范围：只生成图片参考图最终提示词，不触碰音色字段。
 * 进程内内存态：按集跟踪一份任务，运行中不重复启动；重启后状态丢失。
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { ensureCharacterFinalPrompt, ensureSceneFinalPrompt, ensurePropFinalPrompt } from './final-prompt.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

export interface AssetPromptBatchStatus {
  status: 'running' | 'done' | 'error'
  total: number
  completed: number
  failed: number
  current_kind?: 'character' | 'scene' | 'prop'
  current_name?: string
  started_at: string
  finished_at?: string
  error?: string
}

const tasks = new Map<number, AssetPromptBatchStatus>()

/** 启动批量强制重新生成（立即返回）；运行中返回 started:false,total:-1；无资产返回 started:false,total:0 */
export async function startAssetPromptBatch(
  episodeId: number,
  dramaId: number,
  opts: { model?: string; configId?: number } = {},
): Promise<{ started: boolean; total: number }> {
  if (tasks.get(episodeId)?.status === 'running') return { started: false, total: -1 }

  const charLinks = await db.select().from(schema.episodeCharacters).where(eq(schema.episodeCharacters.episodeId, episodeId))
  const charIds = new Set(charLinks.map(l => l.characterId))
  const sceneLinks = await db.select().from(schema.episodeScenes).where(eq(schema.episodeScenes.episodeId, episodeId))
  const sceneIds = new Set(sceneLinks.map(l => l.sceneId))
  const propLinks = await db.select().from(schema.episodeProps).where(eq(schema.episodeProps.episodeId, episodeId))
  const propIds = new Set(propLinks.map(l => l.propId))

  const allChars = (await db.select().from(schema.characters)).filter(c => charIds.has(c.id) && !c.deletedAt)
  const allScenes = (await db.select().from(schema.scenes)).filter(s => sceneIds.has(s.id) && !s.deletedAt)
  const allProps = (await db.select().from(schema.props)).filter(p => propIds.has(p.id) && !p.deletedAt)

  // 强制全部重新生成：所有关联资产都重跑，已有提示词也覆盖（声音不在此列，不触碰 voice_description）
  const total = allChars.length + allScenes.length + allProps.length
  if (!total) return { started: false, total: 0 }

  const task: AssetPromptBatchStatus = {
    status: 'running',
    total,
    completed: 0,
    failed: 0,
    started_at: new Date().toISOString(),
  }
  tasks.set(episodeId, task)

  logTaskStart('AssetPrompt', 'batch', { episodeId, dramaId, total, model: opts.model || undefined })
  ;(async () => {
    const run = async (kind: 'character' | 'scene' | 'prop', fn: () => Promise<string>, label: string) => {
      task.current_kind = kind
      task.current_name = label
      logTaskProgress('AssetPrompt', 'batch-item', { episodeId, kind, label, index: task.completed + task.failed + 1, total: task.total })
      try {
        const fp = await fn()
        if ((fp || '').trim()) task.completed++
        else {
          task.failed++
          logTaskError('AssetPrompt', 'batch-item', { episodeId, kind, label, error: 'agent finished but final_prompt is empty' })
        }
      } catch (err: any) {
        task.failed++
        logTaskError('AssetPrompt', 'batch-item', { episodeId, kind, label, error: err?.message })
      }
    }

    for (const c of allChars) {
      await run('character', () => ensureCharacterFinalPrompt(c, episodeId, true, opts, c.sheetMode || ''), c.name)
    }
    for (const s of allScenes) {
      await run('scene', () => ensureSceneFinalPrompt(s, episodeId, true, opts), s.location)
    }
    for (const p of allProps) {
      await run('prop', () => ensurePropFinalPrompt(p, episodeId, true, opts, p.sheetMode || ''), p.name)
    }
  })()
    .then(() => {
      task.status = 'done'
      task.finished_at = new Date().toISOString()
      task.current_kind = undefined
      task.current_name = undefined
      logTaskSuccess('AssetPrompt', 'batch', { episodeId, total: task.total, completed: task.completed, failed: task.failed })
    })
    .catch((err: any) => {
      task.status = 'error'
      task.finished_at = new Date().toISOString()
      task.error = err?.message || '批量强制重生成失败'
      logTaskError('AssetPrompt', 'batch', { episodeId, error: err?.message })
    })

  return { started: true, total }
}

export function getAssetPromptBatchStatus(episodeId: number): AssetPromptBatchStatus | null {
  return tasks.get(episodeId) || null
}
