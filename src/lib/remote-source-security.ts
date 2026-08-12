function privateIpv4(hostname: string) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 10
    || octets[0] === 127
    || octets[0] === 0
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || octets[0] >= 224;
}

export function validateRemoteSourceUrl(raw: string) {
  const input = raw.trim();
  if (!input || input.length > 2048) throw new Error('远程来源 URL 格式错误。');
  const url = new URL(input);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('远程来源仅支持 HTTP 或 HTTPS。');
  if (url.username || url.password) throw new Error('远程来源 URL 不得包含认证信息。');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || hostname === 'metadata.google.internal' || privateIpv4(hostname)
    || hostname === '::1' || hostname === '::' || /^fe[89ab][0-9a-f]:/i.test(hostname) || /^(fc|fd)/i.test(hostname)) {
    throw new Error('远程来源地址被 SSRF 安全策略拒绝。');
  }
  url.hash = '';
  return url.toString();
}
