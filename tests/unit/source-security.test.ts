import { describe, expect, it } from 'vitest';
import { validateRemoteSourceUrl } from '../../src/application/sources/use-cases';

describe('remote source SSRF policy', () => {
  it.each([
    'http://127.0.0.1/rules',
    'http://10.0.0.1/rules',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.1/rules',
    'http://[::1]/rules',
    'http://metadata.google.internal/computeMetadata/v1',
    'file:///etc/passwd',
  ])('rejects %s', (value) => {
    expect(() => validateRemoteSourceUrl(value)).toThrow();
  });

  it('accepts public HTTP(S) sources and strips fragments', () => {
    expect(validateRemoteSourceUrl('https://example.com/rules.list#fragment')).toBe('https://example.com/rules.list');
  });
});
