import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const mainSrc = execSync('git show origin/main:extension/ui/options-service-catalog.js', {encoding: 'utf8'});
const pr9Src = readFileSync('extension/ui/options-service-catalog.js', 'utf8');

// 提取 PROVIDER_CATALOG_META 表里的 key → category
const metaOf = (src) => {
  const start = src.indexOf('PROVIDER_CATALOG_META');
  const table = src.slice(start, src.indexOf('\n};', start));
  return Object.fromEntries([...table.matchAll(/^\s*'?([a-zA-Z-]+)'?:\s*\{category:\s*'([a-z-]+)'/gm)].map(m => [m[1], m[2]]));
};
const mainMeta = metaOf(mainSrc);
const pr9Meta = metaOf(pr9Src);

console.log('main 键:', Object.keys(mainMeta).length, '| pr9 键:', Object.keys(pr9Meta).length);
console.log('pr9 缺失的键:', Object.keys(mainMeta).filter(k => !(k in pr9Meta)));
console.log('分类不同:', Object.entries(mainMeta).filter(([k, v]) => pr9Meta[k] && pr9Meta[k] !== v).map(([k, v]) => `${k}(main=${v},pr9=${pr9Meta[k]})`));
