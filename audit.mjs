// 死代码与潜在问题扫描
import { readFileSync } from 'node:fs';

const files = [
  'extension/background.js', 'extension/content.js', 'extension/gloss.mjs',
  'extension/routing.js', 'extension/api-key-rotation.js', 'extension/srs.js',
  'extension/rule-pack.js', 'extension/conversation-store.js', 'extension/conversation-memory.js',
  'extension/api-key-pool.js', 'extension/lexicon.js',
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const f of files) {
  let s;
  try { s = readFileSync(f, 'utf8'); } catch { continue; }
  const imports = [...s.matchAll(/import\s*\{([^}]+)\}\s*from/g)]
    .flatMap(m => m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  const unused = imports.filter(name => {
    const uses = (s.match(new RegExp('\\b' + escapeRe(name) + '\\b', 'g')) || []).length;
    return uses <= 1;
  });
  if (unused.length) console.log(`死导入 ${f}: ${unused.join(', ')}`);
}
console.log('--- 死导入扫描完成 ---');

// 检查 console.log 残留（生产代码不应有调试输出）
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  const logs = (s.match(/console\.(log|debug|warn|error)/g) || []).length;
  if (logs > 0) console.log(`${f}: ${logs} 处 console 调用`);
}
console.log('--- console 扫描完成 ---');
