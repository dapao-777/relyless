import {test,expect} from 'bun:test';
import {normalizeDomainRules,resolveRuleDomain} from '../extension/domain-routing.js';

const rules = entries => normalizeDomainRules(entries);
const settings = domainRules => ({domain:'auto',domainRules});

test('explicit page, personal site and global choices take precedence, including general',()=>{
  const url = new URL('https://docs.python.org/3/tutorial/');
  const config = {domain:'legal',domainRules:rules([{host:'docs.python.org',domain:'finance'}])};
  expect(resolveRuleDomain(url,config,'general')).toEqual({domain:'general',source:'manual'});
  expect(resolveRuleDomain(url,config)).toEqual({domain:'finance',source:'site-user'});
  expect(resolveRuleDomain(url,{...config,domainRules:[]})).toEqual({domain:'legal',source:'global'});
});

test('site and path boundaries do not match lookalike domains or prefixes',()=>{
  const config = settings(rules([{host:'example.org',pathPrefix:'/docs',includeSubdomains:true,domain:'data'}]));
  expect(resolveRuleDomain(new URL('https://sub.example.org/docs/query'),config)?.domain).toBe('data');
  expect(resolveRuleDomain(new URL('https://example.org.attacker.test/docs/query'),config)).toBeNull();
  expect(resolveRuleDomain(new URL('https://notexample.org/docs/query'),config)).toBeNull();
  expect(resolveRuleDomain(new URL('https://example.org/docstring'),config)).toBeNull();
});

test('the most specific personal path wins regardless of insertion order',()=>{
  const specific = {host:'example.org',pathPrefix:'/docs/legal',domain:'legal'};
  const broad = {host:'example.org',domain:'tech'};
  const url = new URL('https://example.org/docs/legal/contracts');
  expect(resolveRuleDomain(url,settings(rules([specific,broad])))).toEqual({domain:'legal',source:'site-user'});
  expect(resolveRuleDomain(url,settings(rules([broad,specific])))).toEqual({domain:'legal',source:'site-user'});
});

test('built-in professional routes do not claim an entire user-generated-content host',()=>{
  expect(resolveRuleDomain(new URL('https://www.postgresql.org/docs/current/index.html'),settings([]))).toEqual({domain:'data',source:'site-built-in'});
  expect(resolveRuleDomain(new URL('https://github.com/example/medical-study'),settings([]))).toBeNull();
  expect(()=>rules([{host:'user@example.org',domain:'tech'}])).toThrow();
  expect(()=>rules([{host:'example.org',domain:'tech'},{host:'EXAMPLE.ORG',domain:'data'}])).toThrow();
});
