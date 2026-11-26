import { Bell, ChevronDown, Globe, Info, Layers, Moon, SlidersHorizontal, Sparkles, Sun } from 'lucide-react';
import { useState } from 'react';
import aboutEmblemUrl from './assets/miku-about-emblem.webp';
import emptyStateUrl from './assets/miku-empty-state.webp';
import loginBgUrl from './assets/miku-login-bg.webp';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/ui';
import { I18nProvider, SUPPORTED_LOCALES, useI18n, type Locale } from './i18n';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';

function DesignSystemPreview() {
  const { theme, toggleTheme } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const [toastOpen, setToastOpen] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [selectedClient, setSelectedClient] = useState('mihomo');
  const [ruleInput, setRuleInput] = useState('');

  return (
    <TooltipProvider delayDuration={180}>
      <ToastProvider swipeDirection="right">
        <div className="min-h-screen bg-bg text-text">
          <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <img
                  src={aboutEmblemUrl}
                  alt={t('app.name')}
                  className="h-9 w-9 rounded-[var(--radius-sm)] border border-border object-cover"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tracking-tight">{t('app.name')}</span>
                    <Badge variant="primary">{t('app.previewBadge')}</Badge>
                  </div>
                  <p className="text-xs text-text-muted">{t('app.tagline')}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Globe className="h-4 w-4" />
                      <span>{t(`lang.${locale}`)}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{t('lang.label')}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {SUPPORTED_LOCALES.map((item: Locale) => (
                      <DropdownMenuItem key={item} onSelect={() => setLocale(item)}>
                        {t(`lang.${item}`)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button variant="outline" size="sm" onClick={toggleTheme} aria-label={t('theme.toggle')}>
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  <span>{theme === 'dark' ? t('theme.light') : t('theme.dark')}</span>
                </Button>

                <Button variant="ghost" size="sm" asChild>
                  <a href="/admin">{t('app.backToLegacy')}</a>
                </Button>
              </div>
            </div>
          </header>

          <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
            <Card className="overflow-hidden">
              <div className="relative h-44 w-full overflow-hidden border-b border-border bg-surface-muted sm:h-52">
                <img
                  src={loginBgUrl}
                  alt={t('preview.title')}
                  className="h-full w-full object-cover object-center opacity-85"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-bg/95 via-bg/45 to-transparent" />
                <div className="absolute bottom-4 left-5 right-5 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="text-xs font-medium text-primary">Miku Design System · WCAG AA</span>
                  </div>
                  <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">{t('preview.title')}</h1>
                  <p className="text-sm text-text-muted">{t('preview.subtitle')}</p>
                </div>
              </div>
              <CardContent className="flex flex-wrap items-center gap-2 pt-4">
                <Badge variant="primary">--primary</Badge>
                <Badge variant="accent">--accent</Badge>
                <Badge variant="success">--success</Badge>
                <Badge variant="warning">--warning</Badge>
                <Badge variant="danger">--danger</Badge>
                <Badge variant="outline">--border</Badge>
              </CardContent>
            </Card>

            <Tabs defaultValue="components">
              <TabsList>
                <TabsTrigger value="components">{t('preview.componentsTitle')}</TabsTrigger>
                <TabsTrigger value="tokens">{t('preview.tokensTitle')}</TabsTrigger>
                <TabsTrigger value="empty">{t('preview.tabPreview')}</TabsTrigger>
              </TabsList>

              <TabsContent value="components">
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('preview.componentsTitle')}</CardTitle>
                      <CardDescription>{t('preview.subtitle')}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <div className="flex flex-wrap gap-2">
                        <Button variant="primary">{t('common.save')}</Button>
                        <Button variant="secondary">{t('common.refresh')}</Button>
                        <Button variant="outline">{t('common.edit')}</Button>
                        <Button variant="accent">{t('common.create')}</Button>
                        <Button variant="danger">{t('common.delete')}</Button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          value={ruleInput}
                          onChange={(event) => setRuleInput(event.target.value)}
                          placeholder="DOMAIN-SUFFIX,example.com"
                          aria-label={t('common.search')}
                        />
                        <Select value={selectedClient} onValueChange={setSelectedClient}>
                          <SelectTrigger aria-label={t('preview.selectPlaceholder')}>
                            <SelectValue placeholder={t('preview.selectPlaceholder')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mihomo">Mihomo</SelectItem>
                            <SelectItem value="stash">Stash</SelectItem>
                            <SelectItem value="surge">Surge</SelectItem>
                            <SelectItem value="sing-box">sing-box</SelectItem>
                            <SelectItem value="loon">Loon</SelectItem>
                            <SelectItem value="quantumult-x">Quantumult X</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-surface-muted px-3.5 py-2.5">
                        <span className="text-sm font-medium">{t('preview.switchLabel')}</span>
                        <Switch
                          checked={autoSync}
                          onCheckedChange={setAutoSync}
                          aria-label={t('preview.switchLabel')}
                        />
                      </div>
                    </CardContent>
                    <CardFooter className="flex-wrap">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Layers className="h-4 w-4" />
                            {t('preview.dialogTrigger')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t('preview.dialogTitle')}</DialogTitle>
                            <DialogDescription>{t('preview.dialogDescription')}</DialogDescription>
                          </DialogHeader>
                          <Input placeholder="AI Services" />
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline">{t('common.cancel')}</Button>
                            </DialogClose>
                            <DialogClose asChild>
                              <Button variant="primary">{t('common.confirm')}</Button>
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      <Sheet>
                        <SheetTrigger asChild>
                          <Button variant="outline" size="sm">
                            <SlidersHorizontal className="h-4 w-4" />
                            {t('preview.sheetTrigger')}
                          </Button>
                        </SheetTrigger>
                        <SheetContent side="right">
                          <SheetHeader>
                            <SheetTitle>{t('preview.sheetTitle')}</SheetTitle>
                            <SheetDescription>{t('preview.sheetDescription')}</SheetDescription>
                          </SheetHeader>
                          <div className="flex flex-col gap-2 py-2">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-4/5" />
                            <Skeleton className="h-24 w-full" />
                          </div>
                          <SheetFooter>
                            <Button variant="primary" onClick={() => setToastOpen(true)}>
                              {t('common.copy')}
                            </Button>
                          </SheetFooter>
                        </SheetContent>
                      </Sheet>

                      <Button variant="secondary" size="sm" onClick={() => setToastOpen(true)}>
                        <Bell className="h-4 w-4" />
                        {t('preview.toastTrigger')}
                      </Button>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Info className="h-4 w-4" />
                            {t('preview.tooltipTrigger')}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('preview.tooltipContent')}</TooltipContent>
                      </Tooltip>
                    </CardFooter>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>{t('preview.emptyStateTitle')}</CardTitle>
                      <CardDescription>{t('preview.emptyStateBody')}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center gap-4">
                      <img
                        src={emptyStateUrl}
                        alt={t('preview.emptyStateTitle')}
                        className="h-44 w-full rounded-[var(--radius-md)] border border-border object-cover"
                      />
                      <div className="flex w-full flex-col gap-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="tokens">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('preview.tokensTitle')}</CardTitle>
                    <CardDescription>{t('preview.tooltipContent')}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[var(--radius-md)] border border-border bg-bg p-4">
                      <p className="text-sm font-medium text-text">--bg</p>
                      <p className="text-xs text-text-muted">--text-muted</p>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
                      <p className="text-sm font-medium text-primary">--primary</p>
                      <p className="text-xs text-accent">--accent</p>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-border bg-surface-muted p-4">
                      <p className="text-sm font-medium text-success">--success</p>
                      <p className="text-xs text-warning">
                        --warning · <span className="text-danger">--danger</span>
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="empty">
                <Card>
                  <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                    <img
                      src={emptyStateUrl}
                      alt={t('preview.emptyStateTitle')}
                      className="h-40 w-64 rounded-[var(--radius-md)] border border-border object-cover"
                    />
                    <h2 className="text-base font-semibold">{t('preview.emptyStateTitle')}</h2>
                    <p className="max-w-md text-sm text-text-muted">{t('preview.emptyStateBody')}</p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </main>

          <Toast open={toastOpen} onOpenChange={setToastOpen} variant="success">
            <div className="flex flex-col gap-1">
              <ToastTitle>{t('preview.toastTitle')}</ToastTitle>
              <ToastDescription>{t('preview.toastDescription')}</ToastDescription>
            </div>
            <ToastClose />
          </Toast>
          <ToastViewport />
        </div>
      </ToastProvider>
    </TooltipProvider>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <DesignSystemPreview />
      </I18nProvider>
    </ThemeProvider>
  );
}
