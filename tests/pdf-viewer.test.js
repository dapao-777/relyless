import {expect,test} from 'bun:test';
import {isolatedChrome,isolatedSend} from './helpers/chrome-fixture.js';

// PDF 阅读页是扩展页：sender.tab.url 为 chrome-extension://…pdf-viewer.html?src=<文档>，
// readingSource 应把它放行并把文档地址作为身份来源，其余扩展页仍被拒绝。
const chromeBefore=globalThis.chrome;
const fixture=isolatedChrome({});
const viewerUrl='chrome-extension://'+fixture.id+'/pdf-viewer.html?src='+encodeURIComponent('https://docs.example/paper.pdf');
fixture.api.tabs.get=async()=>({id:91,url:viewerUrl,active:true,title:'RelyLess PDF 阅读'});
globalThis.chrome=fixture.api;
globalThis.fetch=async()=>{throw new TypeError('offline');};
await import('../extension/background.js?pdf-viewer='+Date.now());

const viewerSender={id:fixture.id,url:viewerUrl,tab:{id:91}};

test('pdf viewer page is accepted as a reading source',async()=>{
  const result=await isolatedSend(fixture,{type:'RESOLVE_DOMAIN',text:'A short English paragraph for domain detection.',explicit:true,immediate:true},viewerSender);
  expect(result.domain).toBeTruthy();
});

test('other extension pages are still rejected as reading sources',async()=>{
  const other='chrome-extension://'+fixture.id+'/ui/options.html';
  fixture.api.tabs.get=async()=>({id:91,url:other,active:true});
  await expect(isolatedSend(fixture,{type:'RESOLVE_DOMAIN',text:'text',explicit:true,immediate:true},{id:fixture.id,url:other,tab:{id:91}})).rejects.toThrow('不支持阅读辅助');
  fixture.api.tabs.get=async()=>({id:91,url:viewerUrl,active:true,title:'RelyLess PDF 阅读'});
});

test('viewer sender URL mismatch still rejects as page switched',async()=>{
  const moved=viewerUrl+'&extra=1';
  await expect(isolatedSend(fixture,{type:'RESOLVE_DOMAIN',text:'text',explicit:true,immediate:true},{id:fixture.id,url:moved,tab:{id:91}})).rejects.toThrow('重新操作');
});

test('viewer tab can arm an emergency translation session without page injection',async()=>{
  const result=await isolatedSend(fixture,{type:'EMERGENCY_BEGIN',tabId:91,url:viewerUrl,confirmed:true},{id:fixture.id,url:'chrome-extension://'+fixture.id+'/ui/options.html'});
  expect(typeof result.token).toBe('string');
});

// 真实 Chrome 中扩展页对 chrome.tabs 不暴露 url：EMERGENCY_BEGIN 须回落 sender.url 校验。
test('extension page without visible tab.url arms via sender.url fallback',async()=>{
  fixture.api.tabs.get=async()=>({id:92,active:true});
  const realViewer='chrome-extension://'+fixture.id+'/pdf-viewer.html?src='+encodeURIComponent('https://docs.example/no-tab-url.pdf');
  const result=await isolatedSend(fixture,{type:'EMERGENCY_BEGIN',tabId:92,url:realViewer,confirmed:true},{id:fixture.id,url:realViewer,tab:{id:92}});
  expect(typeof result.token).toBe('string');
  fixture.api.tabs.get=async()=>({id:91,url:viewerUrl,active:true,title:'RelyLess PDF 阅读'});
});

test('pdfReader defaults off and only an explicit true enables it',async()=>{
  const {normalizeSettings}=await import('../extension/shared.js');
  expect(normalizeSettings({}).pdfReader).toBe(false);
  expect(normalizeSettings({pdfReader:true}).pdfReader).toBe(true);
  expect(normalizeSettings({pdfReader:'yes'}).pdfReader).toBe(false);
});

test.afterAll?.(()=>{globalThis.chrome=chromeBefore;});
