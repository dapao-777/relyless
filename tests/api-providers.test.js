import {expect,test} from 'bun:test';
import {API_PROVIDERS,apiProviderBaseUrl,apiProviderDefaultModel,apiProviderDefaultModels,apiServiceOrigins,apiServiceReady,normalizeApiService} from '../extension/api-providers.mjs';

test('catalog exposes the complete unique supported LLM provider set',()=>{
  expect(API_PROVIDERS).toHaveLength(33);
  expect(new Set(API_PROVIDERS.map(provider=>provider.id)).size).toBe(33);
  expect(API_PROVIDERS.map(provider=>provider.id)).toEqual([
    'openai','deepseek','google','anthropic','xai','requesty','openai-compatible','open-responses','jalapenocloud','atlascloud','openrouter','minimax','siliconflow','siliconflow-systemone','tensdaq','azure','bedrock','groq','deepinfra','mistral','togetherai','cohere','fireworks','cerebras','replicate','perplexity','vercel','ollama','volcengine','alibaba','moonshotai','stepfun','huggingface',
  ]);
  expect(API_PROVIDERS.every(provider=>provider.apiKeyUrl===''||!/[?&](?:ref|aff|utm_)/i.test(provider.apiKeyUrl))).toBe(true);
});

test('legacy service migration preserves its endpoint and assigns only the historical compatible protocol',()=>{
  expect(normalizeApiService({id:'legacy',name:'Legacy',baseUrl:'https://private.example/custom/v7/',model:'private-model',apiKey:'secret'})).toEqual({
    id:'legacy',name:'Legacy',providerId:'openai-compatible',baseUrl:'https://private.example/custom/v7',model:'private-model',apiKey:'secret',apiKeys:['secret'],options:{thinking:'auto'},
  });
});

test('provider options are strict and dynamic endpoints remain on their provider origin',()=>{
  expect(apiProviderBaseUrl('azure',{resourceName:'team-prod',apiMode:'chat',apiVersion:'2025-01-01-preview'})).toBe('https://team-prod.openai.azure.com/openai/v1');
  expect(apiProviderBaseUrl('bedrock',{region:'us-west-2'})).toBe('https://bedrock-runtime.us-west-2.amazonaws.com');
  expect(()=>normalizeApiService({id:'x',name:'X',providerId:'bedrock',baseUrl:'',model:'m',apiKey:'k',options:{region:'us-west-2',secretAccessKey:'secret'}})).toThrow('未知选项');
});

test('thinking option applies only to protocols with thinking parameters',()=>{
  expect(normalizeApiService({id:'t',name:'T',providerId:'stepfun',baseUrl:'',model:'step-3.7-flash',apiKey:'k',options:{thinking:'high'}}).options.thinking).toBe('high');
  expect(normalizeApiService({id:'t',name:'T',providerId:'openai',baseUrl:'',model:'gpt-5.6-luna',apiKey:'k',options:{}}).options.thinking).toBe('auto');
  expect(()=>normalizeApiService({id:'t',name:'T',providerId:'openai',baseUrl:'',model:'m',apiKey:'k',options:{thinking:'turbo'}})).toThrow('无效');
  expect(()=>normalizeApiService({id:'t',name:'T',providerId:'replicate',baseUrl:'',model:'owner/name',apiKey:'k',options:{thinking:'low'}})).toThrow('未知选项');
  expect(()=>normalizeApiService({id:'t',name:'T',providerId:'requesty',baseUrl:'',model:'typesafe/jev-1.13.0',apiKey:'k',options:{thinking:'low'}})).toThrow('未知选项');
});

test('stepfun plan option switches between metered and subscription endpoints',()=>{
  expect(apiProviderBaseUrl('stepfun')).toBe('https://api.stepfun.com/v1');
  expect(apiProviderBaseUrl('stepfun',{plan:'api'})).toBe('https://api.stepfun.com/v1');
  expect(apiProviderBaseUrl('stepfun',{plan:'step_plan'})).toBe('https://api.stepfun.com/step_plan/v1');
  const service=normalizeApiService({id:'s',name:'S',providerId:'stepfun',baseUrl:'',model:'step-3.7-flash',apiKey:'k',options:{plan:'step_plan'}});
  expect(service.options.plan).toBe('step_plan');
  expect(service.baseUrl).toBe('https://api.stepfun.com/step_plan/v1');
  expect(()=>normalizeApiService({id:'x',name:'X',providerId:'stepfun',baseUrl:'',model:'m',apiKey:'k',options:{plan:'vip'}})).toThrow('无效');
  // 套餐端点不含 step-1-flash（实测 model_invalid），默认模型按接入方式区分。
  expect(apiProviderDefaultModel('stepfun')).toBe('step-1-flash');
  expect(apiProviderDefaultModel('stepfun',{plan:'step_plan'})).toBe('step-3.5-flash');
  expect(apiProviderDefaultModels('stepfun').has('step-1-flash')).toBe(true);
  expect(apiProviderDefaultModels('stepfun').has('step-3.5-flash')).toBe(true);
  expect(apiProviderDefaultModels('stepfun').has('custom-model')).toBe(false);
});

test('service origins reject credential exfiltration URLs and allow keyless loopback only',()=>{
  const service={id:'local',name:'Local',providerId:'ollama',baseUrl:'http://localhost:11434/api',model:'gemma3:4b',apiKey:'',options:{}};
  expect(apiServiceOrigins(service)).toEqual(['http://localhost:11434']);
  expect(apiServiceReady(service)).toBe(true);
  expect(apiServiceReady({...service,providerId:'openai-compatible'})).toBe(false);
  for(const baseUrl of ['http://remote.example/v1','https://user:pass@safe.example/v1','https://safe.example/v1?next=https://evil.example','https://safe.example/v1#secret']){
    expect(()=>apiServiceOrigins({...service,baseUrl})).toThrow();
  }
});

