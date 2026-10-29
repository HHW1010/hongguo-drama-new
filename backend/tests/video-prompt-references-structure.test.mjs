import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('feed video prompt uses 七段式 with @SCN/@CHR/@PRP asset references', () => {
  const agents = read('src/agents/index.ts')
  const skill = read('workspace/skills/feed/SKILL.md')

  // 七段式字段顺序（唯一命名）
  assert.match(agents, /【画幅风格】/)
  assert.match(agents, /【场景资产】/)
  assert.match(agents, /【核心人物】/)
  assert.match(agents, /【站位声明】/)
  assert.match(agents, /【时间轴分镜】/)
  assert.match(agents, /【音效】/)
  assert.match(agents, /【强制禁止项】/)
  // 资产引用：@SCN/@CHR/@PRP + 参考图号（与接线单双向一致）
  assert.match(agents, /@SCN-/)
  assert.match(agents, /@CHR-/)
  assert.match(agents, /@PRP-/)

  // SKILL.md 同步
  assert.match(skill, /【画幅风格】/)
  assert.match(skill, /【时间轴分镜】/)
  assert.match(skill, /@SCN-/)
  assert.match(skill, /@CHR-/)
  assert.match(skill, /@PRP-/)
})
