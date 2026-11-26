import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/shared/errors';
import {
  decryptNodeSecret,
  encryptNodeSecret,
  maskSubscriptionUrl,
  requireExplicitSessionSecret,
} from '../../src/infrastructure/crypto/node-secrets';

const SECRET_A = 'explicit-session-secret-at-least-32-chars-aaaa';
const SECRET_B = 'explicit-session-secret-at-least-32-chars-bbbb';

describe('HKDF + AES-GCM node secret encryption', () => {
  it('round-trips plaintext with fresh random IVs and optional AAD', async () => {
    const url = 'https://airport.example.com/api/client/subscribe?token=secret-token&flag=meta';
    const first = await encryptNodeSecret(url, SECRET_A, 'pub-1:slot-a');
    const second = await encryptNodeSecret(url, SECRET_A, 'pub-1:slot-a');

    expect(first).not.toBe(second);
    expect(first).not.toContain('secret-token');
    expect(first.startsWith('enc:aes-256-gcm:')).toBe(true);

    expect(await decryptNodeSecret(first, SECRET_A, 'pub-1:slot-a')).toBe(url);
    expect(await decryptNodeSecret(second, SECRET_A, 'pub-1:slot-a')).toBe(url);
  });

  it.each([undefined, '', '   '])('throws SESSION_SECRET_REQUIRED (503) when SESSION_SECRET is %j', async (missing) => {
    expect(() => requireExplicitSessionSecret(missing)).toThrowError(AppError);
    try {
      requireExplicitSessionSecret(missing);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('SESSION_SECRET_REQUIRED');
      expect((error as AppError).status).toBe(503);
    }

    await expect(encryptNodeSecret('https://sub.example/a', missing)).rejects.toMatchObject({
      code: 'SESSION_SECRET_REQUIRED',
      status: 503,
    });
    await expect(decryptNodeSecret('enc:aes-256-gcm:abc:def', missing)).rejects.toMatchObject({
      code: 'SESSION_SECRET_REQUIRED',
      status: 503,
    });
  });

  it('rejects wrong secret, wrong AAD, and tampered ciphertext', async () => {
    const encrypted = await encryptNodeSecret('https://sub.example/secret', SECRET_A, 'pub-1:slot-a');

    await expect(decryptNodeSecret(encrypted, SECRET_B, 'pub-1:slot-a')).rejects.toBeInstanceOf(AppError);
    await expect(decryptNodeSecret(encrypted, SECRET_A, 'pub-1:slot-b')).rejects.toBeInstanceOf(AppError);

    const lastChar = encrypted.endsWith('A') ? 'B' : 'A';
    const tampered = `${encrypted.slice(0, -1)}${lastChar}`;
    await expect(decryptNodeSecret(tampered, SECRET_A, 'pub-1:slot-a')).rejects.toBeInstanceOf(AppError);
  });

  it('masks subscription URLs to scheme and host only', () => {
    expect(maskSubscriptionUrl('https://sub.example.com:8443/path/to/sub?token=xyz')).toBe(
      'https://sub.example.com:8443/***',
    );
    expect(maskSubscriptionUrl('not-a-url')).toBe('***');
  });
});
