import { AlertTriangle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { StarterTemplateTier } from '../../../builtin';
import type { OutputProfile } from '../../../shared/clients';
import type { TemplateGroupMode } from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';

export type CreateTemplateSubmitPayload = {
  name?: string;
  slug?: string;
  description?: string;
  starterTier?: StarterTemplateTier;
  groupMode: TemplateGroupMode;
  output: OutputProfile;
};

type CreateTemplateDialogProps = {
  open: boolean;
  initialTier?: StarterTemplateTier | null;
  readOnly?: boolean;
  submitting?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateTemplateSubmitPayload) => Promise<void>;
};

const TIERS: ReadonlyArray<StarterTemplateTier | 'blank'> = ['blank', 'minimal', 'light', 'standard', 'heavy'];

export function CreateTemplateDialog({
  open,
  initialTier,
  readOnly = false,
  submitting = false,
  onOpenChange,
  onSubmit,
}: CreateTemplateDialogProps) {
  const { t } = useI18n();
  const [selectedTier, setSelectedTier] = useState<StarterTemplateTier | 'blank'>(initialTier ?? 'blank');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [groupMode, setGroupMode] = useState<TemplateGroupMode>('select');
  const [output, setOutput] = useState<OutputProfile>('full');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedTier(initialTier ?? 'blank');
    setName('');
    setSlug('');
    setDescription('');
    setGroupMode('select');
    setOutput('full');
    setError('');
  }, [open, initialTier]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || submitting) return;
    const trimmedSlug = slug.trim();
    if (trimmedSlug && !/^[a-z0-9][a-z0-9_-]*$/i.test(trimmedSlug)) {
      setError(t('templates.validationSlug'));
      return;
    }
    if (selectedTier === 'blank' && !name.trim()) {
      setError(t('templates.validationName'));
      return;
    }
    setError('');
    await onSubmit({
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(trimmedSlug ? { slug: trimmedSlug } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(selectedTier !== 'blank' ? { starterTier: selectedTier } : {}),
      groupMode,
      output,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="create-template-dialog" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {selectedTier === 'blank' ? t('templates.createBlankTitle') : t('templates.createStarterTitle')}
          </DialogTitle>
          <DialogDescription>{t('templates.createDialogDesc')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-muted">{t('templates.fieldSourceKind')}</span>
            <div className="flex flex-wrap gap-1.5">
              {TIERS.map((tier) => (
                <Button
                  key={tier}
                  type="button"
                  size="sm"
                  data-testid={`create-template-tier-${tier}`}
                  variant={selectedTier === tier ? 'primary' : 'outline'}
                  disabled={readOnly}
                  onClick={() => setSelectedTier(tier)}
                >
                  {tier === 'blank'
                    ? t('templates.tierBlank')
                    : tier === 'minimal'
                      ? t('templates.tierMinimal')
                      : tier === 'light'
                        ? t('templates.tierLight')
                        : tier === 'standard'
                          ? t('templates.tierStandard')
                          : t('templates.tierHeavy')}
                </Button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-text">
            <span>{t('templates.fieldName')}</span>
            <Input
              data-testid="create-template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                selectedTier === 'blank' ? t('templates.fieldNamePlaceholder') : t('templates.fieldNameOptional')
              }
              disabled={readOnly}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-text">
            <span>{t('templates.fieldSlug')}</span>
            <Input
              data-testid="create-template-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={t('templates.fieldSlugPlaceholder')}
              disabled={readOnly}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-text">
            <span>{t('templates.fieldDescription')}</span>
            <Input
              data-testid="create-template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('templates.fieldDescriptionPlaceholder')}
              disabled={readOnly}
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text">{t('templates.fieldGroupMode')}</span>
              <div className="flex gap-1.5">
                {(['select', 'fallback'] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    data-testid={`create-template-mode-${mode}`}
                    variant={groupMode === mode ? 'primary' : 'outline'}
                    disabled={readOnly}
                    onClick={() => setGroupMode(mode)}
                  >
                    {mode === 'select' ? t('templates.groupModeSelect') : t('templates.groupModeFallback')}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text">{t('templates.fieldOutput')}</span>
              <div className="flex gap-1.5">
                {(['full', 'minimal'] as const).map((profile) => (
                  <Button
                    key={profile}
                    type="button"
                    size="sm"
                    data-testid={`create-template-output-${profile}`}
                    variant={output === profile ? 'primary' : 'outline'}
                    disabled={readOnly}
                    onClick={() => setOutput(profile)}
                  >
                    {profile === 'full' ? t('templates.outputFull') : t('templates.outputMinimal')}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {groupMode === 'fallback' ? (
            <div
              data-testid="create-template-fallback-warning"
              className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted px-3 py-2 text-xs text-text"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{t('templates.fallbackModeWarning')}</span>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" data-testid="create-template-submit" disabled={readOnly || submitting}>
              {submitting ? t('common.loading') : t('templates.createAndEdit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
