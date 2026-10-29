const Database = require('better-sqlite3');
const db = new Database('../data/huobao.sqlite3', { readonly: true });

function dump(dramaId, label) {
  const rows = db.prepare('SELECT id, name, role, appearance, styling, description, sheet_mode, asset_code, material_form, voice_description, final_prompt FROM characters WHERE drama_id=? AND deleted_at IS NULL ORDER BY id').all(dramaId);
  console.log(`\n===== ${label} (drama ${dramaId}) =====`);
  for (const c of rows) {
    console.log(`\n#${c.id} ${c.name}  role=${c.role || ''}  sheet_mode=${c.sheet_mode || ''}  asset_code=${c.asset_code || ''}  material_form=${c.material_form || ''}`);
    if (c.appearance) console.log(`  appearance: ${c.appearance}`);
    if (c.styling) console.log(`  styling: ${c.styling}`);
    if (c.description) console.log(`  description: ${c.description}`);
    if (c.voice_description) console.log(`  voice: ${c.voice_description}`);
    if (c.final_prompt) console.log(`  final_prompt[${c.final_prompt.length}]: ${c.final_prompt.slice(0, 200)}...`);
  }
}

dump(1, '扛楼');
dump(2, '神豪系统');
