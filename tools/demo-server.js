import { resolve } from 'node:path';
const root = resolve(import.meta.dir,'..');
const port = Number(process.env.PORT || 4173);
Bun.serve({
  hostname:'127.0.0.1',port,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path !== '/' && path !== '/demo.html') return new Response('Not found',{status:404});
    const file = Bun.file(resolve(root,'demo.html'));
    if (!await file.exists()) return new Response('Reading example is unavailable',{status:404});
    return new Response(file,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  },
});
console.log(`阅读示例：http://127.0.0.1:${port} — 在此页点击插件图标，开启阅读辅助。`);
