import {expect,test} from 'bun:test';
import {RULE_PACK_LIMITS,parseRulePack,matchRule,normalizeRulePacks} from '../extension/rule-pack.js';

const validPack = {
  version: 1,
  id: 'my-sites',
  name: '我的站点',
  rules: [
    {id: 'docs', hosts: ['docs.example.com'], exclude: ['.promo', '.sidebar'], root: 'main', lang: 'en'},
    {id: 'blog', hosts: ['example.com', '.example.com'], paths: ['/blog']},
  ],
};

test('a valid rule pack parses with normalized hosts and defaults', () => {
  const {pack, issues} = parseRulePack(validPack);
  expect(issues).toEqual([]);
  expect(pack.version).toBe(1);
  expect(pack.id).toBe('my-sites');
  expect(pack.rules[0]).toEqual({id: 'docs', hosts: ['docs.example.com'], paths: [], exclude: ['.promo', '.sidebar'], root: 'main', lang: 'en'});
  expect(pack.rules[1].hosts).toEqual(['example.com']);
  expect(pack.rules[1].paths).toEqual(['/blog']);
  expect(pack.rules[1].exclude).toEqual([]);
  expect(pack.rules[1].root).toBe('');
  expect(pack.rules[1].lang).toBe('');
});

test('prototype pollution and unknown fields are rejected', () => {
  const payload = JSON.parse('{"version":1,"rules":[{"hosts":["example.com"],"constructor":{"polluted":true},"exclude":["div"]}]}');
  const {pack, issues} = parseRulePack(payload);
  expect(pack).toBeNull();
  expect(issues.some(issue => issue.path.endsWith('.constructor'))).toBe(true);
  expect(Object.prototype.polluted).toBeUndefined();

  const {pack: absent, issues: unknownIssues} = parseRulePack({version: 1, rules: [{hosts: ['example.com'], nope: 1}]});
  expect(absent).toBeNull();
  expect(unknownIssues.some(issue => issue.message === '不支持的字段')).toBe(true);
});

test('capacity, selector balance and language declarations are enforced', () => {
  const {pack: oversize} = parseRulePack({version: 1, rules: [{hosts: ['example.com'], exclude: Array.from({length: RULE_PACK_LIMITS.selectors + 1}, () => 'div')}]});
  expect(oversize).toBeNull();
  const {pack: unbalanced, issues: balanceIssues} = parseRulePack({version: 1, rules: [{hosts: ['example.com'], exclude: ['div[x']}]});
  expect(unbalanced).toBeNull();
  expect(balanceIssues.some(issue => issue.path.endsWith('.exclude[0]'))).toBe(true);
  const {pack: wrongLang} = parseRulePack({version: 1, rules: [{hosts: ['example.com'], lang: 'zh'}]});
  expect(wrongLang).toBeNull();
  const {pack: wrongVersion} = parseRulePack({version: 2, rules: [{hosts: ['example.com']}]});
  expect(wrongVersion).toBeNull();
  const {pack: noRules} = parseRulePack({version: 1, rules: []});
  expect(noRules).toBeNull();
  const {pack: badHost} = parseRulePack({version: 1, rules: [{hosts: ['not a domain']}]});
  expect(badHost).toBeNull();
});

test('matching prefers the first rule whose host and path prefix fit', () => {
  const packs = normalizeRulePacks([validPack]);
  expect(matchRule(packs, {hostname: 'docs.example.com', pathname: '/guide/intro'})?.id).toBe('docs');
  expect(matchRule(packs, {hostname: 'example.com', pathname: '/blog/post'})?.id).toBe('blog');
  expect(matchRule(packs, {hostname: 'example.com', pathname: '/about'})).toBeNull();
  expect(matchRule(packs, {hostname: 'other.example.org', pathname: '/'})).toBeNull();
  expect(matchRule(null, {hostname: 'example.com'})).toBeNull();
});

test('normalizeRulePacks drops invalid packs, dedupes ids and caps the count', () => {
  const packs = normalizeRulePacks([validPack, {version: 1, rules: []}, {...validPack, name: '重名'}]);
  expect(packs).toHaveLength(1);
  expect(packs[0].id).toBe('my-sites');
  const many = normalizeRulePacks(Array.from({length: RULE_PACK_LIMITS.packs + 3}, (_value, index) => ({version: 1, id: `pack-${index}`, rules: [{hosts: [`site${index}.com`]}]})));
  expect(many).toHaveLength(RULE_PACK_LIMITS.packs);
  expect(normalizeRulePacks('nope')).toEqual([]);
});
