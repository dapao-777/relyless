import {expect,test} from 'bun:test';
import 'fake-indexeddb/auto';
import {isolatedChrome,isolatedSend} from './helpers/chrome-fixture.js';

test('a saved multi-key service can be disconnected without changing other services', async () => {
  const previousChrome = globalThis.chrome;
  const service = (id, keys) => ({id,name:id,providerId:'openai',baseUrl:'https://api.openai.com/v1',model:'gpt-4.1',apiKey:keys[0]||'',apiKeys:keys,options:{}});
  const fixture = isolatedChrome({wordSchemaVersion:5,productSchemaVersion:1,words:[],settings:{providerKind:'api',apiServices:[service('first',['old','backup']),service('second',['kept'])],activeApiServiceId:'first'}}, {id:'provider-disconnect'});
  try {
    globalThis.chrome = fixture.api;
    await import(`../extension/background.js?provider-disconnect=${Date.now()}`);
    const before = await isolatedSend(fixture,{type:'STATE_GET'});
    const disconnected = before.settings.apiServices.map(item => item.id==='first'?{...item,apiKey:'',apiKeys:[]}:item);
    const after = await isolatedSend(fixture,{type:'STATE_PATCH',patch:{apiServices:disconnected}});
    expect(after.settings.apiServices.find(item => item.id==='first')).toMatchObject({apiKey:'',apiKeys:[]});
    expect(after.settings.apiServices.find(item => item.id==='second')).toMatchObject({apiKey:'kept',apiKeys:['kept']});
    await expect(isolatedSend(fixture,{type:'STATE_PATCH',patch:{apiServices:[...disconnected,service('new',[])]}})).rejects.toThrow('API Key');
  } finally {
    globalThis.chrome = previousChrome;
  }
});
