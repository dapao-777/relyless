import {afterAll,beforeAll,expect,test} from 'bun:test';

const event = () => ({listeners:[],addListener(listener) { this.listeners.push(listener); }});
const runtimeMessage = event();
const stored = {wordSchemaVersion:4,productSchemaVersion:1,words:[],supportDataGeneration:0,settings:{providerKind:'api',provider:{baseUrl:'https://api.example/v1',model:'fixture',apiKey:'key'}}};
const session = {};
const granted = new Set();
const registrations = [];
const tab = {id:11,windowId:7,url:'https://docs.example/article',title:'Fixture',active:true};
let tabGetBarrier = null;
const tabMessages = [];
const popupOpens = [];
const actionTitles = [];
let popupFailure = null;
let modelCalls = 0;
const fetchBefore = globalThis.fetch;
globalThis.fetch = async()=>{modelCalls++;throw new Error('unexpected model call');};
const pick = (source,keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(source,key)).map(key => [key,source[key]]));
const covered = requested => [...granted].some(pattern => {
  if (pattern === requested) return true;
  if (pattern === 'https://*/*') return requested.startsWith('https://');
  if (pattern === 'http://*/*') return requested.startsWith('http://');
  return false;
});
const chromeBefore = globalThis.chrome;

globalThis.chrome = {
  runtime:{id:'activation-fixture',getURL:path => `chrome-extension://activation-fixture/${path}`,lastError:null,onMessage:runtimeMessage,onConnect:event(),onInstalled:event(),onStartup:event(),sendMessage:async()=>{},openOptionsPage:async()=>{}},
  storage:{
    local:{setAccessLevel:async()=>{},get:async keys=>pick(stored,keys),set:async value=>Object.assign(stored,value),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete stored[key];}},
    session:{get:async keys=>keys===null?{...session}:pick(session,keys),set:async value=>Object.assign(session,value),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete session[key];}},
  },
  permissions:{
    contains:async ({origins})=>origins.every(covered),
    remove:async ({origins})=>{origins.forEach(origin=>granted.delete(origin));return true;},
    onAdded:event(),onRemoved:event(),
  },
  tabs:{
    onRemoved:event(),onUpdated:event(),query:async query=>query?.active ? [tab] : [tab],get:async id=>{if(tabGetBarrier) await tabGetBarrier;return id === tab.id ? tab : null;},
    sendMessage:async (tabId,message)=>{tabMessages.push({tabId,message});return {ok:true,data:{enabled:false}};},
  },
  scripting:{
    executeScript:async options=>options.func ? [{result:true}] : [],
    getRegisteredContentScripts:async()=>registrations.map(value=>({...value})),
    unregisterContentScripts:async ({ids})=>{for (const id of ids) {const index=registrations.findIndex(item=>item.id===id);if(index>=0) registrations.splice(index,1);}},
    registerContentScripts:async scripts=>{registrations.push(...scripts);},
  },
  contextMenus:{onClicked:event(),removeAll:async()=>{},create:(_options,callback)=>callback()},
  commands:{onCommand:event()},action:{openPopup:async options=>{popupOpens.push(options);if(popupFailure)throw popupFailure;},setBadgeText:async()=>{},setTitle:async options=>{actionTitles.push(options);},setBadgeBackgroundColor:async()=>{}},
};

await import(`../extension/background.js?activation=${Date.now()}`);
const extensionSender = {id:'activation-fixture',url:'chrome-extension://activation-fixture/ui/popup.html'};
const pageSender = {id:'activation-fixture',url:tab.url,tab,frameId:0};
const send = (message,sender=extensionSender) => new Promise((resolve,reject) => {
  runtimeMessage.listeners[0](message,sender,response => response.ok ? resolve(response.data) : reject(new Error(response.error)));
});

beforeAll(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
afterAll(()=>{globalThis.chrome=chromeBefore;globalThis.fetch=fetchBefore;});

test('automation is not persisted until its exact host permission exists',async()=>{
  await expect(send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sites:[{origin:'https://docs.example',enabled:true}]}})).rejects.toThrow('权限');
  expect(stored.settings.automation).toEqual({allSites:false,sentenceGroupsAllSites:false,sites:[],videoSites:false});

  granted.add('https://docs.example/*');
  const result = await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sites:[{origin:'https://docs.example',enabled:true}]}});
  expect(result).toMatchObject({origin:'https://docs.example',siteRule:true,effective:true,paused:false});
  expect(registrations).toEqual([{id:'ss-auto-start',matches:['https://docs.example/*'],js:['auto-start.js'],runAt:'document_start',allFrames:false,persistAcrossSessions:true}]);
  expect(tabMessages.at(-1).message).toEqual({type:'SS_AUTO_START',origin:'https://docs.example',reading:true,video:false,sentenceGroups:false,paused:false,assistanceMode:'ambient'});
  granted.delete('https://docs.example/*');
  globalThis.chrome.permissions.onRemoved.listeners.forEach(listener=>listener({origins:['https://docs.example/*']}));
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(tabMessages.at(-1).message).toEqual({type:'SS_AUTO_START',origin:'https://docs.example',reading:false,video:false,sentenceGroups:false,paused:false,assistanceMode:'ambient'});

  granted.add('https://docs.example/*');
  globalThis.chrome.permissions.onAdded.listeners.forEach(listener=>listener({origins:['https://docs.example/*']}));
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(tabMessages.at(-1).message.reading).toBe(true);
});

test('manual page pause survives in session and does not recursively broadcast a policy',async()=>{
  const before = tabMessages.length;
  expect(await send({type:'PAGE_ACTIVITY_SET',enabled:false},pageSender)).toEqual({paused:true});
  expect(tabMessages.length).toBe(before);
  expect(session['automationPaused:'+tab.id]).toBe(true);
  expect(await send({type:'AUTOMATION_GET',tabId:tab.id})).toMatchObject({effective:false,paused:true,siteRule:true});
  expect(await send({type:'PAGE_ACTIVITY_SET',enabled:true},pageSender)).toEqual({paused:false});
  expect(session['automationPaused:'+tab.id]).toBeUndefined();
});
test('concurrent pause writes use independent tab session keys',async()=>{
  const other = {id:12,url:'https://other.example/page'};
  await Promise.all([
    send({type:'PAGE_ACTIVITY_SET',enabled:false},pageSender),
    send({type:'PAGE_ACTIVITY_SET',enabled:false},{id:'activation-fixture',url:other.url,tab:other,frameId:0}),
  ]);
  expect(session).toMatchObject({['automationPaused:'+tab.id]:true,['automationPaused:'+other.id]:true});
  await Promise.all([
    send({type:'PAGE_ACTIVITY_SET',enabled:true},pageSender),
    send({type:'PAGE_ACTIVITY_SET',enabled:true},{id:'activation-fixture',url:other.url,tab:other,frameId:0}),
  ]);
});

test('concurrent partial automation patches merge against serialized state and revoked rules may shrink',async()=>{
  granted.add('https://www.youtube.com/*');
  granted.add('https://m.youtube.com/*');
  await Promise.all([
    send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{allSites:false}}),
    send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{videoSites:true}}),
  ]);
  await Promise.all([
    send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sites:[]}}),
    send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sites:[{origin:'https://docs.example',enabled:true}]}}),
  ]);
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(stored.settings.automation.sites).toEqual([{origin:'https://docs.example',enabled:true}]);
  expect(granted.has('https://docs.example/*')).toBe(true);
  expect(stored.settings.automation).toMatchObject({videoSites:true,sites:[{origin:'https://docs.example',enabled:true}]});

  granted.delete('https://docs.example/*');
  await expect(send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sites:[]}})).resolves.toMatchObject({siteRule:null,effective:false});
  granted.add('https://docs.example/*');
  await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sites:[{origin:'https://docs.example',enabled:true}]}});
});
test('stale activation work cannot send a policy across an origin navigation',async()=>{
  let release;
  tabGetBarrier = new Promise(resolve=>{release=resolve;});
  const before = tabMessages.length;
  globalThis.chrome.tabs.onUpdated.listeners[0](tab.id,{status:'complete'},{...tab});
  tab.url = 'https://excluded.example/page';
  tabGetBarrier = null;
  release();
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(tabMessages.length).toBe(before);
  tab.url = 'https://docs.example/article';
});

test('main-frame video patches deep merge, persist, and use the dedicated broadcast',async()=>{
  const [first,second] = await Promise.all([
    send({type:'VIDEO_SETTINGS_PATCH',patch:{fontSize:24}},pageSender),
    send({type:'VIDEO_SETTINGS_PATCH',patch:{theme:'dark'}},pageSender),
  ]);
  expect(first).toEqual({video:{fontSize:24,theme:'auto'}});
  expect(second).toEqual({video:{fontSize:24,theme:'dark'}});
  expect(stored.settings.video).toEqual(second.video);
  expect(tabMessages.at(-1).message).toEqual({type:'SS_VIDEO_SETTINGS',video:second.video});
  await expect(send({type:'VIDEO_SETTINGS_PATCH',patch:{fontSize:22}},pageSender)).rejects.toThrow('字号');
});

test('sentence groups automation honors exclusions, pause, permission, manual override, and navigation boundaries',async()=>{
  granted.add('http://*/*');granted.add('https://*/*');
  let result=await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sentenceGroupsAllSites:true,sites:[]}});
  expect(result).toMatchObject({sentenceGroups:true,sentenceGroupsEffective:true});
  expect(session['sentenceGroupsMode:'+tab.id]).toMatchObject({enabled:true,source:'auto'});
  expect(tabMessages.at(-1).message).toMatchObject({reading:true,sentenceGroups:true,paused:false});

  await send({type:'PAGE_ACTIVITY_SET',enabled:false},pageSender);
  await send({type:'AUTO_BOOTSTRAP_CHECK'},pageSender);
  expect(await send({type:'AUTOMATION_GET',tabId:tab.id})).toMatchObject({sentenceGroups:false,paused:true});
  expect(tabMessages.at(-1).message).toMatchObject({reading:false,sentenceGroups:false,paused:true});
  expect(session['sentenceGroupsMode:'+tab.id]).toMatchObject({enabled:true,source:'auto'});
  await send({type:'PAGE_ACTIVITY_SET',enabled:true},pageSender);

  await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sites:[{origin:'https://docs.example',enabled:false}]}});
  expect(await send({type:'AUTOMATION_GET',tabId:tab.id})).toMatchObject({siteRule:false,sentenceGroups:false});
  expect(session['sentenceGroupsMode:'+tab.id]).toBeUndefined();
  await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sites:[]}});
  expect(session['sentenceGroupsMode:'+tab.id]).toMatchObject({source:'auto'});
  await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sentenceGroupsAllSites:false}});
  expect(session['sentenceGroupsMode:'+tab.id]).toBeUndefined();
  granted.add('http://*/*');granted.add('https://*/*');
  await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sentenceGroupsAllSites:true}});

  await send({type:'PAGE_UI_INJECT',tabId:tab.id});
  await send({type:'SENTENCE_GROUPS_SET',tabId:tab.id,enabled:false});
  await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sentenceGroupsAllSites:true}});
  expect(await send({type:'AUTOMATION_GET',tabId:tab.id})).toMatchObject({sentenceGroups:false,sentenceGroupsEffective:true});
  expect(session['sentenceGroupsMode:'+tab.id]).toMatchObject({enabled:false,source:'manual'});

  tab.url='https://docs.example/next';
  globalThis.chrome.tabs.onUpdated.listeners[0](tab.id,{status:'complete'},{...tab});
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(session['sentenceGroupsMode:'+tab.id]).toMatchObject({enabled:true,source:'auto'});
  expect(tabMessages.at(-1).message).toMatchObject({reading:true,sentenceGroups:true});

  await send({type:'PAGE_UI_INJECT',tabId:tab.id});
  await send({type:'SENTENCE_GROUPS_SET',tabId:tab.id,enabled:true});
  await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sentenceGroupsAllSites:false}});
  expect(session['sentenceGroupsMode:'+tab.id]).toMatchObject({enabled:true,source:'manual'});
  expect(await send({type:'AUTOMATION_GET',tabId:tab.id})).toMatchObject({sentenceGroups:true,sentenceGroupsEffective:false});

  await send({type:'PAGE_ACTIVITY_SET',enabled:false},pageSender);
  await send({type:'AUTO_BOOTSTRAP_CHECK'},pageSender);
  expect(tabMessages.at(-1).message).toMatchObject({reading:false,sentenceGroups:false,paused:true});
  await send({type:'PAGE_ACTIVITY_SET',enabled:true},pageSender);
  await send({type:'AUTO_BOOTSTRAP_CHECK'},pageSender);
  expect(tabMessages.at(-1).message).toMatchObject({reading:true,sentenceGroups:true,paused:false});

  granted.add('http://*/*');granted.add('https://*/*');
  await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sentenceGroupsAllSites:true}});
  tab.url='https://docs.example/revoked';
  globalThis.chrome.tabs.onUpdated.listeners[0](tab.id,{status:'complete'},{...tab});
  await new Promise(resolve=>setTimeout(resolve,0));
  granted.delete('http://*/*');granted.delete('https://*/*');granted.delete('https://docs.example/*');
  globalThis.chrome.permissions.onRemoved.listeners.forEach(listener=>listener({origins:['http://*/*','https://*/*','https://docs.example/*']}));
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(tabMessages.at(-1).message).toMatchObject({reading:false,sentenceGroups:false});
  expect(session['sentenceGroupsMode:'+tab.id]).toBeUndefined();

  granted.add('http://*/*');granted.add('https://*/*');
  globalThis.chrome.permissions.onAdded.listeners.forEach(listener=>listener({origins:['http://*/*','https://*/*']}));
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(session['sentenceGroupsMode:'+tab.id]).toMatchObject({source:'auto'});
  tab.url='chrome://settings';
  globalThis.chrome.tabs.onUpdated.listeners[0](tab.id,{url:tab.url,status:'loading'},{...tab});
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(session['sentenceGroupsMode:'+tab.id]).toBeUndefined();
  tab.url='https://docs.example/article';
  await send({type:'AUTOMATION_PATCH',tabId:tab.id,patch:{sentenceGroupsAllSites:false}});
});
test('page request cancellation is restricted to the armed main frame',async()=>{
  await send({type:'PAGE_UI_INJECT',tabId:tab.id});
  const {token}=await send({type:'EMERGENCY_BEGIN',tabId:tab.id,url:tab.url});
  expect(session['emergencySession:'+tab.id]).toMatchObject({token,cancelledThrough:0});
  await expect(send({type:'EMERGENCY_CANCEL_REQUEST',token,through:2},{...pageSender,frameId:1})).rejects.toThrow();
  await send({type:'EMERGENCY_CANCEL_REQUEST',token,through:2},pageSender);
  expect(session['emergencySession:'+tab.id]).toMatchObject({token,cancelledThrough:2});
  await send({type:'EMERGENCY_END',tabId:tab.id,token});
});

const settleCommand = async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setTimeout(resolve,0));};
const runBilingualCommand = async()=>{chrome.commands.onCommand.listeners[0]('open-bilingual-page',tab);await settleCommand();};

test('bilingual shortcut only opens the real action popup and exposes a one-shot matching intent',async()=>{
  const messagesBefore=tabMessages.length,callsBefore=modelCalls;
  await runBilingualCommand();
  expect(popupOpens.at(-1)).toEqual({windowId:tab.windowId});
  expect(tabMessages.length).toBe(messagesBefore);
  expect(modelCalls).toBe(callsBefore);
  expect(await send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url})).toEqual({focus:true});
  expect(await send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url})).toEqual({focus:false});
  await runBilingualCommand();
  const concurrent=await Promise.all([
    send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url}),
    send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url}),
  ]);
  expect(concurrent.map(result=>result.focus).sort()).toEqual([false,true]);
});

test('popup intent rejects and consumes wrong, expired, and invalid values',async()=>{
  await runBilingualCommand();
  expect(await send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url+'?moved'})).toEqual({focus:false});
  expect(await send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url})).toEqual({focus:false});
  await runBilingualCommand();
  expect(await send({type:'POPUP_INTENT_TAKE',tabId:tab.id+1,url:tab.url})).toEqual({focus:false});
  expect(await send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url})).toEqual({focus:false});
  await runBilingualCommand();
  session.bilingualPopupIntent.createdAt=Date.now()-30001;
  expect(await send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url})).toEqual({focus:false});
  expect(session.bilingualPopupIntent).toBeUndefined();

  session.bilingualPopupIntent={tabId:'11',url:tab.url,createdAt:Date.now()};
  expect(await send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url})).toEqual({focus:false});
  expect(session.bilingualPopupIntent).toBeUndefined();
});

test('content scripts cannot take popup intents',async()=>{
  session.bilingualPopupIntent={tabId:tab.id,url:tab.url,createdAt:Date.now()};
  await expect(send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url},pageSender)).rejects.toThrow('网页');
  expect(await send({type:'POPUP_INTENT_TAKE',tabId:tab.id,url:tab.url})).toEqual({focus:true});
});

test('popup open rejection and missing API clear intent and show manual fallback',async()=>{
  const messagesBefore=tabMessages.length,callsBefore=modelCalls;
  popupFailure=new Error('popup rejected');
  await runBilingualCommand();
  popupFailure=null;
  expect(session.bilingualPopupIntent).toBeUndefined();
  expect(actionTitles.at(-1)).toEqual({tabId:tab.id,title:'RelyLess：请点击工具栏 RelyLess 打开翻译'});

  const openPopup=chrome.action.openPopup;
  chrome.action.openPopup=undefined;
  await runBilingualCommand();
  chrome.action.openPopup=openPopup;
  expect(session.bilingualPopupIntent).toBeUndefined();
  expect(tabMessages.length).toBe(messagesBefore);
  expect(modelCalls).toBe(callsBefore);
});

test('navigation and tab close clear a pending popup intent',async()=>{
  await runBilingualCommand();
  chrome.tabs.onUpdated.listeners[0](tab.id,{status:'loading'},tab);
  await settleCommand();
  expect(session.bilingualPopupIntent).toBeUndefined();
  expect(tabMessages.some(entry=>entry.tabId===tab.id&&entry.message.type==='SS_EMERGENCY_END')).toBe(true);

  await runBilingualCommand();
  for(const listener of chrome.tabs.onRemoved.listeners)listener(tab.id);
  await settleCommand();
  expect(session.bilingualPopupIntent).toBeUndefined();
});
