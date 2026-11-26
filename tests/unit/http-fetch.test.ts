import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FETCH_MAX_BYTES,
  DEFAULT_FETCH_TIMEOUT_MS,
  isBlockedIpAddress,
  safeFetch,
  safeFetchText,
  validateRemoteSourceUrl,
} from '../../src/infrastructure/http/fetch';

describe('unified SSRF-safe HTTP client', () => {
  it('uses design §14 defaults of 15s timeout and 20MB max bytes', () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(15_000);
    expect(DEFAULT_FETCH_MAX_BYTES).toBe(20 * 1024 * 1024);
  });

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::192.168.1.1',
  ])('blocks private or reserved IP %s', (ip) => {
    expect(isBlockedIpAddress(ip)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '::ffff:1.1.1.1'])(
    'allows public IP %s',
    (ip) => {
      expect(isBlockedIpAddress(ip)).toBe(false);
    },
  );

  it.each([
    'http://localhost/rules',
    'http://api.localhost/rules',
    'http://printer.local/rules',
    'http://service.internal/rules',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://[::ffff:127.0.0.1]/rules',
    'http://user:pass@example.com/rules',
    'ftp://example.com/rules',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => validateRemoteSourceUrl(url)).toThrow();
  });

  it('blocks hostnames whose DNS resolves to a private IPv4 or IPv6 address', async () => {
    let fetchCalled = false;
    const stubFetch: typeof fetch = async () => {
      fetchCalled = true;
      return new Response('ok');
    };

    for (const resolved of [['127.0.0.1'], ['10.20.30.40'], ['::1'], ['fd00::1'], ['1.1.1.1', '169.254.169.254']]) {
      await expect(
        safeFetch('https://rebind.example.com/rules.list', {
          fetchImpl: stubFetch,
          resolveDns: async () => resolved,
        }),
      ).rejects.toThrow('SSRF');
    }
    expect(fetchCalled).toBe(false);
  });

  it('forbids redirects by default', async () => {
    const stubFetch: typeof fetch = async () =>
      new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/final.list' } });

    await expect(
      safeFetch('https://rules.example.com/start.list', {
        fetchImpl: stubFetch,
        resolveDns: async () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('禁止重定向');
  });

  it('validates every redirect hop when maxRedirects > 0', async () => {
    const visited: string[] = [];
    const safeStub: typeof fetch = async (input) => {
      const url = String(input);
      visited.push(url);
      if (url.endsWith('/start.list')) {
        return new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/final.list' } });
      }
      return new Response('DOMAIN-SUFFIX,example.com', { status: 200 });
    };

    const result = await safeFetchText('https://rules.example.com/start.list', {
      maxRedirects: 2,
      fetchImpl: safeStub,
      resolveDns: async () => ['93.184.216.34'],
    });
    expect(result.text).toBe('DOMAIN-SUFFIX,example.com');
    expect(visited).toEqual(['https://rules.example.com/start.list', 'https://cdn.example.com/final.list']);

    // Hop redirecting to a private target must be rejected
    const ssrfRedirectStub: typeof fetch = async () =>
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
    await expect(
      safeFetch('https://rules.example.com/start.list', {
        maxRedirects: 2,
        fetchImpl: ssrfRedirectStub,
        resolveDns: async () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('SSRF');
  });

  it('aborts hanging upstream requests after timeoutMs', async () => {
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });

    await expect(
      safeFetch('https://slow.example.com/rules.list', {
        timeoutMs: 30,
        fetchImpl: hangingFetch,
        resolveDns: async () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('超时');
  });

  it('enforces maxBytes on both Content-Length and chunked streams', async () => {
    const headerOversize: typeof fetch = async () =>
      new Response('tiny', { status: 200, headers: { 'content-length': '1024' } });
    await expect(
      safeFetch('https://big.example.com/a', {
        maxBytes: 100,
        fetchImpl: headerOversize,
        resolveDns: async () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('大小限制');

    let cancelled = false;
    let pulled = 0;
    const streamingOversize: typeof fetch = async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(60));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(stream, { status: 200 });
    };

    await expect(
      safeFetch('https://big.example.com/b', {
        maxBytes: 100,
        fetchImpl: streamingOversize,
        resolveDns: async () => ['93.184.216.34'],
      }),
    ).rejects.toThrow('大小限制');
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(3);
  });
});
