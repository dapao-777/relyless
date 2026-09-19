import {
  normalizeSupportProviderItems,normalizeSupportAttempt,normalizeSupportCorrections,normalizePreparationContext,
  normalizeAssistanceRequest,normalizeAssistanceResult,
  normalizeEmergencyItems,normalizeEmergencyResult,normalizePageTranslationItems,normalizePageTranslationResult,
} from './gloss.mjs';
import {sanitizeDiagnostic,diagnosticError,validTraceId} from './diagnostics.mjs';
import {normalizeSentenceGroupItems,normalizeSentenceGroupsResult} from './sentence-groups.mjs';
import {normalizeTranslationProgress} from './assistance-stream.mjs';
const diagnosticListeners=new Set();
export function onNativeDiagnostic(listener){diagnosticListeners.add(listener);}
export async function syncNativeDiagnostics(payload){if(!port)return false;const result=await send('diagnostics',payload);return result?.storageError!==true;}
const HOST = 'cc.ss_data.shisui_translate';
const DISCONNECTED = {connected:false,authenticated:false,email:null,plan:null,loginPending:false,error:null};
let status = {...DISCONNECTED};
let port = null;
let sequence = 0;
let attempted = false;
let initialStatus = null;
let refreshInFlight = null;
const pending = new Map();
const listeners = new Set();

export function subscriptionStatus() { return {...status}; }
export function onSubscriptionStatus(listener) { listeners.add(listener); }
function update(value) {
  const next = {
    connected:value?.connected === true,
    authenticated:value?.connected === true && value?.authenticated === true,
    email:typeof value?.email === 'string' ? value.email.slice(0,320) : null,
    plan:typeof value?.plan === 'string' ? value.plan.slice(0,100) : null,
    loginPending:value?.loginPending === true,
    error:typeof value?.error === 'string' ? value.error.slice(0,600) : null,
  };
  if (JSON.stringify(next) === JSON.stringify(status)) return;
  status = next;
  for (const listener of listeners) listener(subscriptionStatus());
}
function disconnect(connection, error) {
  if (port !== connection) return;
  port = null;
  for (const {reject,timer} of pending.values()) { clearTimeout(timer); reject(error); }
  pending.clear();
  update({...DISCONNECTED,error:error.message});
}
function connection() {
  if (port) return port;
  attempted = true;
  const current = chrome.runtime.connectNative(HOST);
  port = current;
  current.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || '';
    const missing = /not found|not registered|forbidden/i.test(reason);
    disconnect(current,new Error(missing
      ? '未找到或未授权本地连接器。请按安装说明安装，然后点击“刷新连接”。'
      : '本地连接器已断开。请确认 Node.js 和 Codex 可用，再点击“刷新连接”。'));
  });
  current.onMessage.addListener(message => {
    if (port !== current) return;
    if (message?.event === 'status') { update(message.data); return; }
    if(message?.event==='diagnostic'){const record=sanitizeDiagnostic(message.data);if(record)for(const listener of diagnosticListeners)listener(record);return;}
    const request = pending.get(message?.id);
    if (!request) return;
    if(message?.event==='assistProgress'||message?.event==='translationProgress'){
      const expected=message.event==='assistProgress'?'assist':'emergencyTranslate';
      if(request.type!==expected||typeof request.onProgress!=='function')return;
      Promise.resolve().then(()=>{if(pending.get(message.id)===request)return request.onProgress(message.data);}).catch(()=>{});
      return;
    }
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.ok === true) request.resolve(message.data);
    else {
      const error = typeof message.error === 'string' ? message.error.slice(0,600) : '本地连接器返回了无效响应。';
      const reported=new Error(/不支持的连接器请求|unsupported request/i.test(error)?'本地连接器版本过旧，请重新运行安装命令后刷新连接。':error);
      const detail=diagnosticError({code:message.code,detail:message.detail,message:error});reported.code=detail.code;reported.detail=detail;request.reject(reported);
    }
  });
  return current;
}
function send(type,payload = {},traceId,onProgress) {
  return new Promise((resolve,reject) => {
    if (pending.size >= 16) { reject(new Error('本地连接器正忙，请稍后再试。')); return; }
    let current;
    try { current = connection(); } catch { reject(new Error('无法启动本地连接器，请检查安装。')); return; }
    const id = ++sequence;
    const timer = setTimeout(() => {
      disconnect(current,new Error(type === 'assist' ? '订阅帮助超时，已断开连接并停止请求。请刷新连接后重试。' : type === 'emergencyTranslate' ? '订阅翻译超时，已断开连接并停止请求。请刷新连接后重试。' : '本地连接器没有及时响应，请刷新连接后重试。'));
      current.disconnect();
    },['assist','emergencyTranslate'].includes(type) ? 120000 : 45000);
    pending.set(id,{resolve,reject,timer,type,onProgress});
    try { current.postMessage({id,type,payload,...(validTraceId(traceId)?{traceId}:{})}); }
    catch {
      disconnect(current,new Error('无法向本地连接器发送消息，请刷新连接后重试。'));
      current.disconnect();
    }
  });
}
export function refreshSubscription() {
  if (refreshInFlight) return refreshInFlight;
  attempted = true;
  refreshInFlight = (async () => {
    // An installer replaces files, not the code loaded by an existing native port.
    const previous = port;
    if (previous) {
      disconnect(previous,new Error('连接已刷新，请重新求助。'));
      previous.disconnect();
    }
    try { update(await send('status')); }
    catch (error) { update({...DISCONNECTED,error:error.message}); }
    return subscriptionStatus();
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}
export async function ensureSubscription() {
  if (!attempted) initialStatus = refreshSubscription();
  if (initialStatus) { await initialStatus; initialStatus = null; }
  return subscriptionStatus();
}
export async function loginSubscription() {
  const result = await send('login');
  let url;
  try { url = new URL(result?.authUrl); } catch { throw new Error('连接器未返回有效的官方登录地址。'); }
  if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.port || url.username || url.password) {
    await send('cancel');
    throw new Error('已拒绝非官方登录地址。');
  }
  try { await chrome.tabs.create({url:url.href}); }
  catch { await send('cancel'); throw new Error('无法打开登录页面，请重试。'); }
  return subscriptionStatus();
}
export async function cancelSubscription() {
  update(await send('cancel'));
  return subscriptionStatus();
}
export async function logoutSubscription() {
  update(await send('logout'));
  return subscriptionStatus();
}
export async function listSubscriptionModels(refresh = false) {
  const result = await send('models',{refresh:refresh === true});
  if (!Array.isArray(result?.models) || result.models.length > 256) throw new Error('订阅服务没有返回有效模型列表。');
  return result.models.map(model => {
    if (!model || typeof model.id !== 'string' || !model.id || typeof model.name !== 'string' || !model.name) throw new Error('订阅服务返回的模型信息无效。');
    const item = {id:model.id,name:model.name,isDefault:model.isDefault === true};
    if (model.supportedReasoningEfforts !== undefined) {
      if (!Array.isArray(model.supportedReasoningEfforts) || model.supportedReasoningEfforts.some(value => typeof value !== 'string')) throw new Error('订阅服务返回的模型信息无效。');
      item.supportedReasoningEfforts = [...model.supportedReasoningEfforts];
    }
    return item;
  });
}
export async function classifySubscription(text,title,model,traceId) {
  const result = await send('classify',{text,title,model},traceId);
  if (!['general','tech','data','finance','medical','legal','design'].includes(result?.domain) || result?.source !== 'chatgpt') throw new Error('订阅服务没有返回有效领域分类。');
  return {domain:result.domain,source:'chatgpt'};
}
function normalizePreferences(value){
  if(value===undefined||value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==3||!['detail','terminology','focus'].every(key=>Object.hasOwn(value,key))||!['concise','standard'].includes(value.detail)||!['consistent','contextual'].includes(value.terminology)||!['meaning','usage'].includes(value.focus))throw new Error('个性化翻译偏好无效。');
  return {detail:value.detail,terminology:value.terminology,focus:value.focus};
}
export async function supportSubscription(items,model='',article,traceId,preferences,corrections=[]) {
  const selected=normalizeSupportProviderItems(items),context=normalizePreparationContext(article),personalization=normalizePreferences(preferences),issues=normalizeSupportCorrections(corrections,selected);
  return normalizeSupportAttempt(await send('supportBatch',{items:selected,model,article:context,corrections:issues,...(personalization?{personalization}:{})},traceId),selected,context);
}
function normalizedAssistProgress(value,request){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const han=/[\u3400-\u9fff\uf900-\ufaff]/u,english=/[A-Za-z]/,result={};
  const validEnglish=(item,max,words=Infinity)=>typeof item==='string'&&item===item.trim()&&item.length>0&&item.length<=max&&english.test(item)&&!han.test(item)&&item.split(/\s+/).length<=words;
  const validChinese=(item,max)=>typeof item==='string'&&item===item.trim()&&item.length>0&&item.length<=max&&han.test(item);
  const definitionValid=request.level==='hint'?validEnglish(value.definition,request.kind==='passage'?240:80,request.kind==='passage'?30:8):validChinese(value.definition,1200);
  if(definitionValid)result.definition=value.definition;
  if(request.kind!=='passage'){
    if(request.level==='hint'?validEnglish(value.meaning,600):validChinese(value.meaning,400))result.meaning=value.meaning;
    if(validChinese(value.sentenceTranslation,2000))result.sentenceTranslation=value.sentenceTranslation;
  }
  return Object.keys(result).length?result:null;
}
export async function assistSubscription(request,model='',traceId,preferences,onProgress) {
  const selected=normalizeAssistanceRequest(request),personalization=normalizePreferences(preferences);
  const progress=typeof onProgress==='function'?value=>{const normalized=normalizedAssistProgress(value,selected);if(normalized)return onProgress(normalized);}:undefined;
  return normalizeAssistanceResult(await send('assist',{...selected,model,...(personalization?{personalization}:{})},traceId,progress),selected);
}
export async function emergencyTranslateSubscription({scope,items,model='',traceId,preferences,onProgress}) {
  if(scope!=='page'&&scope!=='passage')throw new Error('翻译范围无效。');
  const selected=scope==='page'?normalizePageTranslationItems(items):normalizeEmergencyItems(items),personalization=normalizePreferences(preferences);
  const progress=scope==='passage'&&typeof onProgress==='function'?value=>{const normalized=normalizeTranslationProgress(value,selected);if(normalized)return onProgress(normalized);}:undefined;
  const result=await send('emergencyTranslate',{scope,items:selected,model,...(personalization?{personalization}:{})},traceId,progress);
  return scope==='page'?normalizePageTranslationResult(result,selected):normalizeEmergencyResult(result,selected);
}
export async function sentenceGroupsSubscription(items,model='',traceId) { const selected=normalizeSentenceGroupItems(items); const value=await send('sentenceGroups',{items:selected,model},traceId); return normalizeSentenceGroupsResult(value,selected); }
export async function historyModelSubscription(kind,payload,model='',traceId) { if(!['summary','personalization'].includes(kind)||!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('历史模型请求无效。');
const result=await send('historyModel',{kind,payload,model},traceId);
if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('历史模型没有返回有效对象。');
return result; }





