import {expect,test} from 'bun:test';
import {CATALOG_TEMPLATES,CATALOG_CATEGORIES,iconUrlFor} from '../extension/ui/options-service-catalog.js';
import {API_PROVIDERS} from '../extension/api-providers.mjs';
import {SUBSCRIPTION_KINDS,isSubscriptionKind} from '../extension/subscription.js';

test('every api provider appears exactly once in the catalog', () => {
  const apiEntries = CATALOG_TEMPLATES.filter(item => API_PROVIDERS.some(provider => provider.id === item.id));
  expect(apiEntries).toHaveLength(API_PROVIDERS.length);
  for (const provider of API_PROVIDERS) {
    const entry = CATALOG_TEMPLATES.find(item => item.id === provider.id);
    expect(entry.name).toBe(provider.name);
    expect(entry.keyOptional).toBe(provider.keyOptional === true);
  }
});

test('the catalog lists one entry per supported subscription channel', () => {
  const subscriptions = CATALOG_TEMPLATES.filter(item => item.category === 'subscription');
  // 本机模型（Gemini Nano）与订阅通道同组，但不是连接器订阅。
  expect(subscriptions.map(item => item.id).sort()).toEqual(['local', ...SUBSCRIPTION_KINDS].sort());
  for (const kind of SUBSCRIPTION_KINDS) expect(isSubscriptionKind(kind)).toBe(true);
  expect(isSubscriptionKind('local')).toBe(false);
  expect(subscriptions.find(item => item.id === 'grok').icon).toBe('xai');
  expect(subscriptions.find(item => item.id === 'antigravity').icon).toBe('google');
});

test('api providers are grouped into known categories', () => {
  const categories = new Set(CATALOG_CATEGORIES.map(category => category.id));
  for (const item of CATALOG_TEMPLATES) expect(categories.has(item.category)).toBe(true);
  expect(CATALOG_TEMPLATES.filter(item => item.category === 'custom').length).toBeGreaterThan(0);
  expect(CATALOG_TEMPLATES.filter(item => item.category === 'popular').map(item => item.id)).toContain('deepseek');
});

test('icon urls fall back to the custom icon', () => {
  expect(iconUrlFor('deepseek')).toBe('../icons/providers/deepseek.svg');
  expect(iconUrlFor('')).toBe('../icons/providers/custom-api.svg');
  expect(iconUrlFor('missing-provider')).toBe('../icons/providers/missing-provider.svg');
});

test('every catalog icon resolves to a real svg file', () => {
  const {existsSync, readFileSync} = require('node:fs');
  const path = require('node:path');
  const iconsDir = path.join(import.meta.dir, '..', 'extension', 'icons', 'providers');
  const used = new Set(CATALOG_TEMPLATES.map(item => iconUrlFor(item.icon)));
  used.add(iconUrlFor(''));
  const iconUrls = [...used].map(url => url.replace('../icons/providers/', ''));
  for (const file of iconUrls) {
    expect(existsSync(path.join(iconsDir, file)), file + ' 缺失').toBe(true);
    const head = readFileSync(path.join(iconsDir, file), 'utf8').trimStart().slice(0, 200).toLowerCase();
    expect(head.includes('<svg'), file + ' 不是有效 SVG').toBe(true);
  }
  const providersWithoutIcon = API_PROVIDERS.map(provider => provider.id).filter(id => !existsSync(path.join(iconsDir, `${id}.svg`)));
  for (const id of providersWithoutIcon) expect(iconUrlFor(id)).toContain('custom-api.svg');
});
