/**
 * 风格预设服务 — 将项目绑定的视觉风格解析为英文提示词片段
 * dramas.style 存 style_presets.value；查不到/已停用时返回空串（调用方走兜底）
 */
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

/** 查询项目绑定的风格预设英文提示词片段；查不到返回 '' */
export async function getDramaStylePrompt(dramaId: number | null | undefined): Promise<string> {
  const info = await getDramaStyleInfo(dramaId)
  return info?.prompt || ''
}

/** 查询项目绑定的风格预设完整信息（中文名 / 描述 / 英文 prompt 片段）；查不到返回 null */
export async function getDramaStyleInfo(dramaId: number | null | undefined): Promise<{ name: string; description: string; prompt: string } | null> {
  if (!dramaId) return null
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama?.style) return null
  const [preset] = await db.select().from(schema.stylePresets)
    .where(and(eq(schema.stylePresets.value, drama.style), eq(schema.stylePresets.isActive, true)))
  if (!preset) return null
  return { name: preset.name, description: preset.description || '', prompt: preset.prompt || '' }
}
