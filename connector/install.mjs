import {access,chmod,copyFile,mkdir,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {delimiter,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HOST = 'cc.ss_data.shisui_translate';
const source = dirname(fileURLToPath(import.meta.url));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
function options(args) {
  const result = {browsers:['chrome','edge'],uninstall:false};
  for (let i=0;i<args.length;i++) {
    const flag = args[i];
    if (flag === '--help') result.help = true;
    else if (flag === '--uninstall') result.uninstall = true;
    else if (['--extension-id','--codex','--browser'].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数。`);
      if (flag === '--extension-id') result.extensionId = value;
      if (flag === '--codex') result.codex = resolve(value);
      if (flag === '--browser') result.browsers = value.split(',');
    } else throw new Error(`未知参数：${flag}。运行 --help 查看用法。`);
  }
  return result;
}
async function findCodex(explicit) {
  const candidates = explicit ? [explicit] : (process.env.PATH || '').split(delimiter).filter(Boolean).map(path => join(path,'codex'));
  for (const path of candidates) {
    try { await access(path,constants.X_OK); return await realpath(path); } catch { /* Continue PATH lookup. */ }
  }
  throw new Error('未找到官方 Codex CLI。先运行 npm install -g @openai/codex，再重新安装连接器；也可使用 --codex 指定路径。');
}
async function extensionId(explicit) {
  if (explicit) {
    if (!/^[a-p]{32}$/.test(explicit)) throw new Error('扩展 ID 必须是 32 位 a–p 字母；请从插件设置中的安装命令复制。');
    return explicit;
  }
  const extension = await realpath(join(source,'../extension'));
  const manifest = JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
  const identity = manifest.key ? Buffer.from(manifest.key,'base64') : extension;
  return createHash('sha256').update(identity).digest('hex').slice(0,32).replace(/[0-9a-f]/g,char => String.fromCharCode(97+parseInt(char,16)));
}
function locations() {
  const home = homedir();
  if (process.platform === 'darwin') {
    const support = join(home,'Library/Application Support');
    return {root:join(support,'Shisui Translate'),browsers:{
      chrome:join(support,'Google/Chrome/NativeMessagingHosts'),
      edge:join(support,'Microsoft Edge/NativeMessagingHosts'),
      chromium:join(support,'Chromium/NativeMessagingHosts'),
      'chrome-testing':join(support,'Google/Chrome for Testing/NativeMessagingHosts'),
    }};
  }
  if (process.platform === 'linux') {
    const config = process.env.XDG_CONFIG_HOME || join(home,'.config');
    return {root:join(process.env.XDG_DATA_HOME || join(home,'.local/share'),'shisui-translate'),browsers:{
      chrome:join(config,'google-chrome/NativeMessagingHosts'),
      edge:join(config,'microsoft-edge/NativeMessagingHosts'),
      chromium:join(config,'chromium/NativeMessagingHosts'),
      'chrome-testing':join(config,'google-chrome-for-testing/NativeMessagingHosts'),
    }};
  }
  throw new Error('这个连接器安装程序支持 macOS 和 Linux。当前系统无法注册此连接器；未修改任何配置。');
}
async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help) {
    console.log('RelyLess · ChatGPT 订阅连接器\n\n安装：node connector/install.mjs [--extension-id ID] [--codex PATH]\n浏览器：--browser chrome,edge（默认）；另支持 chromium、chrome-testing\n卸载：node connector/install.mjs --uninstall [--browser chrome,edge]\n\n需要 Node.js 20+ 和官方 Codex CLI。仅注册当前用户，不需要管理员权限。\n卸载只移除指定浏览器的连接器注册；保留本机登录数据。要退出账户，请先在插件中退出登录。');
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要 Node.js 20 或更新版本。');
  const {root,browsers} = locations();
  const targets = [...new Set(opts.browsers)].map(name => {
    if (!browsers[name]) throw new Error(`不支持的浏览器：${name}。`);
    return join(browsers[name],`${HOST}.json`);
  });
  if (opts.uninstall) {
    for (const target of targets) {
      let existing;
      try { existing = JSON.parse(await readFile(target,'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (existing.name !== HOST || existing.path !== join(root,'launch')) throw new Error(`注册文件不属于此安装，未删除：${target}`);
      await rm(target);
      console.log(`已移除注册：${target}`);
    }
    console.log('已卸载所选浏览器的连接器注册。本机登录数据保留；其他浏览器不受影响。');
    return;
  }
  const id = await extensionId(opts.extensionId);
  const codexPath = await findCodex(opts.codex);
  const version = spawnSync(codexPath,['--version'],{encoding:'utf8',timeout:10000});
  if (version.status !== 0 || !/^codex-cli \d+\.\d+\.\d+/m.test(version.stdout || '')) throw new Error('无法运行官方 Codex CLI。请检查 Node.js 与 Codex 的安装。');
  const installed = join(root,'connector');
  const dataDir = join(root,'data');
  const configPath = join(root,'config.json');
  const launcher = join(root,'launch');
  const origin = `chrome-extension://${id}/`;
  // Refuse to replace another installation before changing any files.
  for (const target of targets) {
    let existing;
    try { existing = JSON.parse(await readFile(target,'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (existing.name !== HOST || existing.path !== launcher) throw new Error(`此位置已有其他连接器，未覆盖：${target}`);
  }
  await mkdir(installed,{recursive:true,mode:0o700});
  await mkdir(dataDir,{recursive:true,mode:0o700});
  await chmod(root,0o700);
  await chmod(dataDir,0o700);
  const files = (await readdir(source,{withFileTypes:true})).filter(entry => entry.isFile() && entry.name.endsWith('.mjs') && entry.name !== 'install.mjs');
  if (!files.some(entry => entry.name === 'host.mjs')) throw new Error('连接器源文件不完整，缺少 host.mjs。');
  for (const file of files) await copyFile(join(source,file.name),join(installed,file.name));
  await mkdir(join(root,'extension'),{recursive:true,mode:0o700});
  await Promise.all([
    copyFile(join(source,'../extension/gloss.mjs'),join(root,'extension/gloss.mjs')),
    copyFile(join(source,'../extension/assistance-stream.mjs'),join(root,'extension/assistance-stream.mjs')),
    copyFile(join(source,'../extension/diagnostics.mjs'),join(root,'extension/diagnostics.mjs')),
    copyFile(join(source,'../extension/personalization.mjs'),join(root,'extension/personalization.mjs')),
    copyFile(join(source,'../extension/sentence-groups.mjs'),join(root,'extension/sentence-groups.mjs')),
  ]);
  await writeFile(configPath,JSON.stringify({codexPath,dataDir,extensionOrigin:origin},null,2)+'\n',{mode:0o600});
  await chmod(configPath,0o600);
  await writeFile(launcher,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(installed,'host.mjs'))} --config ${quote(configPath)} "$@"\n`,{mode:0o700});
  await chmod(launcher,0o700);
  const manifest = JSON.stringify({name:HOST,description:'RelyLess ChatGPT 订阅本地连接器',path:launcher,type:'stdio',allowed_origins:[origin]},null,2)+'\n';
  for (const target of targets) {
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,manifest,{mode:0o600});
    console.log(`已注册：${target}`);
  }
  console.log(`\n扩展 ID：${id}\nCodex：${version.stdout.trim()}\n连接器：${root}\n\n安装 / 更新完成。重新加载扩展，进入“服务”，点击“刷新账户与模型”。\n已有登录数据保留，无需重新登录；仅首次使用或登录失效时才需要 ChatGPT 登录。\n更新连接器源码后也需重新运行此安装命令；安装后刷新连接会重启连接器，以加载新代码。\n升级 Node.js / Codex 或移动扩展目录后，请重新运行此安装命令。`);
}
main().catch(error => { console.error(`安装失败：${error.message}`); process.exitCode = 1; });
