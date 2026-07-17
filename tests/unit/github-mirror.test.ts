import { describe, expect, it } from 'vitest';
import { rewriteGithubUrl, sourceNameFromSubscriptionUrl } from '../../src/lib/github-mirror';

const rawUrl = 'https://raw.githubusercontent.com/ddgksf2013/Filter/refs/heads/master/AppleIntelligence.list';

describe('GitHub URL rewriting', () => {
  it.each([
    'https://cdn.jsdelivr.net',
    'https://fastly.jsdelivr.net',
    'https://testingcf.jsdelivr.net',
  ])('rewrites raw GitHub files for %s', (mirror) => {
    expect(rewriteGithubUrl(rawUrl, mirror)).toBe(`${mirror}/gh/ddgksf2013/Filter@master/AppleIntelligence.list`);
  });

  it('supports custom proxy templates', () => {
    expect(rewriteGithubUrl(rawUrl, 'https://proxy.example/{owner}/{repo}/{ref}/{path}'))
      .toBe('https://proxy.example/ddgksf2013/Filter/master/AppleIntelligence.list');
  });

  it('prefixes the original URL for a custom proxy without a template', () => {
    expect(rewriteGithubUrl(rawUrl, 'https://proxy.example'))
      .toBe(`https://proxy.example/${rawUrl}`);
  });

  it('does not rewrite non-GitHub subscriptions', () => {
    expect(rewriteGithubUrl('https://example.com/115.list', 'https://cdn.jsdelivr.net')).toBe('https://example.com/115.list');
  });
});

describe('subscription source names', () => {
  it('uses the GitHub owner for raw and jsDelivr URLs', () => {
    expect(sourceNameFromSubscriptionUrl(rawUrl)).toBe('ddgksf2013');
    expect(sourceNameFromSubscriptionUrl('https://fastly.jsdelivr.net/gh/ddgksf2013/Filter@master/AppleIntelligence.list')).toBe('ddgksf2013');
    expect(sourceNameFromSubscriptionUrl('https://testingcf.jsdelivr.net/gh/ddgksf2013/Filter@master/AppleIntelligence.list')).toBe('ddgksf2013');
  });

  it('falls back to the final filename without its extension', () => {
    expect(sourceNameFromSubscriptionUrl('https://example.com/rules/115.list')).toBe('115');
    expect(sourceNameFromSubscriptionUrl('https://example.com/rules/Apple.yaml')).toBe('Apple');
  });
});
