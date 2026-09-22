import {expect,test} from 'bun:test';
import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import {serviceCatalog} from '../extension/ui/options-service-catalog.js';

test('browsing a saved service does not activate it until set as default', async () => {
  const browser=new Window({url:'chrome-extension://example/ui/options.html'});
  const previous={document:globalThis.document,optionsState:globalThis.optionsState,discard:globalThis.optionsDiscardProviderDraft,show:globalThis.optionsShowSavedService,save:globalThis.optionsSavePatch};
  const previousCatalog={...serviceCatalog};
  browser.document.write(readFileSync('extension/ui/options.html','utf8'));
  globalThis.document=browser.document;
  const first={id:'first',name:'OpenAI',providerId:'openai',baseUrl:'https://api.openai.com/v1',model:'gpt-4.1',apiKey:'first-key'};
  const second={id:'second',name:'DeepSeek',providerId:'deepseek',baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',apiKey:'second-key'};
  globalThis.optionsState={settings:{providerKind:'api',apiServices:[first,second],activeApiServiceId:'first'}};
  let displayed='',allowDiscard=true;
  const patches=[];
  globalThis.optionsDiscardProviderDraft=()=>allowDiscard;
  globalThis.optionsShowSavedService=id=>{displayed=id;};
  globalThis.optionsSavePatch=async patch=>{patches.push(patch);Object.assign(globalThis.optionsState.settings,patch);return true;};
  try{
    serviceCatalog.initialized=false;
    serviceCatalog.selectedKey='';
    serviceCatalog.userSelected=false;
    serviceCatalog.sync();
    serviceCatalog.selectService('deepseek');
    expect(displayed).toBe('second');
    expect(globalThis.optionsState.settings.activeApiServiceId).toBe('first');
    expect(browser.document.querySelector('#catalog-hero-set-default').hidden).toBe(false);

    allowDiscard=false;
    serviceCatalog.selectService('openai');
    expect(serviceCatalog.selectedKey).toBe('deepseek');

    await serviceCatalog.makeCurrentServiceDefault();
    expect(patches).toEqual([{providerKind:'api',activeApiServiceId:'second'}]);
    expect(globalThis.optionsState.settings.activeApiServiceId).toBe('second');
  }finally{
    globalThis.document=previous.document;
    globalThis.optionsState=previous.optionsState;
    globalThis.optionsDiscardProviderDraft=previous.discard;
    globalThis.optionsShowSavedService=previous.show;
    globalThis.optionsSavePatch=previous.save;
    Object.assign(serviceCatalog,previousCatalog);
    browser.close();
  }
});
