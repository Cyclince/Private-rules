import { AppError } from '../../shared/errors';

const HKDF_INFO = 'private-rules/node-bindings';
const HKDF_SALT = 'private-rules/node-bindings/salt';
const CIPHERTEXT_PREFIX = 'enc:aes-256-gcm:';
const IV_LENGTH_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid base64url encoding');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Ensures an explicit `SESSION_SECRET` environment variable was supplied.
 * Node subscription encryption MUST NOT fall back to a database-stored secret
 * (design §8.4).
 */
export function requireExplicitSessionSecret(explicitSessionSecret: string | undefined): string {
  const secret = explicitSessionSecret?.trim() ?? '';
  if (!secret) {
    throw new AppError('SESSION_SECRET_REQUIRED', '节点订阅绑定需要显式配置环境变量 SESSION_SECRET。');
  }
  return secret;
}

/**
 * Derives an AES-256-GCM key from the explicit `SESSION_SECRET` env var using
 * HKDF-SHA256 with `info = "private-rules/node-bindings"` (design §8.4).
 */
export async function deriveNodeBindingKey(explicitSessionSecret: string | undefined): Promise<CryptoKey> {
  const secret = requireExplicitSessionSecret(explicitSessionSecret);
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(HKDF_INFO),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts a sensitive node subscription URL or node snapshot payload with
 * AES-256-GCM and a fresh 96-bit random IV.
 */
export async function encryptNodeSecret(
  plaintext: string,
  explicitSessionSecret: string | undefined,
  aad?: string,
): Promise<string> {
  const key = await deriveNodeBindingKey(explicitSessionSecret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      ...(aad !== undefined ? { additionalData: encoder.encode(aad) } : {}),
    },
    key,
    encoder.encode(plaintext),
  );
  return `${CIPHERTEXT_PREFIX}${toBase64Url(iv)}:${toBase64Url(new Uint8Array(encrypted))}`;
}

/**
 * Decrypts a ciphertext produced by `encryptNodeSecret`. Throws
 * `SESSION_SECRET_REQUIRED` when the explicit env secret is missing, or a
 * generic decryption error when the secret changed or ciphertext was tampered.
 */
export async function decryptNodeSecret(
  ciphertext: string,
  explicitSessionSecret: string | undefined,
  aad?: string,
): Promise<string> {
  const key = await deriveNodeBindingKey(explicitSessionSecret);
  if (!ciphertext.startsWith(CIPHERTEXT_PREFIX)) {
    throw new AppError('VALIDATION_FAILED', '密文格式无效。');
  }
  const rest = ciphertext.slice(CIPHERTEXT_PREFIX.length);
  const parts = rest.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AppError('VALIDATION_FAILED', '密文格式无效。');
  }
  try {
    const iv = fromBase64Url(parts[0]);
    const payload = fromBase64Url(parts[1]);
    if (iv.byteLength !== IV_LENGTH_BYTES) {
      throw new Error('Invalid IV length');
    }
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as Uint8Array<ArrayBuffer>,
        ...(aad !== undefined ? { additionalData: encoder.encode(aad) } : {}),
      },
      key,
      payload as Uint8Array<ArrayBuffer>,
    );
    return decoder.decode(decrypted);
  } catch {
    throw new AppError('VALIDATION_FAILED', '无法解密节点绑定数据，请确认 SESSION_SECRET 未变更并重新填写订阅地址。');
  }
}

/** Masks a subscription URL for display, keeping only scheme and host. */
export function maskSubscriptionUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return '***';
  }
}
