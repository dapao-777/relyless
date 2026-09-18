import {test,expect} from 'bun:test';
import '../extension/reading-style.js';

const api = globalThis.ShisuiReadingStyle;
const selectors = {mark:'.word-mark',hint:'.short-hint',block:'[data-help="translation"]',annotation:'.word-annotation'};

const complete = overrides => ({
  original:{...api.defaults.original,...overrides?.original},
  annotation:{...api.defaults.annotation,...overrides?.annotation},
  translation:{...api.defaults.translation,...overrides?.translation},
});

test('editing normalized styles never mutates other layers or future defaults', () => {
  const first = api.normalize(null);
  const second = api.normalize(null);
  first.original.color = '#ffffff';
  expect(first.annotation.color).toBe('auto');
  expect(second.original.color).toBe('auto');
  expect(api.defaults.original.color).toBe('auto');
});

test('normalization migrates the legacy shape once while preserving its appearance', () => {
  const migrated = api.normalize({translation:'background',color:'#A0b1C2',size:115,unknown:'discard'});
  expect(migrated).toEqual({
    original:{style:'background',color:'#a0b1c2',size:100},
    annotation:{style:'background',color:'#a0b1c2',size:115},
    translation:{style:'background',color:'#a0b1c2',size:115},
  });
  expect(api.normalize(migrated)).toEqual(migrated);
  const quoted=api.normalize({translation:'quote',color:'#2255aa',size:115});
  expect(quoted.annotation.color).toBe('auto');expect(quoted.translation.color).toBe('#2255aa');
});

test('normalization repairs each new layer independently and drops unknown data', () => {
  expect(api.normalize({
    original:{style:'color',color:'#ABCDEF',size:130,private:'discard'},
    annotation:{style:'broken',color:'#123',size:150},
    translation:null,
    injected:'url(evil)',
  })).toEqual({
    original:{style:'color',color:'#abcdef',size:130},
    annotation:{style:'plain',color:'auto',size:150},
    translation:{style:'default',color:'auto',size:100},
  });
});

test('validation accepts only the complete closed layered protocol', () => {
  expect(api.validate(complete({translation:{style:'quote',color:'#ABCDEF',size:150}}))).toEqual(
    complete({translation:{style:'quote',color:'#abcdef',size:150}}),
  );
  for (const malformed of [
    {translation:'background',color:'#2255aa',size:115},
    {...complete(),extra:true},
    {...complete(),annotation:{...api.defaults.annotation,extra:true}},
    {...complete(),original:{...api.defaults.original,color:'#abc'}},
    {...complete(),annotation:{...api.defaults.annotation,size:99}},
    {...complete(),translation:{...api.defaults.translation,style:'unknown'}},
    {...complete(),original:null},
  ]) expect(() => api.validate(malformed)).toThrow();
});

test('CSS selector boundaries reject rules that could escape into the host page', () => {
  expect(() => api.css(api.defaults,{...selectors,hint:'.hint{color:red}'})).toThrow();
  expect(() => api.css(api.defaults,{...selectors,block:'.block,body'})).toThrow();
  expect(() => api.css(api.defaults,{...selectors,mark:'@layer injected'})).toThrow();
  expect(() => api.css(api.defaults,{...selectors,unknown:'body'})).toThrow();
});
