import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const exists = (path) => existsSync(new URL(path, root))

test('backend no longer exposes the grid image API or split service', () => {
  const index = read('src/index.ts')

  assert.doesNotMatch(index, /routes\/grid/)
  assert.doesNotMatch(index, /api\.route\('\/grid'/)
  assert.equal(exists('src/routes/grid.ts'), false)
  assert.equal(exists('src/services/grid-split.ts'), false)
})

test('asset agent keeps role/scene/prop prompts but removes grid prompt mode', () => {
  const agents = read('src/agents/index.ts')
  const skills = read('src/agents/skills.ts')
  const assetTools = read('src/agents/tools/asset-tools.ts')
  const storyboardTools = read('src/agents/tools/storyboard-tools.ts')
  const skill = read('workspace/skills/asset/SKILL.md')

  assert.match(agents, /asset/)
  assert.match(skills, /asset/)
  assert.match(assetTools, /save_character_final_prompt/)
  assert.match(assetTools, /save_scene_final_prompt/)
  assert.doesNotMatch(agents, /宫格图/)
  assert.doesNotMatch(agents, /read_shots_for_grid/)
  assert.doesNotMatch(agents, /generate_grid_prompt/)
  assert.doesNotMatch(assetTools, /宫格图/)
  assert.doesNotMatch(assetTools, /read_shots_for_grid/)
  assert.doesNotMatch(assetTools, /generate_grid_prompt/)
  assert.doesNotMatch(storyboardTools, /generate_grid_prompt/)
  assert.doesNotMatch(storyboardTools, /宫格图/)
  assert.doesNotMatch(skill, /宫格图/)
  assert.doesNotMatch(skill, /grid layout/)
})
