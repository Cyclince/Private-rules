export type TelegramDeepLink = {
  view: 'dashboard' | 'rules' | 'links' | 'sources';
  category?: string;
  source?: string;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

export function telegramDeepLink(search = window.location.search): TelegramDeepLink {
  const params = new URLSearchParams(search);
  const candidate = params.get('view');
  const view = candidate && ['dashboard', 'rules', 'links', 'sources'].includes(candidate)
    ? candidate as TelegramDeepLink['view']
    : 'dashboard';
  const category = params.get('category') ?? '';
  const source = params.get('source') ?? '';
  return {
    view,
    category: SAFE_ID.test(category) ? category : undefined,
    source: SAFE_ID.test(source) ? source : undefined,
  };
}
