import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('character image generation uses 16:9 asset size', () => {
  const source = read('src/routes/characters.ts')

  assert.match(source, /CHARACTER_IMAGE_SIZE = '1920x1080'/)
  assert.match(source, /16:9 横屏 2x2 四格：面部特写 \/ 无脸正面全身 \/ 90°侧面全身 \/ 背面全身/)
  assert.match(source, /size: CHARACTER_IMAGE_SIZE/)
})
