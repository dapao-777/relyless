// UI changes follow docs/design-system.md; this file is the only token source.
(() => {

  const common = `
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    --serif: Georgia, "Iowan Old Style", "Songti SC", "Noto Serif CJK SC", serif;
    --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    --type-page-title: 22px;
    --type-section-title: 18px;
    --type-word-head: 20px;
    --type-body: 15px;
    --type-control: 14px;
    --type-support: 13px;
    --leading-title: 1.28;
    --leading-body: 1.6;
    --leading-control: 1.4;
    --leading-support: 1.5;
    --weight-regular: 400;
    --weight-medium: 500;
    --weight-semibold: 600;
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 20px;
    --space-6: 24px;
    --space-8: 32px;
    --space-12: 48px;
    --radius-control: 8px;
    --radius-panel: 12px;
    --radius-pill: 999px;
    --focus-ring: 2px solid var(--accent);
    --focus-offset: 2px;
  `;
  const light = `
    color-scheme: light;
    --canvas: #f8f9fa;
    --paper: #ffffff;
    --surface: #ffffff;
    --surface-subtle: #f1f3f4;
    --surface-hover: #e8eaed;
    --ink: #202124;
    --muted: #5f6368;
    --muted-strong: #3c4043;
    --line: #dadce0;
    --line-dark: #80868b;
    --accent: #1967d2;
    --accent-hover: #185abc;
    --accent-soft: #e8f0fe;
    --accent-line: #aecbfa;
    --teal: #176b70;
    --teal-soft: #e8f2ef;
    --teal-line: #b4d8d3;
    --teal-hover: #10585c;
    --on-teal: #ffffff;
    --violet: #70509c;
    --violet-soft: #f2f0f8;
    --violet-line: #d0bce9;
    --action: #1967d2;
    --action-hover: #185abc;
    --on-action: #ffffff;
    --action-disabled: #e8eaed;
    --on-action-disabled: #5f6368;
    --green: #137333;
    --green-soft: #e6f4ea;
    --green-line: #a8dab5;
    --danger: #b3261e;
    --danger-soft: #fce8e6;
    --warning: #7c4a03;
    --warning-soft: #fef7e0;
    --shadow-low: 0 1px 2px #3c404326;
    --shadow-high: 0 2px 6px #3c404326, 0 8px 24px #3c404326;
  `;
  const dark = `
    color-scheme: dark;
    --canvas: #202124;
    --paper: #292a2d;
    --surface: #292a2d;
    --surface-subtle: #35363a;
    --surface-hover: #3c4043;
    --ink: #e8eaed;
    --muted: #bdc1c6;
    --muted-strong: #dadce0;
    --line: #5f6368;
    --line-dark: #9aa0a6;
    --accent: #8ab4f8;
    --accent-hover: #aecbfa;
    --accent-soft: #394457;
    --accent-line: #669df6;
    --teal: #8bd2c9;
    --teal-soft: #2c3635;
    --teal-line: #527f79;
    --teal-hover: #a8e1d9;
    --on-teal: #173b39;
    --violet: #c5aff0;
    --violet-soft: #363346;
    --violet-line: #78668f;
    --action: #8ab4f8;
    --action-hover: #aecbfa;
    --on-action: #202124;
    --action-disabled: #3c4043;
    --on-action-disabled: #bdc1c6;
    --green: #81c995;
    --green-soft: #243d2c;
    --green-line: #5bb974;
    --danger: #f28b82;
    --danger-soft: #4c2927;
    --warning: #fdd663;
    --warning-soft: #493b20;
    --shadow-low: 0 1px 2px #00000040;
    --shadow-high: 0 2px 6px #00000040, 0 8px 24px #00000040;
  `;

  // Explicit selectors keep website roots untouched; Shadow DOM and extension pages
  // consume the same tokens without fetching styles or exposing extension resources.
  const cssFor = (selector, theme = 'auto') => `${selector} { ${common} ${theme === 'dark' ? dark : light} }${theme === 'auto' ? `\n@media (prefers-color-scheme: dark) { ${selector} { ${dark} } }` : ''}`;
  const structureRoles = Object.freeze({clause:Object.freeze(['原句','neutral']),subject:Object.freeze(['主语','subject']),predicate:Object.freeze(['谓语','predicate']),object:Object.freeze(['宾语','object']),predicative:Object.freeze(['表语','object']),complement:Object.freeze(['补语','object']),adverbial:Object.freeze(['状语','adverbial']),attributive:Object.freeze(['定语','attributive'])});
  const structureColors = Object.freeze({subject:Object.freeze(['#3978aa','#6eb6ff']),predicate:Object.freeze(['#ad672b','#ffb15a']),object:Object.freeze(['#397c54','#5dce8a']),adverbial:Object.freeze(['#845ca6','#c9a0ff']),attributive:Object.freeze(['#247f83','#4fd4d6']),neutral:Object.freeze(['#70777c','#c8d0d8'])});
  const sentenceMarkModes = Object.freeze(['wash','underline','bar','overline','ink','trunk','head','dim','bracket','tick','gloss']);
  const sentenceMarkMode = value => sentenceMarkModes.includes(value) ? value : 'wash';
  const sentenceMarkOverlay = mode => mode === 'bracket' || mode === 'tick' || mode === 'gloss';
  const sentenceFunctionWords = new Set('a an the to of in on for with by from as at into onto over after before when while if because although though since until unless where that which who whom whose and or but nor so yet not no than then them they their this these those it its be is are was were been being do does did doing have has had having will would can could should may might must shall about across against among around behind between during without within upon per via each every some any both few many much all another'.split(' '));
  function sentenceHeadOffsets(text) {
    const words = [...String(text || '').matchAll(/[A-Za-z]+(?:'[A-Za-z]+)?/g)];
    if (!words.length) return null;
    const content = words.filter(word => !sentenceFunctionWords.has(word[0].toLowerCase()));
    const pool = content.length ? content : words;
    const relativizer = words.find(word => word.index > 0 && /^(?:that|which|who|whom|whose)$/i.test(word[0]));
    const before = relativizer ? pool.findLast(word => word.index < relativizer.index) : null;
    const chosen = before || pool.at(-1);
    return [chosen.index, chosen.index + chosen[0].length];
  }
  function sentenceMarkCss(name, mode, color, nested, dark) {
    const amount = nested ? (dark ? 24 : 18) : (dark ? 40 : 32);
    const decoration = (line, thickness, skip) => '::highlight(' + name + '){text-decoration-line:' + line + ';text-decoration-color:' + color + ';text-decoration-thickness:' + thickness + ';text-underline-offset:3px;text-decoration-skip-ink:' + skip + '}';
    if (mode === 'underline') return decoration('underline', '1.5px', 'auto');
    if (mode === 'bar') return decoration('underline', '3px', 'none');
    if (mode === 'overline') return decoration('overline', '2px', 'none');
    if (mode === 'ink') return '::highlight(' + name + '){color:' + color + '}';
    if (mode === 'dim') return '::highlight(' + name + '){color:' + (dark ? '#9aa0a6' : '#5c6166') + '}';
    if (sentenceMarkOverlay(mode)) return '';
    return '::highlight(' + name + '){background-color:color-mix(in srgb,' + color + ' ' + amount + '%,transparent)}';
  }
  globalThis.ShisuiDesign = Object.freeze({cssFor,structureRoles,structureColors,sentenceMarkModes,sentenceMarkMode,sentenceMarkOverlay,sentenceHeadOffsets,sentenceMarkCss});

  // Only extension-owned HTML opts into page-root tokens. Script injection into a
  // website has no currentScript and must never apply this theme to the website.
  if (document.currentScript?.hasAttribute('data-shisui-page')) {
    const style = document.createElement('style');
    style.dataset.shisuiUi = 'design-tokens';
    style.textContent = cssFor(':root');
    document.head.append(style);
  }
})();
