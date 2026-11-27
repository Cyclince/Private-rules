import { QrCode } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useI18n } from '../../i18n';
import { Button, type ButtonProps } from './button';

const QrCodeDialog = lazy(() => import('./QrCodeDialog').then((m) => ({ default: m.QrCodeDialog })));

export type QrCodeButtonProps = {
  url: string;
  title?: string;
  label?: string;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  className?: string;
  disabled?: boolean;
  testId?: string;
};

/** Button that lazily loads the local QR code dialog on first click without entering the first-screen bundle. */
export function QrCodeButton({
  url,
  title,
  label,
  size = 'sm',
  variant = 'outline',
  className,
  disabled = false,
  testId,
}: QrCodeButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const buttonText = label ?? t('qr.buttonLabel');

  const handleOpen = () => {
    if (disabled || !url) return;
    setLoaded(true);
    setOpen(true);
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        disabled={disabled || !url}
        data-testid={testId}
        aria-label={buttonText}
        onClick={handleOpen}
        className={className}
      >
        <QrCode className="h-3.5 w-3.5" />
        <span>{buttonText}</span>
      </Button>
      {loaded ? (
        <Suspense fallback={null}>
          <QrCodeDialog open={open} onOpenChange={setOpen} url={url} title={title} />
        </Suspense>
      ) : null}
    </>
  );
}
