import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderSVG } from 'uqr';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

/** Generates a local, offline SVG QR code for the given text without any external requests. */
export function generateQrCodeSvg(value: string): string {
  if (!value.trim()) return '';
  return renderSVG(value, {
    ecc: 'M',
    border: 2,
    whiteColor: '#ffffff',
    blackColor: '#000000',
  });
}

export type QrCodeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  title?: string;
};

export function QrCodeDialog({ open, onOpenChange, url, title }: QrCodeDialogProps) {
  const { t } = useI18n();
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const svg = useMemo(() => (open ? generateQrCodeSvg(url) : ''), [open, url]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
    }
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open]);

  const handleCopy = async () => {
    if (!url) return;
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      notify({ title: t('qr.copiedToast'), variant: 'success' });
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 2000);
    } catch {
      if (urlRef.current && typeof window !== 'undefined' && typeof document !== 'undefined') {
        const range = document.createRange();
        range.selectNodeContents(urlRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      notify({ title: t('subscriptions.copyFailed'), variant: 'danger' });
    }
  };

  const heading = title ? t('qr.dialogTitleWithTarget').replace('{target}', title) : t('qr.dialogTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="qr-code-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle data-testid="qr-code-dialog-title">{heading}</DialogTitle>
          <DialogDescription data-testid="qr-code-scan-hint">{t('qr.scanHint')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          <div
            data-testid="qr-code-svg"
            role="img"
            aria-label={t('qr.svgAriaLabel')}
            className="flex items-center justify-center rounded-[var(--radius-md)] border border-border bg-white p-3 shadow-sm [&_svg]:block [&_svg]:h-52 [&_svg]:w-52"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <code
            ref={urlRef}
            data-testid="qr-code-url"
            className="block max-h-20 w-full overflow-y-auto break-all select-all rounded-[var(--radius-sm)] border border-border bg-surface-muted/70 px-2.5 py-1.5 font-mono text-[11px] text-text-muted"
          >
            {url}
          </code>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" size="sm" variant="outline" data-testid="qr-code-close-btn">
              {t('common.close')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            size="sm"
            variant={copied ? 'secondary' : 'primary'}
            data-testid="qr-code-copy-btn"
            onClick={() => void handleCopy()}
          >
            {copied ? <Check className="motion-success-icon h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? t('common.copied') : t('qr.copyButton')}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
