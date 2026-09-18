import './reading-style.js';
import {normalizeApiService} from './api-providers.mjs';

export const DOMAINS = {auto:'自动识别',general:'通用阅读',tech:'软件与 AI',data:'数据工程',finance:'金融与商业',medical:'医学与生命科学',legal:'法律',design:'设计与产品'};
export const DEFAULT_SETTINGS = {assistanceMode:'ambient',rememberSupport:true,helpLanguage:'zh',lookupKey:'D',lookupDisplay:'card',readingStyle:globalThis.ShisuiReadingStyle.defaults,domain:'auto',providerKind:'chatgpt',subscriptionModel:'',apiServices:[],activeApiServiceId:'',domainRules:[],domainDetection:{mode:'local',subscriptionModel:'',apiModel:'',useTranslationApi:true,api:{baseUrl:'https://api.openai.com/v1',apiKey:''}},customTerms:[],automation:{allSites:false,sentenceGroupsAllSites:false,sites:[],videoSites:false},video:{fontSize:20,theme:'auto'}};
// Removed settings must not revive through a spread of an older configuration.
export function normalizeSettings(value = {}) {
  const pick = (defaults, source) => Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, source?.[key] ?? fallback]));
  const settings = pick(DEFAULT_SETTINGS,value);
  settings.assistanceMode = value.assistanceMode === 'on-demand' ? 'on-demand' : 'ambient';
  settings.rememberSupport = value.rememberSupport !== false;
  settings.helpLanguage = value.helpLanguage === 'en' ? 'en' : 'zh';
  settings.lookupKey = typeof value.lookupKey === 'string' && /^[A-Za-z]$/.test(value.lookupKey) ? value.lookupKey.toUpperCase() : DEFAULT_SETTINGS.lookupKey;
  settings.lookupDisplay = value.lookupDisplay === 'annotation' ? 'annotation' : 'card';
  settings.readingStyle = globalThis.ShisuiReadingStyle.normalize(value.readingStyle);
  settings.providerKind = ['chatgpt','api'].includes(value.providerKind) ? value.providerKind : (value.provider?.apiKey ? 'api' : 'chatgpt');
  const legacyProvider = !Array.isArray(value.apiServices) && Object.hasOwn(value,'provider');
  const rows = Array.isArray(value.apiServices) ? value.apiServices : (legacyProvider ? [{id:'legacy-api',name:'原有 API 服务',baseUrl:value.provider?.baseUrl,model:value.provider?.model,apiKey:value.provider?.apiKey}] : []);
  const seen=new Set();settings.apiServices=rows.flatMap(row=>{try{const service=normalizeApiService(row);if(!service.id||seen.has(service.id))return [];seen.add(service.id);return [service];}catch{return [];}});
  settings.activeApiServiceId = settings.apiServices.some(service=>service.id===value.activeApiServiceId) ? value.activeApiServiceId : (legacyProvider&&settings.apiServices.some(service=>service.id==='legacy-api')?'legacy-api':'');
  settings.domainDetection = pick(DEFAULT_SETTINGS.domainDetection,value.domainDetection);
  settings.domainDetection.api = pick(DEFAULT_SETTINGS.domainDetection.api,value.domainDetection?.api);
  settings.automation = pick(DEFAULT_SETTINGS.automation,value.automation);
  settings.automation.sites = Array.isArray(value.automation?.sites) ? value.automation.sites.map(({origin,enabled}) => ({origin,enabled})) : [];
  settings.video = pick(DEFAULT_SETTINGS.video,value.video);
  return settings;
}
export function activeApiProvider(settings) { return settings?.apiServices?.find(service=>service.id===settings.activeApiServiceId) || null; }
export const wordId = (term, domain = 'general') => `${domain}:${term.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()}`;
export async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({type,...payload});
  if (!response?.ok) throw new Error(response?.error || '插件连接已断开，请刷新页面后重试。');
  return response.data;
}