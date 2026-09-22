import {expect,test} from 'bun:test';
import {CATALOG_TEMPLATES,CATALOG_CATEGORIES,iconUrlFor} from '../extension/ui/options-service-catalog.js';
import {API_PROVIDERS} from '../extension/api-providers.mjs';
test('the catalog lists one entry per supported subscription channel', () => {
  const subscriptions = CATALOG_TEMPLATES.filter(item => item.category === 'subscription');
  expect(subscriptions.map(item => item.id).sort()).toEqual([...SUBSCRIPTION_KINDS].sort());
  for (const kind of SUBSCRIPTION_KINDS) expect(isSubscriptionKind(kind)).toBe(true);
  const grok = subscriptions.find(item => item.id === 'grok');
  expect(grok.icon).toBe('xai');
  expect(subscriptions.find(item => item.id === 'antigravity').icon).toBe('google');
});

test('api providers are grouped into known categories', () => {  const categories = new Set(CATALOG_CATEGORIES.map(category => category.id));
  for (const item of CATALOG_TEMPLATES) expect(categories.has(item.category)).toBe(true);
  expect(CATALOG_TEMPLATES.filter(item => item.category === 'custom').length).toBeGreaterThan(0);
  expect(CATALOG_TEMPLATES.filter(item => item.category === 'popular').map(item => item.id)).toContain('deepseek');
});

test('icon urls fall back to the custom icon', () => {
  expect(iconUrlFor('deepseek')).toBe('../icons/providers/deepseek.svg');
  expect(iconUrlFor('')).toBe('../icons/providers/custom-api.svg');
  expect(iconUrlFor('missing-provider')).toBe('../icons/providers/missing-provider.svg');
});
