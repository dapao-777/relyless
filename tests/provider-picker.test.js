import {expect, test} from 'bun:test';
import {Window} from 'happy-dom';
import {createProviderPicker} from '../extension/ui/provider-picker.js';

test('provider picker initializes and updates its selected logo', () => {
  const browser = new Window({url:'chrome-extension://example/ui/options.html'});
  const previous = {
    document:globalThis.document,
    window:globalThis.window,
    Option:globalThis.Option,
  };
  globalThis.document = browser.document;
  globalThis.window = browser;
  globalThis.Option = function Option(text,value) {
    const option=browser.document.createElement('option');
    option.textContent=text;
    option.value=value;
    return option;
  };
  try {
    browser.document.body.innerHTML = '<div><select></select><button role="combobox"><img><span></span></button><div role="listbox"></div></div>';
    const select = browser.document.querySelector('select');
    const picker = createProviderPicker(select, [
      {id:'openai',name:'OpenAI'},
      {id:'openai-compatible',name:'Custom API'},
    ]);
    const logo = browser.document.querySelector('[role="combobox"] img');
    expect(logo.getAttribute('src')).toBe('../icons/providers/openai.svg');
    select.value = 'openai-compatible';
    picker.sync();
    expect(logo.getAttribute('src')).toBe('../icons/providers/custom-api.svg');
  } finally {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.Option = previous.Option;
    browser.close();
  }
});
