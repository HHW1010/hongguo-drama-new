// 一次性脚本：把「3d」风格预设的英文提示词固定为用户指定的 3D CG 风格串
const Database = require('better-sqlite3')

const NEW_PROMPT = 'high-quality 3D CG animation still, modern game-engine cinematic render, Unreal Engine and Pixar grade quality, semi-realistic stylized characters with refined facial features, clean sculpted anatomy, detailed skin shader with subtle subsurface scattering, PBR materials with crisp detailed textures, volumetric cinematic lighting with soft rim light, rich depth of field, polished film color grading, detailed environment art, sharp focus, consistent character design across shots, 8K resolution, 85mm prime lens, f/2.0 aperture, clean cinematic composition, soft key light from camera-left with gentle ambient bounce fill, bright clean exposure, high dynamic range, soft filmic highlight rolloff, volumetric light shafts with visible dust motes, physically-based surface response, sharp micro-normal detail, individual hair strands with natural falloff, soft cloth simulation with physically accurate folds, expressive readable face, crisp pinpoint catchlights in the eyes, fine iris texture, unified color palette and lighting direction across the sequence, avoid flat lighting, avoid plastic waxy skin, avoid low-poly blurry look, avoid 2D flat cel shading, avoid anime line art, avoid flat color blocks, avoid harsh uniform ambient fill, avoid oily shiny skin, avoid over-smoothed skin, avoid influencer face, avoid uncanny valley, avoid cheap game-cinematic glow, avoid excessive bloom, avoid oversaturated colors, avoid underexposure, avoid film grain, avoid chromatic aberration, avoid deformed hands, avoid extra fingers, avoid extra limbs, avoid garbled text, avoid subtitles, avoid watermark, avoid logo'

const db = new Database('../data/huobao.sqlite3')

const before = db.prepare("SELECT id, name, value, prompt FROM style_presets WHERE value = '3d'").get()
if (!before) {
  console.error('no 3d style preset found')
  process.exit(1)
}
console.log('BEFORE #' + before.id, before.name, 'len=' + before.prompt.length)

const now = new Date().toISOString()
const info = db.prepare('UPDATE style_presets SET prompt = ?, updated_at = ? WHERE value = ?').run(NEW_PROMPT, now, '3d')
console.log('updated rows:', info.changes)

const after = db.prepare("SELECT id, name, value, length(prompt) as len, prompt FROM style_presets WHERE value = '3d'").get()
console.log('AFTER  #' + after.id, after.name, 'len=' + after.len)
console.log('---- new prompt ----')
console.log(after.prompt)
