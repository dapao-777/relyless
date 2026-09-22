import {expect,test} from 'bun:test';
import 'fake-indexeddb/auto';
import {createConversationStore} from '../extension/conversation-store.js';
import {isolatedChrome,isolatedSend} from './helpers/chrome-fixture.js';

test('private pages cannot read or delete ordinary-window conversation history', async () => {
  const previousChrome = globalThis.chrome;
  const fixture = isolatedChrome({wordSchemaVersion:5,productSchemaVersion:1,words:[],settings:{}}, {id:'conversation-privacy'});
  const pageUrl = 'https://isolated.example/read';
  const sessionId = 'c'.repeat(64);
  const turnId = 'd'.repeat(36);
  let incognito = false;
  fixture.api.tabs.get = async () => ({id:91,url:pageUrl,active:true,incognito});
  try {
    globalThis.chrome = fixture.api;
    await import(`../extension/background.js?conversation-privacy=${Date.now()}`);
    const store = createConversationStore();
    await store.begin({id:turnId,sessionId,createdAt:Date.now(),question:'Why?',text:'a word',context:'a word in context',domain:'general',kind:'word',level:'hint'});
    await store.finish(turnId,{answer:'Because of the context.',status:'complete'});
    const sender = {url:pageUrl,tab:{id:91,url:pageUrl},frameId:0};
    expect((await isolatedSend(fixture,{type:'CONVERSATION_HISTORY',sessionId},sender)).turns).toHaveLength(1);
    incognito = true;
    expect(await isolatedSend(fixture,{type:'CONVERSATION_HISTORY',sessionId},sender)).toEqual({turns:[]});
    expect(await isolatedSend(fixture,{type:'CONVERSATION_DELETE',sessionId},sender)).toEqual({removed:0});
    incognito = false;
    expect((await isolatedSend(fixture,{type:'CONVERSATION_HISTORY',sessionId},sender)).turns).toHaveLength(1);
    expect(await isolatedSend(fixture,{type:'CONVERSATION_DELETE',sessionId})).toEqual({removed:1});
    expect(await store.list(sessionId)).toHaveLength(0);
  } finally {
    globalThis.chrome = previousChrome;
  }
});
