import { describe, expect, it } from 'vitest';
import { collectDashboardPages, summarizeDashboardTemplates } from '../../src/web/lib/dashboard';

describe('dashboard template/airport summary from existing lists', () => {
  it('counts every client output and prioritizes failures over healthy siblings', () => {
    const templates = ['ok', 'mixed', 'pending', 'empty'].map((id) => ({ id, baseBody: {} }));
    const output = (templateId: string, lastStatus?: string, needsRebind = false) => ({
      templateId,
      clients: ['mihomo', 'surge'],
      bindings: [{ needsRebind, lastStatus }],
    });
    expect(
      summarizeDashboardTemplates(templates, [
        output('ok', 'ok'),
        output('mixed', 'ok'),
        output('mixed', 'error'),
        output('pending'),
      ]),
    ).toEqual({ templateCount: 4, outputCount: 8, airports: { ok: 1, error: 1, bound: 1, empty: 1 } });
  });

  it('does not invent healthy status for a saved-but-unchecked subscription or an old preview without a binding', () => {
    expect(
      summarizeDashboardTemplates([{ id: 'a', baseBody: { wizardMeta: { previewSummary: { status: 'ok' } } } }], []),
    ).toMatchObject({ airports: { empty: 1, ok: 0 } });
    expect(summarizeDashboardTemplates([], [])).toEqual({
      templateCount: 0,
      outputCount: 0,
      airports: { ok: 0, bound: 0, error: 0, empty: 0 },
    });
    expect(
      summarizeDashboardTemplates(
        [{ id: 'a', baseBody: {} }],
        [{ templateId: 'a', clients: ['mihomo'], bindings: [{ needsRebind: true, lastStatus: 'ok' }] }],
      ),
    ).toMatchObject({ airports: { error: 1, ok: 0 } });
  });

  it('collects all existing cursor pages without exposing truncated global counts', async () => {
    const cursors: Array<string | undefined> = [];
    const items = await collectDashboardPages(async (cursor) => {
      cursors.push(cursor);
      return cursor
        ? { items: [3], hasMore: false, nextCursor: null }
        : { items: [1, 2], hasMore: true, nextCursor: 'next' };
    });
    expect(items).toEqual([1, 2, 3]);
    expect(cursors).toEqual([undefined, 'next']);
  });

  it('fails instead of looping forever on a broken cursor', async () => {
    await expect(collectDashboardPages(async () => ({ items: [], hasMore: true, nextCursor: 'same' }))).rejects.toThrow(
      'Invalid dashboard pagination cursor',
    );
  });
});
