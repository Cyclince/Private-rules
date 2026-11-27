/**
 * Direction-aware page transition rules for M4a.
 *
 * The decision is intentionally pure so it can be unit-tested and shared by the
 * router bridge (View Transitions data attribute) and the CSS fallback. The
 * history index comes from TanStack history (`location.state.__TSR_index`), so
 * browser back/forward and pushed "return" links can be told apart from a
 * same-level section switch.
 */

export type NavigationMotion = 'fade' | 'forward' | 'back';

export type NavigationLocation = {
  pathname: string;
  /** TanStack history index; `null` when unknown (first render, restored state). */
  historyIndex?: number | null;
};

const SECTION_PATHS = new Set(['/', '/rules', '/subscriptions', '/templates', '/settings']);

const DETAIL_PATH_PATTERNS = [
  /^\/rules\/[^/]+$/,
  /^\/subscriptions\/[^/]+$/,
  // `/templates/new`, `/templates/groups` and `/templates/scenes` are sub-pages, not entity details.
  /^\/templates\/(?!new$|groups$|scenes$)[^/]+$/,
];

/** Strips the `/admin` basepath and trailing slashes so rules can match on either form. */
export function normalizePathname(pathname: string): string {
  const withoutBase = pathname.replace(/^\/admin(?=\/|$)/, '');
  const trimmed = withoutBase.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function isSectionPath(pathname: string): boolean {
  return SECTION_PATHS.has(normalizePathname(pathname));
}

export function isDetailPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return DETAIL_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Returns the navigation depth used as a fallback signal: overview is 0,
 * section pages are 1, detail and sub pages are 2 or more.
 */
export function pathDepth(pathname: string): number {
  const normalized = normalizePathname(pathname);
  if (normalized === '/') return 0;
  return normalized.split('/').filter(Boolean).length;
}

const DETAIL_PARENT: Readonly<Record<string, string>> = {
  rules: '/rules',
  subscriptions: '/subscriptions',
  templates: '/templates',
};

/** Section a detail page belongs to, e.g. `/rules/abc` -> `/rules`. */
export function detailParentPath(pathname: string): string | null {
  const normalized = normalizePathname(pathname);
  if (!DETAIL_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) return null;
  const [section] = normalized.split('/').filter(Boolean);
  return DETAIL_PARENT[section] ?? null;
}

/**
 * Resolves which page motion a navigation should use:
 * - `forward`: entering a detail page or a deeper sub page (content slides in from the right)
 * - `back`: leaving a detail page, returning through history, or going one level up
 * - `fade`: same-level section switches (sidebar / bottom nav) and lateral moves
 */
export function resolveNavigationMotion(
  previous: NavigationLocation | null | undefined,
  next: NavigationLocation,
): NavigationMotion {
  if (!previous) return 'fade';

  const previousPath = normalizePathname(previous.pathname);
  const nextPath = normalizePathname(next.pathname);
  if (previousPath === nextPath) return 'fade';

  // A real history step backwards always reverses, whatever the routes are.
  const previousIndex = previous.historyIndex ?? null;
  const nextIndex = next.historyIndex ?? null;
  if (previousIndex !== null && nextIndex !== null && nextIndex < previousIndex) return 'back';

  // Detail pages own the strongest direction cue: list card -> detail slides in.
  // Leaving a detail only reverses when it returns to its own section (back link);
  // jumping to another section (overview/settings) is a lateral move, not a return.
  const previousDetail = isDetailPath(previousPath);
  const nextDetail = isDetailPath(nextPath);
  if (!previousDetail && nextDetail) return 'forward';
  if (previousDetail && !nextDetail) {
    return detailParentPath(previousPath) === nextPath ? 'back' : 'fade';
  }

  // Sidebar / bottom nav switches between top-level sections fade through.
  if (isSectionPath(previousPath) && isSectionPath(nextPath)) return 'fade';

  const previousDepth = pathDepth(previousPath);
  const nextDepth = pathDepth(nextPath);
  if (nextDepth > previousDepth) return 'forward';
  if (nextDepth < previousDepth) return 'back';
  return 'fade';
}

type HistoryStateLike = { __TSR_index?: unknown } | null | undefined;

/** Reads TanStack history's internal index from a router location state. */
export function readHistoryIndex(state: HistoryStateLike): number | null {
  const raw = state?.__TSR_index;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}
