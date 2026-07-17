export function preferHttpsLink(url: string) {
  if (!url || window.location.protocol !== 'https:') return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return url;
  }
}
