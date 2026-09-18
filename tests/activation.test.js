import {expect,test} from 'bun:test';
import {ALL_HOSTS,VIDEO_HOSTS,registrationMatches,requiredPermissionOrigins,resolveAutomation,validateAutomation,validateVideo} from '../extension/activation.js';
import {normalizeSettings} from '../extension/shared.js';

const activationDefaults={allSites:false,sentenceGroupsAllSites:false,sites:[],videoSites:false};

test('exact origin rules override all-sites and manual pause disables automatic reading',()=>{
  const automation=validateAutomation({allSites:true,sites:[{origin:'https://blocked.example',enabled:false},{origin:'http://allowed.example:8080',enabled:true}]},activationDefaults);
  expect(resolveAutomation(automation,'https://blocked.example/article')).toMatchObject({origin:'https://blocked.example',siteRule:false,effective:false,paused:false});
  expect(resolveAutomation(automation,'https://elsewhere.example/article')).toMatchObject({siteRule:null,effective:true,videoAvailable:false});
  expect(resolveAutomation(automation,'http://allowed.example:8080/article',true)).toMatchObject({siteRule:true,effective:false,paused:true,videoAvailable:false});
});

test('video automatic entry requires its independent explicit authorization',()=>{
  const readingOnly=validateAutomation({sites:[{origin:'https://www.youtube.com',enabled:true}]},activationDefaults);
  expect(resolveAutomation(readingOnly,'https://www.youtube.com/watch?v=fixture')).toMatchObject({effective:true,videoAvailable:false});
  const video=validateAutomation({videoSites:true},activationDefaults);
  expect(resolveAutomation(video,'https://www.youtube.com/watch?v=fixture')).toMatchObject({effective:false,videoAvailable:true});
  expect(resolveAutomation(video,'https://m.youtube.com/watch?v=fixture')).toMatchObject({effective:false,videoAvailable:true});
  expect(resolveAutomation(video,'https://youtube.com/watch?v=fixture').videoAvailable).toBe(false);
  expect(registrationMatches(video)).toEqual([...VIDEO_HOSTS].sort());
});

test('permission requirements mirror persisted policy without broadening exact site access',()=>{
  const exact=validateAutomation({sites:[{origin:'https://docs.example',enabled:true},{origin:'https://off.example',enabled:false}]},activationDefaults);
  expect(requiredPermissionOrigins(exact)).toEqual(['https://docs.example/*']);
  const broad=validateAutomation({allSites:true,videoSites:true},activationDefaults);

  expect(requiredPermissionOrigins(broad)).toEqual([...new Set([...ALL_HOSTS,...VIDEO_HOSTS])].sort());
  expect(()=>validateAutomation({sites:[{origin:'https://docs.example/path',enabled:true}]},activationDefaults)).toThrow('origin');
  expect(()=>validateAutomation({sites:[{origin:'https://docs.example',enabled:true},{origin:'https://docs.example',enabled:false}]},activationDefaults)).toThrow('唯一');
});

test('sentence groups all-sites uses host permission while exact disabled rules and pause win',()=>{
  const automation=validateAutomation({sentenceGroupsAllSites:true,sites:[{origin:'https://blocked.example',enabled:false}]},activationDefaults);
  expect(resolveAutomation(automation,'https://article.example/read')).toMatchObject({effective:false,sentenceGroupsEffective:true});
  expect(resolveAutomation(automation,'https://blocked.example/read')).toMatchObject({siteRule:false,sentenceGroupsEffective:false});
  expect(resolveAutomation(automation,'https://article.example/read',true).sentenceGroupsEffective).toBe(false);
  expect(resolveAutomation(automation,'chrome://settings').sentenceGroupsEffective).toBe(false);
  expect(requiredPermissionOrigins(automation)).toEqual([...ALL_HOSTS].sort());
  expect(registrationMatches(automation)).toEqual([...ALL_HOSTS].sort());
  expect(validateAutomation({}, {allSites:false,sites:[],videoSites:false}).sentenceGroupsAllSites).toBe(false);
  expect(normalizeSettings({automation:{allSites:true,sites:[],videoSites:false}}).automation.sentenceGroupsAllSites).toBe(false);
});

test('removed automation modes and video translation display cannot re-enter the public contract',()=>{
  expect(()=>validateAutomation({mode:'bilingual'},activationDefaults)).toThrow('未知');
  const initial={fontSize:20,theme:'auto'};
  expect(validateVideo({fontSize:28,theme:'dark'},initial)).toEqual({fontSize:28,theme:'dark'});
  expect(()=>validateVideo({fontSize:19},initial)).toThrow('字号');
  expect(()=>validateVideo({display:'original'},initial)).toThrow('未知');
  expect(()=>validateVideo({theme:'system'},initial)).toThrow('主题');
});

test('popup preserves the clicked site choice while rendering its busy state',async()=>{
  const previousChrome=globalThis.chrome,previousDocument=globalThis.document;
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{checked:false,disabled:true,hidden:true,textContent:'',handlers:{},classList:{toggle(){}},addEventListener(type,handler){this.handlers[type]=handler;}});
    return elements.get(id);
  };
  const permissions=[],patches=[];
  const automation={allSites:false,sites:[],videoSites:false};
  globalThis.document={querySelector:element,querySelectorAll:()=>['coarse','medium','fine'].map(value=>Object.assign(element('#density-'+value),{value}))};
  globalThis.chrome={runtime:{async sendMessage(message){
    if(message.type==='STATE_GET')return{ok:true,data:{settings:{assistanceMode:'on-demand'},providerConfigured:true}};
    if(message.type==='AUTOMATION_PATCH'){patches.push(message.patch);Object.assign(automation,message.patch);}
    return {ok:true,data:{automation,siteRule:automation.sites[0]?.enabled??null}};
  }},storage:{onChanged:{addListener(){}}},tabs:{query:async()=>[{id:7,url:'https://docs.example/read'}],sendMessage:async()=>({ok:true,data:{enabled:false}})},permissions:{request:async request=>{permissions.push(request);return true;}}};
  try{
    await import('../extension/ui/popup.js?site-choice-regression');
    await new Promise(resolve=>setTimeout(resolve,0));
    const toggle=element('#site-auto');
    toggle.checked=true;toggle.handlers.change();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(permissions).toEqual([{origins:['https://docs.example/*']}]);
    expect(patches).toEqual([{sites:[{origin:'https://docs.example',enabled:true}]}]);
    expect(toggle.checked).toBe(true);
  }finally{
    if(previousChrome===undefined)delete globalThis.chrome;else globalThis.chrome=previousChrome;
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
});
