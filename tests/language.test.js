import {expect,test} from 'bun:test';
import {identifyPageLanguage} from '../extension/lexicon.js';

const english = `The extension only shows a short hint when a sentence is genuinely new to you.
It keeps the original English on the page and adds a small note next to the word you asked about.
Because the page is mostly English, reading support can start without any extra step from you.`;

const chinese = `这个扩展只在你真正遇到新句子的时候给出简短的提示，它会保留页面上的英文原文。
你不会看到整页被替换成翻译，因为这样做的目的是让你继续读原文，而不是依赖译文。
当页面没有英文正文的时候，它应该尽快停止，不要继续扫描整个网页。`;

const japanese = `この拡張機能は、あなたが本当に初めて読む文のときだけ短いヒントを表示します。
ページの英語はそのまま残り、調べた言葉の横に小さな注釋が加わるだけです。
全文が翻訳で置き換わることはありません。`;

const korean = `이 확장 프로그램은 당신이 처음 읽는 문장에서만 짧은 힌트를 보여줍니다.
페이지의 영어는 그대로 남아 있고, 찾아본 단어 옆에 작은 설명이 추가될 뿐입니다.
전체 페이지가 번역으로 바뀌지는 않습니다.`;

const german = `Die Erweiterung zeigt nur einen kurzen Hinweis, wenn ein Satz für dich wirklich neu ist.
Sie lässt den englischen Originaltext auf der Seite und ergänzt nur eine kleine Notiz neben dem Wort.
Die Seite wird nicht komplett durch eine Übersetzung ersetzt, damit du weiterhin Originale liest.`;

const french = `L'extension affiche seulement une indication courte lorsqu'une phrase est vraiment nouvelle pour vous.
Elle garde le texte anglais original sur la page et ajoute une petite note à côté du mot.
La page n'est pas remplacée par une traduction complète, afin que vous continuiez à lire l'original.`;

const spanish = `La extensión solo muestra una sugerencia breve cuando una frase es realmente nueva para ti.
Conserva el inglés original en la página y agrega una pequeña nota junto a la palabra.
La página no se reemplaza por una traducción completa, para que sigas leyendo el original.`;

test('english body is identified as english', () => {
  const profile = identifyPageLanguage(english);
  expect(profile.status).toBe('identified');
  expect(profile.languages).toEqual(['en']);
});

test('chinese, japanese and korean bodies are identified as their own languages', () => {
  expect(identifyPageLanguage(chinese).languages).toEqual(['zh']);
  expect(identifyPageLanguage(japanese).languages).toEqual(['ja']);
  expect(identifyPageLanguage(korean).languages).toEqual(['ko']);
});

test('german, french and spanish bodies are identified without english word confusion', () => {
  expect(identifyPageLanguage(german).languages).toEqual(['de']);
  expect(identifyPageLanguage(french).languages).toEqual(['fr']);
  expect(identifyPageLanguage(spanish).languages).toEqual(['es']);
});

test('mixed body reports mixed and keeps english evidence for the reading gate', () => {
  const profile = identifyPageLanguage(`${chinese}\n${english}`);
  expect(profile.status).toBe('mixed');
  expect(profile.languages).toContain('latin');
  expect(profile.languages).toContain('han');
  const evidence = profile.english;
  expect(evidence.tokens).toBeGreaterThanOrEqual(12);
  expect(evidence.recognized / evidence.tokens).toBeGreaterThanOrEqual(0.6);
  expect(evidence.functionWords).toBeGreaterThanOrEqual(2);
});

test('a chinese page quoting a few english words is not english evidence', () => {
  const profile = identifyPageLanguage(`本站支持 OpenAI、Anthropic 与 Google 的 API Key。
所有处理都在本地完成，Key 不会上传到任何服务器。`);
  expect(profile.status).toBe('mixed');
  expect(profile.languages).toContain('han');
  expect(profile.english.tokens).toBeLessThan(12);
  expect(profile.english.functionWords).toBeLessThan(2);
});

test('text without letters is empty rather than unknown english', () => {
  const profile = identifyPageLanguage('123 456 --- ... 42%');
  expect(profile.status).toBe('empty');
  expect(profile.languages).toEqual([]);
});

test('latin text with no confident language stays unknown so scanning stops', () => {
  const profile = identifyPageLanguage('Xyzzy plugh frobnicate quux blorpt snarf glorp wibble frotz zimbus trebek');
  expect(profile.status).toBe('unknown');
  expect(profile.languages).toEqual([]);
});
