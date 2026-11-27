import { ChevronDown, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { api, readApiJson } from '../../lib/api';
import { CategoryIcon } from '../subscriptions/CategoryIcon';
import { Input } from '../ui/input';

export const PRESET_ICON_PACKS = [
  {
    label: 'Qure Color',
    url: 'https://raw.githubusercontent.com/Koolson/Qure/master/Other/QureColor-All.json',
  },
] as const;

type PackIcon = { name: string; url: string };

function readPackIcons(payload: unknown): PackIcon[] {
  if (Array.isArray(payload)) return payload as PackIcon[];
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.icons)) return record.icons as PackIcon[];
  return Object.entries(record)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, url]) => ({ name, url }));
}

type IconPickerProps = {
  value: string;
  name: string;
  customPackUrls?: string[];
  customPackNames?: Record<string, string>;
  onChange: (url: string) => void;
};

export function IconPicker({ value, name, customPackUrls = [], customPackNames = {}, onChange }: IconPickerProps) {
  const { t } = useI18n();
  const packs = useMemo(
    () => [
      ...PRESET_ICON_PACKS,
      ...customPackUrls.map((url, index) => ({
        label: customPackNames[url]?.trim() || `${t('ruleDialog.iconCustomPackPrefix')} ${index + 1}`,
        url,
      })),
    ],
    [customPackNames, customPackUrls, t],
  );

  const [open, setOpen] = useState(false);
  const [packUrl, setPackUrl] = useState<string>(packs[0]?.url ?? '');
  const [icons, setIcons] = useState<PackIcon[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!packs.some((pack) => pack.url === packUrl)) {
      setPackUrl(packs[0]?.url ?? '');
    }
  }, [packs, packUrl]);

  useEffect(() => {
    if (!open || !packUrl) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    void (async () => {
      try {
        const res = await api.api['icon-packs'].content.$get({ query: { url: packUrl } });
        const payload = await readApiJson<{ icons?: unknown }>(res);
        if (!active) return;
        setIcons(readPackIcons(payload.icons).filter((icon) => icon.name && /^https?:\/\//i.test(icon.url)));
      } catch (cause) {
        if (!active) return;
        setIcons([]);
        setLoadError(cause instanceof Error ? cause.message : 'Failed to load icon pack');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, packUrl]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return icons;
    return icons.filter((icon) => icon.name.toLowerCase().includes(q));
  }, [icons, query]);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      data-testid="icon-picker-disclosure"
      className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <CategoryIcon icon={value} name={name || 'PR'} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text">{t('ruleDialog.iconTitle')}</div>
          <div className="truncate text-xs text-text-muted">
            {value ? t('ruleDialog.iconSelectedHint') : t('ruleDialog.iconCollapsedHint')}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
          {open && icons.length > 0 ? (
            <span>
              {visible.length} {t('ruleDialog.iconCountUnit')}
            </span>
          ) : null}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </summary>

      <div className="flex flex-col gap-2.5 border-t border-border p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={packUrl}
            onChange={(event) => setPackUrl(event.target.value)}
            aria-label={t('ruleDialog.iconTitle')}
            className="flex h-9 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 text-xs text-text focus-visible:outline-2 focus-visible:outline-primary sm:w-44"
          >
            {packs.map((pack) => (
              <option key={pack.url} value={pack.url}>
                {pack.label}
              </option>
            ))}
          </select>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('ruleDialog.iconSearchPlaceholder')}
            className="h-9 flex-1 text-xs"
          />
          {value ? (
            <button
              type="button"
              onClick={() => onChange('')}
              className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 text-xs text-text-muted hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
              <span>{t('ruleDialog.iconClear')}</span>
            </button>
          ) : null}
        </div>

        {loading ? (
          <p className="py-4 text-center text-xs text-text-muted">{t('ruleDialog.iconLoading')}</p>
        ) : loadError ? (
          <p className="py-3 text-center text-xs text-danger">{loadError}</p>
        ) : visible.length === 0 ? (
          <p className="py-4 text-center text-xs text-text-muted">{t('ruleDialog.iconEmpty')}</p>
        ) : (
          <div className="grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-6">
            {visible.slice(0, 120).map((icon) => {
              const selected = value === icon.url;
              return (
                <button
                  key={`${icon.name}-${icon.url}`}
                  type="button"
                  title={icon.name}
                  onClick={() => onChange(icon.url)}
                  className={`flex cursor-pointer flex-col items-center gap-1 rounded-[var(--radius-sm)] border p-1.5 text-center transition-colors ${
                    selected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-transparent bg-surface hover:border-border hover:bg-surface-muted'
                  }`}
                >
                  <img
                    src={icon.url}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-7 w-7 rounded object-contain"
                  />
                  <span className="w-full truncate text-[10px] leading-tight text-text-muted">
                    {icon.name.replace(/\.png$/i, '')}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}
