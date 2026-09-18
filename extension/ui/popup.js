import {request} from '../shared.js';

const popupEls={status:document.querySelector('#page-status'),hostname:document.querySelector('#site-hostname'),siteAuto:document.querySelector('#site-auto'),siteAutoNote:document.querySelector('#site-auto-note'),siteAutoError:document.querySelector('#site-auto-error'),toggle:document.querySelector('#toggle-page'),toggleLabel:document.querySelector('#toggle-label'),pageNote:document.querySelector('#page-note'),actionError:document.querySelector('#action-error'),sentenceGroups:document.querySelector('#sentence-groups'),sentenceGroupsNote:document.querySelector('#sentence-groups-note'),sentenceGroupsError:document.querySelector('#sentence-groups-error'),options:document.querySelector('#open-options'),serviceWarning:document.querySelector('#service-warning'),serviceWarningCopy:document.querySelector('#service-warning-copy'),repairService:document.querySelector('#repair-service'),suggestion:document.querySelector('#on-demand-suggestion'),chooseOnDemand:document.querySelector('#choose-on-demand')};
for(const name of ['open','confirm','start','cancel','actions','stop','clear','result'])popupEls['emergency'+name[0].toUpperCase()+name.slice(1)]=document.querySelector('#emergency-'+name);
const popupLookupKeyCopies=[...document.querySelectorAll('[data-lookup-key]')];
let popupState=null;
let popupAutomation=null;
let popupTab=null;
let popupEnabled=false;
let popupSentenceGroups={enabled:false,density:'medium',status:'off',error:'',processed:0};
let popupSentenceGroupsLoaded=false;
let popupBusy=false;
let popupEmergency={active:false,displayed:false};

function popupErrorText(error){return error instanceof Error?error.message:String(error);}
function popupShowError(element,error){element.textContent=popupErrorText(error);element.hidden=false;}
function popupClearError(element){element.textContent='';element.hidden=true;}
function popupSupported(){return Boolean(popupTab?.id&&/^https?:\/\//i.test(popupTab.url||''));}
function popupOrigin(){try{return popupSupported()?new URL(popupTab.url).origin:'';}catch{return'';}}
function popupHostname(){try{return popupSupported()?new URL(popupTab.url).hostname:'当前标签页';}catch{return'当前标签页';}}
function popupRender(){
  popupEls.hostname.textContent=popupHostname();
  const lookupKey=typeof popupState?.settings?.lookupKey==='string'&&/^[A-Z]$/.test(popupState.settings.lookupKey)?popupState.settings.lookupKey:'D';
  for(const copy of popupLookupKeyCopies)copy.textContent=lookupKey;
  const supported=popupSupported();
  const allSites=Boolean(popupAutomation?.automation?.allSites);
  const configured=popupAutomation?.siteRule??allSites;
  popupEls.siteAuto.disabled=popupBusy||!supported||!popupAutomation;
  popupEls.siteAuto.checked=Boolean(supported&&configured);
  if(!supported)popupEls.siteAutoNote.textContent='仅普通 HTTP 或 HTTPS 网页可授权。';
  else if(popupAutomation?.paused&&configured)popupEls.siteAutoNote.textContent='此网站已授权；当前标签页已暂停。';
  else if(allSites&&popupAutomation?.siteRule===false)popupEls.siteAutoNote.textContent='全部网站已开启；当前网站已排除。';
  else if(allSites)popupEls.siteAutoNote.textContent='全部网站已开启；关闭可排除当前网站。';
  else popupEls.siteAutoNote.textContent=configured?'下次打开此网站会自动辅助。':'授权后自动开始；有限上下文用于准备，支持记录只在本机。';
  popupEls.toggle.disabled=popupBusy||!supported;
  popupEls.status.classList.toggle('active',popupEnabled);
  if(!supported){popupEls.status.textContent='此页不可用';popupEls.toggleLabel.textContent='当前页不可用';popupEls.pageNote.textContent='请在普通网页主文档中使用。';}
  else if(popupEnabled){popupEls.status.textContent='本页已开启';popupEls.toggleLabel.textContent='暂停本页';popupEls.pageNote.textContent=popupState?.settings?.assistanceMode==='on-demand'?'当前为仅在需要时；保留主动求助。':'保留英文，只在当前位置提供少量支撑。';}
  else{popupEls.status.textContent=popupAutomation?.paused?'本页已暂停':'等待开启';popupEls.toggleLabel.textContent=popupAutomation?.paused?'继续辅助':'开启本页';popupEls.pageNote.textContent='开启不会改变网站的长期授权规则。';}
  const serviceProblem=popupState?.providerError||(popupState?.settings?.providerKind==='chatgpt'?popupState?.subscription?.error:'')||(!popupState?.providerConfigured?'辅助服务尚未连接。':'');
  popupEls.serviceWarning.hidden=!serviceProblem;
  popupEls.serviceWarningCopy.textContent=serviceProblem||'';
  popupEls.sentenceGroups.checked=Boolean(popupSentenceGroupsLoaded&&popupSentenceGroups.enabled);
  popupEls.sentenceGroups.disabled=popupBusy||!supported||!popupSentenceGroupsLoaded||Boolean(!popupSentenceGroups.enabled&&!popupState?.providerConfigured);
  if(!supported)popupEls.sentenceGroupsNote.textContent='当前页不可用；请在普通网页中使用阅读解构。';
  else if(!popupState?.providerConfigured)popupEls.sentenceGroupsNote.textContent=popupSentenceGroups.enabled?'服务未就绪，阅读解构已停止；仍可关闭本页阅读解构。':'连接辅助服务后才能开启阅读解构。';
  else if(popupSentenceGroups.status==='queued')popupEls.sentenceGroupsNote.textContent='正在准备分析当前可见正文。';
  else if(popupSentenceGroups.status==='analyzing')popupEls.sentenceGroupsNote.textContent='正在分析当前可见正文；滚动后只分析新出现的句子。';
  else if(popupSentenceGroups.status==='error')popupEls.sentenceGroupsNote.textContent='阅读解构出错，可在扩展中关闭后重新开启。';
  else if(popupSentenceGroups.status==='paused')popupEls.sentenceGroupsNote.textContent='分析暂缓；页面恢复阅读状态后按需继续。';
  else if(popupSentenceGroups.enabled)popupEls.sentenceGroupsNote.textContent=popupSentenceGroups.processed?'已开启，已处理 '+popupSentenceGroups.processed+' 句；滚动时按需继续。':'已开启，等待分析可见正文。';
  else popupEls.sentenceGroupsNote.textContent='已关闭；可随时为当前页面开启。';
  if(popupSentenceGroups.error){popupEls.sentenceGroupsError.textContent=popupSentenceGroups.error;popupEls.sentenceGroupsError.hidden=false;}else{popupEls.sentenceGroupsError.textContent='';popupEls.sentenceGroupsError.hidden=true;}
  const emergencyVisible=Boolean(popupEmergency.active||popupEmergency.displayed);
  popupEls.emergencyOpen.hidden=emergencyVisible||!popupEls.emergencyConfirm.hidden;
  popupEls.emergencyOpen.disabled=popupBusy||!supported||!popupState?.providerConfigured;
  popupEls.emergencyActions.hidden=!emergencyVisible;
  popupEls.emergencyStop.disabled=popupBusy||!popupEmergency.active;
  popupEls.emergencyClear.disabled=popupBusy||!emergencyVisible;
  popupEls.emergencyStart.disabled=popupBusy||!supported||!popupState?.providerConfigured;
  popupEls.emergencyCancel.disabled=popupBusy;
}
async function popupGetPageStatus(){if(!popupSupported())return;const snapshot=popupSentenceGroups;const result=await chrome.tabs.sendMessage(popupTab.id,{type:'SS_STATUS'},{frameId:0}).catch(()=>null);if(snapshot!==popupSentenceGroups||!result?.ok)return;popupEnabled=Boolean(result.data?.enabled);if(result.data?.sentenceGroups)popupSentenceGroups={...popupSentenceGroups,...result.data.sentenceGroups};if(result.data?.emergency)popupEmergency={active:Boolean(result.data.emergency.active),displayed:Boolean(result.data.emergency.displayed)};}
async function popupGetSentenceGroups(){const result=await request('SENTENCE_GROUPS_GET',{tabId:popupTab?.id});const density=['coarse','medium','fine'].includes(result?.density)?result.density:'medium';popupSentenceGroups={enabled:Boolean(result?.enabled),density,status:result?.enabled?'idle':'off',error:'',processed:0};popupSentenceGroupsLoaded=true;}
async function popupToggleSite(){
  if(!popupSupported()||popupBusy||!popupAutomation)return;
  const enabled=popupEls.siteAuto.checked,origin=popupOrigin();
  popupBusy=true;popupClearError(popupEls.siteAutoError);popupRender();
  try{
    if(enabled&&!await chrome.permissions.request({origins:[origin+'/*']}))throw new Error('未授予此网站权限，设置未更改。');
    const sites=popupAutomation.automation.sites.filter(site=>site.origin!==origin);
    sites.push({origin,enabled});
    popupAutomation=await request('AUTOMATION_PATCH',{patch:{sites},tabId:popupTab.id});
    await popupGetPageStatus();
  }catch(error){popupShowError(popupEls.siteAutoError,error);}
  finally{popupBusy=false;popupRender();}
}
async function popupTogglePage(){if(!popupSupported()||popupBusy)return;popupBusy=true;popupClearError(popupEls.actionError);popupRender();try{await request('PAGE_UI_INJECT',{tabId:popupTab.id});const result=await chrome.tabs.sendMessage(popupTab.id,{type:'SS_SET_ENABLED',enabled:!popupEnabled});if(!result?.ok)throw new Error(result?.error||'请刷新网页后重试。');popupEnabled=Boolean(result.data?.enabled);popupAutomation=await request('AUTOMATION_GET',{tabId:popupTab.id});}catch(error){popupShowError(popupEls.actionError,new Error(`无法更新当前页：${popupErrorText(error)}`));}finally{popupBusy=false;popupRender();}}
async function popupToggleSentenceGroups(){
  if(!popupSupported()||popupBusy||!popupSentenceGroupsLoaded)return;const enabled=popupEls.sentenceGroups.checked;
  popupBusy=true;popupSentenceGroups.error='';popupRender();
  try{
    await request('PAGE_UI_INJECT',{tabId:popupTab.id});
    await request('SENTENCE_GROUPS_SET',{tabId:popupTab.id,enabled});
    const result=await chrome.tabs.sendMessage(popupTab.id,{type:'SS_SET_SENTENCE_GROUPS',enabled},{frameId:0});
    if(!result?.ok)throw new Error(result?.error||'网页未能应用阅读解构设置，请刷新后重试。');
    popupSentenceGroups={...popupSentenceGroups,...result.data?.sentenceGroups};popupEnabled=Boolean(result.data?.enabled);
    popupAutomation=await request('AUTOMATION_GET',{tabId:popupTab.id});
  }catch(error){try{await popupGetSentenceGroups();}catch{}popupSentenceGroups.error='无法更新阅读解构：'+popupErrorText(error);}
  finally{popupBusy=false;popupRender();}
}
async function popupChooseOnDemand(){popupEls.chooseOnDemand.disabled=true;try{popupState=await request('STATE_PATCH',{patch:{assistanceMode:'on-demand'}});popupEls.suggestion.hidden=true;if(popupSupported()){const result=await chrome.tabs.sendMessage(popupTab.id,{type:'SS_REFRESH'}).catch(()=>null);if(result?.ok)popupEnabled=Boolean(result.data.enabled);}popupRender();}catch(error){popupShowError(popupEls.actionError,error);popupEls.chooseOnDemand.disabled=false;}}
function popupEmergencyPrompt(show){
  popupEls.emergencyConfirm.hidden=!show;if(show)popupEls.emergencyActions.hidden=true;popupRender();
  if(show){popupClearError(popupEls.emergencyResult);popupEls.emergencyStart.focus();}
  else if(!popupEmergency.active&&!popupEmergency.displayed)popupEls.emergencyOpen.focus();
}
async function popupEmergencyStart(){
  if(popupBusy||!popupSupported()||popupEls.emergencyConfirm.hidden)return;
  popupBusy=true;popupClearError(popupEls.emergencyResult);popupRender();let token;
  try{
    const current=await chrome.tabs.get(popupTab.id);
    if(current.url!==popupTab.url)throw new Error('网页已切换，请重新打开扩展弹窗后确认。');
    await request('PAGE_UI_INJECT',{tabId:popupTab.id});
    ({token}=await request('EMERGENCY_BEGIN',{tabId:popupTab.id,url:popupTab.url}));
    const result=await chrome.tabs.sendMessage(popupTab.id,{type:'SS_EMERGENCY_START',token},{frameId:0});
    if(!result?.ok)throw new Error(result?.error||'无法启动本页翻译，请刷新网页后重试。');
    popupEmergency=result.data?.emergency?{active:Boolean(result.data.emergency.active),displayed:Boolean(result.data.emergency.displayed)}:{active:true,displayed:false};
    popupEmergencyPrompt(false);
    popupEls.emergencyResult.classList.remove('error');
    popupEls.emergencyResult.textContent='已开始。可在网页中查看进度、停止翻译或返回英文。';
    popupEls.emergencyResult.hidden=false;
  }catch(error){
    if(token)await request('EMERGENCY_END',{tabId:popupTab.id,token}).catch(()=>{});
    popupEls.emergencyResult.classList.add('error');popupShowError(popupEls.emergencyResult,error);
  }finally{popupBusy=false;popupRender();if(popupEls.emergencyConfirm.hidden&&!popupEmergency.active&&!popupEmergency.displayed)popupEls.emergencyOpen.focus();}
}
async function popupEmergencyAction(type){
  if(popupBusy||!popupSupported())return;popupBusy=true;popupClearError(popupEls.emergencyResult);popupRender();
  try{const result=await chrome.tabs.sendMessage(popupTab.id,{type},{frameId:0});if(!result?.ok)throw new Error(result?.error||'网页未能完成操作，请刷新后重试。');popupEmergency=result.data?.emergency?{active:Boolean(result.data.emergency.active),displayed:Boolean(result.data.emergency.displayed)}:{active:false,displayed:type==='SS_EMERGENCY_STOP'};popupEls.emergencyResult.textContent=type==='SS_EMERGENCY_STOP'?'已停止发送新批次；已显示的中文仍保留。':'已移除整页译文，页面已返回英文。';popupEls.emergencyResult.hidden=false;}
  catch(error){popupShowError(popupEls.emergencyResult,error);}
  finally{popupBusy=false;popupRender();}
}
function popupOpenOptions(section=''){chrome.runtime.openOptionsPage(()=>{if(section)chrome.tabs.query({url:chrome.runtime.getURL('ui/options.html*')},tabs=>{const tab=tabs.at(-1);if(tab?.id)chrome.tabs.update(tab.id,{url:chrome.runtime.getURL('ui/options.html#'+section)});});});}
async function popupInit(){try{[popupTab]=await chrome.tabs.query({active:true,currentWindow:true});[popupState,popupAutomation]=await Promise.all([request('STATE_GET'),request('AUTOMATION_GET',{tabId:popupTab?.id})]);try{await popupGetSentenceGroups();}catch(error){popupSentenceGroupsLoaded=false;popupSentenceGroups.error='无法读取阅读解构设置：'+popupErrorText(error);popupEls.sentenceGroupsError.textContent=popupSentenceGroups.error;popupEls.sentenceGroupsError.hidden=false;}await popupGetPageStatus();popupRender();if(popupState.settings.assistanceMode==='ambient'){const suggestion=await request('ON_DEMAND_SUGGESTION');popupEls.suggestion.hidden=!suggestion.show;}}catch(error){popupShowError(popupEls.actionError,error);popupRender();}}
async function popupWatchPage(){
  try{if(!popupBusy&&(popupSentenceGroups.enabled||popupEmergency.active||popupEmergency.displayed)&&document.visibilityState==='visible'){await popupGetPageStatus();popupRender();}}
  catch(error){popupSentenceGroups.error=popupErrorText(error);popupRender();}
  finally{setTimeout(()=>void popupWatchPage(),1000);}
}
popupEls.toggle.addEventListener('click',()=>void popupTogglePage());popupEls.siteAuto.addEventListener('change',()=>void popupToggleSite());popupEls.sentenceGroups.addEventListener('change',()=>void popupToggleSentenceGroups());popupEls.options.addEventListener('click',()=>popupOpenOptions());popupEls.repairService.addEventListener('click',()=>popupOpenOptions('service'));popupEls.chooseOnDemand.addEventListener('click',()=>void popupChooseOnDemand());popupEls.emergencyOpen.addEventListener('click',()=>popupEmergencyPrompt(true));popupEls.emergencyCancel.addEventListener('click',()=>popupEmergencyPrompt(false));popupEls.emergencyStart.addEventListener('click',()=>void popupEmergencyStart());popupEls.emergencyStop.addEventListener('click',()=>void popupEmergencyAction('SS_EMERGENCY_STOP'));popupEls.emergencyClear.addEventListener('click',()=>void popupEmergencyAction('SS_EMERGENCY_END'));
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local'||!changes.settings)return;void request('STATE_GET').then(state=>{popupState=state;popupRender();}).catch(()=>{});});
void popupInit().then(()=>setTimeout(()=>void popupWatchPage(),1000));
