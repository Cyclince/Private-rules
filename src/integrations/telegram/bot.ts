import type { TelegramClient, TelegramReplyMarkup } from '../../application/ports/telegram-client';
import { TelegramRepository, type TelegramUser } from '../../application/telegram/repository';
import { deleteSource, getSource, listSources, syncSourceById, toggleSource } from '../../application/sources/use-cases';
import { deleteRule, getRulesOverview, listRules, updateCategory, updateRule } from '../../lib/db';
import { linksForCategory } from '../../lib/links';
import { retryFailedSources, syncRuleSources, type SyncResult } from '../../lib/sync';
import type { Env } from '../../types';
import type { DomainRule, RuleCategory } from '../../types/domain-rules';
import type { TelegramCallbackPayload, TelegramMessagePayload, TelegramUpdate } from './types';
import { TELEGRAM_EPHEMERAL_TTL_SECONDS } from './services/message-cleanup';

const PAGE_SIZE = 5;
const SEARCH_LIMIT = 10;

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function displayName(from: { first_name?: string; last_name?: string }) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ').slice(0, 120);
}

function homeKeyboard(): TelegramReplyMarkup {
  return { inlineKeyboard: [
    [{ text: '📊 规则汇总', callbackData: 'cat:l:0' }],
    [{ text: '🔗 订阅信息', callbackData: 'sub:l:0' }, { text: '🧩 上游状态', callbackData: 'src:l:0' }],
    [{ text: '🔍 搜索规则', callbackData: 'rule:q' }, { text: '🔄 同步信息', callbackData: 'sync:m' }],
  ] };
}

function rulesOverviewText(data: Awaited<ReturnType<typeof getRulesOverview>>) {
  const sources = data.categories.flatMap((category) => category.sources ?? []);
  const totalRules = data.categories.reduce((sum, category) => sum + (category.ruleCount ?? 0), 0);
  const enabledRules = data.categories.reduce((sum, category) => sum + (category.enabledRuleCount ?? 0), 0);
  const upstreamSubscriptions = sources.filter((source) => (source.sourceType ?? 'url') === 'url').length;
  const geositeSources = sources.filter((source) => source.sourceType === 'geosite').length;
  const geoipSources = sources.filter((source) => source.sourceType === 'geoip').length;
  const failedSources = sources.filter((source) => source.lastStatus === 'error').length;
  const lastSync = data.lastSyncedAt
    ? escapeHtml(new Date(data.lastSyncedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }))
    : '暂无同步记录';
  const number = (value: number) => value.toLocaleString('zh-CN');
  return [
    '<b>📚 规则概览</b>',
    `🧾 所有规则：<b>${number(totalRules)}</b>`,
    `🗂 规则分类：<b>${number(data.categories.length)}</b>`,
    `✅ 启用规则：<b>${number(enabledRules)}</b>`,
    `⏸ 禁用规则：<b>${number(Math.max(0, totalRules - enabledRules))}</b>`,
    '',
    '<b>🌐 上游概览</b>',
    `🔗 上游来源：<b>${number(sources.length)}</b>`,
    `📡 上游订阅：<b>${number(upstreamSubscriptions)}</b>`,
    `🗺 GeoSite：<b>${number(geositeSources)}</b>`,
    `🌍 GeoIP：<b>${number(geoipSources)}</b>`,
    `⚠️ 异常来源：<b>${number(failedSources)}</b>`,
    '',
    `🕘 上次同步：${lastSync}`,
  ].join('\n');
}

function pager(prefix: string, page: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return [
    ...(page > 0 ? [{ text: '上一页', callbackData: `${prefix}:${page - 1}` } as const] : []),
    { text: `${page + 1}/${pages}`, callbackData: 'noop' } as const,
    ...(page + 1 < pages ? [{ text: '下一页', callbackData: `${prefix}:${page + 1}` } as const] : []),
  ];
}

function accessName(category: RuleCategory) {
  return category.tokenLinksEnabled !== false ? '私密' : category.publicLinksEnabled !== false ? '公开' : '禁用';
}

function syncSummary(results: SyncResult[]) {
  if (!results.length) return '没有需要同步的来源。';
  return results.map((result) => `${result.ok ? '✅' : '❌'} ${result.name}：${result.ok ? `${result.count} 条` : result.error ?? '同步失败'}`).join('\n');
}

function safeTaskError(cause: unknown) {
  return (cause instanceof Error ? cause.message : '同步失败')
    .replace(/([?&](?:token|key|auth|signature)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(authorization|cookie|secret):?\s*[^\s]+/gi, '$1: [redacted]')
    .slice(0, 240);
}

export class TelegramBotApplication {
  private readonly repository: TelegramRepository;

  constructor(private readonly env: Env, private readonly client: TelegramClient) {
    this.repository = new TelegramRepository(env.DB);
  }

  private async reply(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup) {
    return this.client.sendMessage(chatId, text, { replyMarkup, parseMode: 'HTML' });
  }

  private async replyEphemeral(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup) {
    const result = await this.reply(chatId, text, replyMarkup);
    const messageId = result && typeof result === 'object' && 'message_id' in result ? Number(result.message_id) : 0;
    if (Number.isSafeInteger(messageId) && messageId > 0) {
      await this.repository.enqueueMessageDeletion(chatId, messageId, TELEGRAM_EPHEMERAL_TTL_SECONDS);
    }
    return result;
  }

  private async replyWithHomeImage(chatId: string, caption: string, replyMarkup: TelegramReplyMarkup) {
    const baseUrl = (this.env.BASE_URL || this.env.TELEGRAM?.miniAppUrl || '').replace(/\/$/, '');
    if (!baseUrl) return this.reply(chatId, caption, replyMarkup);
    return this.client.sendPhoto(chatId, `${baseUrl}/tgbot-hero.png`, { caption, replyMarkup, parseMode: 'HTML' });
  }

  private async edit(callback: TelegramCallbackPayload, text: string, replyMarkup?: TelegramReplyMarkup) {
    const message = callback.message;
    if (!message) return this.replyEphemeral(String(callback.from.id), text, replyMarkup);
    try {
      if (message.caption !== undefined || message.photo?.length) {
        return await this.client.editMessageCaption(String(message.chat.id), message.message_id, text, { replyMarkup, parseMode: 'HTML' });
      }
      return await this.client.editMessageText(String(message.chat.id), message.message_id, text, { replyMarkup, parseMode: 'HTML' });
    } catch {
      return this.replyEphemeral(String(message.chat.id), text, replyMarkup);
    }
  }

  private async authorized(update: TelegramUpdate) {
    const from = update.message?.from ?? update.callback_query?.from;
    const chat = update.message?.chat ?? update.callback_query?.message?.chat;
    if (!from || !chat || !this.env.TELEGRAM) return null;
    return this.repository.authorizeUser(this.env.TELEGRAM, {
      telegramUserId: String(from.id),
      chatId: String(chat.id),
      username: from.username,
      displayName: displayName(from),
    });
  }

  async handleUpdate(update: TelegramUpdate, correlationId: string) {
    const from = update.message?.from ?? update.callback_query?.from;
    const chat = update.message?.chat ?? update.callback_query?.message?.chat;
    if (!from || !chat) return;
    const user = await this.authorized(update);
    if (!user) {
      if (update.callback_query) await this.client.answerCallbackQuery(update.callback_query.id, { text: '你没有使用此 Bot 的权限。', showAlert: true });
      else await this.replyEphemeral(String(chat.id), `你没有使用此 Bot 的权限。\nTelegram User ID：<code>${from.id}</code>`);
      return;
    }
    try {
      if (update.callback_query) await this.handleCallback(update.callback_query, user);
      else if (update.message) await this.handleMessage(update.message, user);
    } catch (cause) {
      const errorCode = correlationId.slice(-8);
      console.error(`[telegram:${correlationId}]`, cause instanceof Error ? cause.message : 'unknown error');
      await this.repository.audit({
        telegramUserId: user.telegramUserId,
        chatId: String(chat.id),
        action: update.callback_query ? 'callback' : 'command',
        summary: `error=${errorCode}`,
        result: 'failure',
      }).catch(() => undefined);
      if (update.callback_query) {
        await this.client.answerCallbackQuery(update.callback_query.id, { text: `操作失败（${errorCode}）`, showAlert: true }).catch(() => undefined);
      } else {
        await this.replyEphemeral(String(chat.id), `操作暂时失败，请稍后重试。\n错误编号：<code>${errorCode}</code>`).catch(() => undefined);
      }
    }
  }

  private async handleMessage(message: TelegramMessagePayload, user: TelegramUser) {
    const chatId = String(message.chat.id);
    const text = message.text?.trim() ?? '';
    const commandMatch = text.match(/^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
    if (!commandMatch) {
      const conversation = await this.repository.getConversation<{ step?: string }>(user.telegramUserId, chatId);
      if (conversation?.kind === 'rule-search') {
        await this.repository.enqueueMessageDeletion(chatId, message.message_id, TELEGRAM_EPHEMERAL_TTL_SECONDS);
        return this.showRuleSearch(chatId, user, text);
      }
      return;
    }
    await this.repository.enqueueMessageDeletion(chatId, message.message_id, TELEGRAM_EPHEMERAL_TTL_SECONDS);
    const command = commandMatch[1].toLowerCase();
    const argument = commandMatch[2]?.trim() ?? '';
    const limited = await this.repository.consumeRateLimit(`${user.telegramUserId}:${chatId}`, `command:${command}`, this.env.TELEGRAM!.rateLimitPerMinute);
    if (!limited.allowed) return this.replyEphemeral(chatId, '操作过于频繁，请稍后再试。');
    if (command === 'start') return this.showHome(chatId, user);
    if (command === 'help') return this.showHelp(chatId, user);
    if (command === 'status') return this.showStatus(chatId);
    if (command === 'categories') return this.showCategories(chatId, 0);
    if (command === 'rules') {
      if (argument) return this.showRuleSearch(chatId, user, argument);
      await this.repository.saveConversation(user.telegramUserId, chatId, 'rule-search', {}, 300);
      return this.replyEphemeral(chatId, '请输入域名、规则类型、IP、CIDR、来源或备注进行搜索。\n最多 100 个字符；发送 /cancel 取消。');
    }
    if (command === 'subscriptions') return this.showSubscriptions(chatId, 0);
    if (command === 'sources') return this.showSources(chatId, 0);
    if (command === 'sync') return this.showSyncMenu(chatId, user);
    if (command === 'panel') return this.showPanel(chatId);
    if (command === 'cancel') {
      await this.repository.clearConversation(user.telegramUserId, chatId);
      return this.replyEphemeral(chatId, '当前维护向导已取消。', homeKeyboard());
    }
    return this.replyEphemeral(chatId, '未知命令。发送 /help 查看可用命令。');
  }

  private async showHome(chatId: string, _user: TelegramUser, callback?: TelegramCallbackPayload) {
    const data = await getRulesOverview(this.env, 0);
    const text = `<b>Private Rules Bot</b>\n✅ <b>服务运行正常</b>\n\n${rulesOverviewText(data)}`;
    const keyboard = homeKeyboard();
    return callback ? this.edit(callback, text, keyboard) : this.replyWithHomeImage(chatId, text, keyboard);
  }

  private showHelp(chatId: string, _user: TelegramUser) {
    return this.replyEphemeral(chatId, '<b>Private Rules Bot 帮助</b>\n\n这是仅限配置用户使用的私有 Bot，用于快速查看规则、上游与同步信息；详细维护请通过输入框左侧的“面板”进入。\n\n/start　首页与快捷操作\n/help　帮助与安全说明\n/status　服务运行状态\n/rules　浏览或搜索规则\n/sources　查看上游来源\n/sync　查看或执行同步\n\n搜索等待中可发送 /cancel 取消。临时查询与同步消息会在 1 分钟后自动清理。\n请勿转发私密订阅链接。');
  }

  private async showStatus(chatId: string) {
    const [healthy, data] = await Promise.all([this.env.DB.ping(), getRulesOverview(this.env, 0)]);
    const sources = data.categories.flatMap((category) => category.sources ?? []);
    const failed = sources.filter((source) => source.lastStatus === 'error');
    return this.replyEphemeral(chatId, `<b>服务状态</b>\n\n服务：运行正常\n数据库：${healthy ? '正常' : '不可用'}\n运行时：${this.env.RUNTIME ?? 'cloudflare'}\n分类：${data.categories.length}\n来源：${sources.length}\n失败来源：${failed.length}\n上次同步：${data.lastSyncedAt ? escapeHtml(new Date(data.lastSyncedAt).toLocaleString('zh-CN')) : '暂无'}`);
  }

  private async showCategories(chatId: string, page: number, callback?: TelegramCallbackPayload) {
    const data = await getRulesOverview(this.env, 0);
    const safePage = Math.max(0, Math.min(page, Math.max(0, Math.ceil(data.categories.length / PAGE_SIZE) - 1)));
    const categories = data.categories.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
    const text = `<b>规则分类</b>\n\n${categories.length ? categories.map((category, index) =>
      `${safePage * PAGE_SIZE + index + 1}. <b>${escapeHtml(category.name)}</b>\n${category.ruleCount ?? 0} 条规则 · ${category.enabledRuleCount ?? 0} 已启用 · ${category.sources?.length ?? 0} 个上游`).join('\n\n') : '暂无分类'}`;
    const keyboard: TelegramReplyMarkup = { inlineKeyboard: [
      ...categories.map((category) => [{ text: `查看 ${category.name}`.slice(0, 40), callbackData: `cat:v:${category.id}` }]),
      pager('cat:l', safePage, data.categories.length),
      [{ text: '返回首页', callbackData: 'home' }],
    ] };
    return callback ? this.edit(callback, text, keyboard) : this.replyEphemeral(chatId, text, keyboard);
  }

  private async showCategory(callback: TelegramCallbackPayload, categoryId: string, user: TelegramUser) {
    const data = await getRulesOverview(this.env, 0);
    const category = data.categories.find((item) => item.id === categoryId);
    if (!category) throw new Error('目标不存在');
    const keyboard: TelegramReplyMarkup = { inlineKeyboard: [
      [{ text: '查看自定义规则', callbackData: `rule:c:${category.id}:0` }],
      [{ text: '订阅信息', callbackData: `sub:v:${category.id}` }, { text: '上游状态', callbackData: `src:c:${category.id}:0` }],
      ...(this.env.TELEGRAM!.miniAppUrl ? [[{ text: '打开完整面板', webAppUrl: `${this.env.TELEGRAM!.miniAppUrl}/admin?view=rules&category=${encodeURIComponent(category.id)}` }]] : []),
      [{ text: '返回分类列表', callbackData: 'cat:l:0' }],
    ] as TelegramReplyMarkup['inlineKeyboard'] };
    return this.edit(callback, `<b>${escapeHtml(category.name)}</b>\n\n规则：${category.ruleCount ?? 0}\n已启用：${category.enabledRuleCount ?? 0}\n自定义规则：${category.manualRuleCount ?? 0}\n上游规则：${(category.urlRuleCount ?? 0) + (category.geoRuleCount ?? 0)}\n上游来源：${category.sources?.length ?? 0}\n订阅策略：${accessName(category)}\n上次同步：${category.lastSyncedAt ? escapeHtml(new Date(category.lastSyncedAt).toLocaleString('zh-CN')) : '暂无'}`, keyboard);
  }

  private async showRuleSearch(chatId: string, user: TelegramUser, rawQuery: string) {
    await this.repository.clearConversation(user.telegramUserId, chatId);
    const query = rawQuery.trim();
    if (!query || query.length > 100) return this.replyEphemeral(chatId, '输入格式错误：搜索内容必须为 1–100 个字符。');
    const limited = await this.repository.consumeRateLimit(`${user.telegramUserId}:${chatId}`, 'search', 10);
    if (!limited.allowed) return this.replyEphemeral(chatId, '搜索过于频繁，请稍后再试。');
    const rules = await listRules(this.env, { query, limit: SEARCH_LIMIT });
    const data = await getRulesOverview(this.env, 0);
    const categories = new Map(data.categories.map((category) => [category.id, category.name]));
    const text = `<b>搜索结果</b>\n\n找到 ${rules.length}${rules.length === SEARCH_LIMIT ? '+' : ''} 条结果\n\n${rules.map((rule, index) =>
      `${index + 1}. <code>${escapeHtml(rule.type)}</code> · ${escapeHtml(rule.value)}\n分类：${escapeHtml(categories.get(rule.categoryId ?? '') ?? '未知')}\n来源：${rule.sourceId ? escapeHtml(rule.sourceName ?? '上游') : '自定义'}\n状态：${rule.enabled ? '已启用' : '已停用'}`).join('\n\n') || '没有匹配规则'}`;
    const keyboard: TelegramReplyMarkup = { inlineKeyboard: [
      ...rules.slice(0, 5).map((rule) => [{ text: `查看 ${rule.value}`.slice(0, 44), callbackData: `rule:v:${rule.id}` }]),
      ...(this.env.TELEGRAM!.miniAppUrl ? [[{ text: '在面板中管理规则', webAppUrl: `${this.env.TELEGRAM!.miniAppUrl}/admin?view=rules` }]] : []),
    ] };
    return this.replyEphemeral(chatId, text, keyboard);
  }

  private async showCategoryRules(callback: TelegramCallbackPayload, categoryId: string, page: number, user: TelegramUser) {
    const rules = await listRules(this.env, { categoryId, source: 'manual', limit: 0 });
    const slice = rules.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const keyboard: TelegramReplyMarkup = { inlineKeyboard: [
      ...slice.map((rule) => [{ text: `${rule.enabled ? '✅' : '⛔'} ${rule.value}`.slice(0, 44), callbackData: `rule:v:${rule.id}` }]),
      pager(`rule:c:${categoryId}`, page, rules.length),
      [{ text: '返回分类', callbackData: `cat:v:${categoryId}` }],
    ] };
    if (this.env.TELEGRAM!.miniAppUrl) keyboard.inlineKeyboard.unshift([{ text: '添加自定义规则', webAppUrl: `${this.env.TELEGRAM!.miniAppUrl}/admin?view=rules&category=${encodeURIComponent(categoryId)}` }]);
    return this.edit(callback, `<b>自定义规则</b>\n\n${slice.map((rule) => `<code>${escapeHtml(rule.type)}</code> · ${escapeHtml(rule.value)}\n状态：${rule.enabled ? '已启用' : '已停用'}${rule.note ? ` · ${escapeHtml(rule.note)}` : ''}`).join('\n\n') || '暂无自定义规则'}`, keyboard);
  }

  private async showRule(callback: TelegramCallbackPayload, ruleId: string, user: TelegramUser) {
    const rule = (await listRules(this.env, { limit: 0 })).find((item) => item.id === ruleId);
    if (!rule) throw new Error('目标不存在');
    const readonly = Boolean(rule.sourceId);
    const keyboard: TelegramReplyMarkup = { inlineKeyboard: [
      ...(this.env.TELEGRAM!.miniAppUrl ? [[{ text: '在面板中管理', webAppUrl: `${this.env.TELEGRAM!.miniAppUrl}/admin?view=rules&category=${encodeURIComponent(rule.categoryId ?? '')}` }]] : []),
      [{ text: '返回分类', callbackData: `cat:v:${rule.categoryId}` }],
    ] as TelegramReplyMarkup['inlineKeyboard'] };
    const note = readonly ? '\n\n该规则来自上游来源，不能单独修改。\n请修改、停用或删除对应的上游来源。' : '';
    return this.edit(callback, `<b>规则详情</b>\n\n类型：<code>${escapeHtml(rule.type)}</code>\n值：<code>${escapeHtml(rule.value)}</code>\n状态：${rule.enabled ? '已启用' : '已停用'}\n来源：${readonly ? escapeHtml(rule.sourceName ?? '上游') : '自定义'}\n备注：${escapeHtml(rule.note ?? '无')}${note}`, keyboard);
  }

  private async showSubscriptions(chatId: string, page: number, callback?: TelegramCallbackPayload) {
    const data = await getRulesOverview(this.env, 0);
    const categories = data.categories.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const keyboard: TelegramReplyMarkup = { inlineKeyboard: [
      ...categories.map((category) => [{ text: `${category.name} · ${accessName(category)}`.slice(0, 44), callbackData: `sub:v:${category.id}` }]),
      pager('sub:l', page, data.categories.length),
      [{ text: '返回首页', callbackData: 'home' }],
    ] };
    const text = `<b>订阅管理</b>\n\n${categories.map((category) => `${escapeHtml(category.name)}：${accessName(category)}`).join('\n') || '暂无分类'}`;
    return callback ? this.edit(callback, text, keyboard) : this.replyEphemeral(chatId, text, keyboard);
  }

  private async showSubscription(callback: TelegramCallbackPayload, categoryId: string, user: TelegramUser) {
    const data = await getRulesOverview(this.env, 0);
    const category = data.categories.find((item) => item.id === categoryId);
    if (!category) throw new Error('目标不存在');
    const requestUrl = this.env.BASE_URL || this.env.TELEGRAM!.webhookUrl || this.env.TELEGRAM!.miniAppUrl || 'https://invalid.local';
    const links = linksForCategory(category, data, requestUrl, this.env.RULE_TOKEN);
    const formats = [
      ['YAML', links.find((link) => link.id === 'mihomo')],
      ['LIST', links.find((link) => link.id === 'general')],
      ['TXT', links.find((link) => link.id === 'url')],
      ['JSON', links.find((link) => link.id === 'json')],
    ] as const;
    const keyboard: TelegramReplyMarkup = { inlineKeyboard: [
      ...formats.filter(([, link]) => link?.recommendedUrl).map(([name, link]) => [{ text: `复制 ${name}`, copyText: link!.recommendedUrl }]),
      [{ text: '返回订阅列表', callbackData: 'sub:l:0' }],
    ] as TelegramReplyMarkup['inlineKeyboard'] };
    return this.edit(callback, `<b>${escapeHtml(category.name)} 订阅</b>\n\n当前策略：${accessName(category)}\n点击下方格式即可复制订阅地址。${category.tokenLinksEnabled !== false ? '\n\n⚠️ 私密链接包含访问凭据，请勿转发。' : ''}`, keyboard);
  }

  private async showSources(chatId: string, page: number, callback?: TelegramCallbackPayload, categoryId?: string) {
    const data = await getRulesOverview(this.env, 0);
    const all = data.categories.flatMap((category) => (category.sources ?? []).map((source) => ({ source, category })))
      .filter((entry) => !categoryId || entry.category.id === categoryId);
    const slice = all.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    const prefix = categoryId ? `src:c:${categoryId}` : 'src:l';
    const keyboard: TelegramReplyMarkup = { inlineKeyboard: [
      ...slice.map(({ source }) => [{ text: `${source.enabled ? '✅' : '⛔'} ${source.name}`.slice(0, 44), callbackData: `src:v:${source.id}` }]),
      pager(prefix, page, all.length),
      [{ text: categoryId ? '返回分类' : '返回首页', callbackData: categoryId ? `cat:v:${categoryId}` : 'home' }],
    ] };
    const text = `<b>上游来源</b>\n\n${slice.map(({ source, category }) => `${escapeHtml(source.name)}\n分类：${escapeHtml(category.name)} · ${source.lastCount ?? 0} 条 · ${source.lastStatus === 'error' ? '失败' : source.enabled ? '已启用' : '已停用'}`).join('\n\n') || '暂无来源'}`;
    return callback ? this.edit(callback, text, keyboard) : this.replyEphemeral(chatId, text, keyboard);
  }

  private async showSource(callback: TelegramCallbackPayload, sourceId: string, user: TelegramUser) {
    const source = await getSource(this.env, sourceId);
    if (!source) throw new Error('目标不存在');
    const data = await getRulesOverview(this.env, 0);
    const category = data.categories.find((item) => item.id === source.categoryId);
    const keyboard: TelegramReplyMarkup = { inlineKeyboard: [
      ...(this.env.TELEGRAM!.miniAppUrl ? [[{ text: '在面板中管理', webAppUrl: `${this.env.TELEGRAM!.miniAppUrl}/admin?view=rules&category=${encodeURIComponent(source.categoryId)}` }]] : []),
      [{ text: '返回来源列表', callbackData: `src:c:${source.categoryId}:0` }],
    ] as TelegramReplyMarkup['inlineKeyboard'] };
    return this.edit(callback, `<b>${escapeHtml(source.name)}</b>\n\n类型：${source.sourceType === 'url' ? 'Remote' : source.sourceType}\n分类：${escapeHtml(category?.name ?? '未知')}\n状态：${source.enabled ? '已启用' : '已停用'}\n同步周期：${source.syncIntervalMinutes} 分钟\n上次同步：${source.lastSyncedAt ? escapeHtml(new Date(source.lastSyncedAt).toLocaleString('zh-CN')) : '暂无'}\n规则数：${source.lastCount ?? 0}\n最近状态：${source.lastStatus === 'error' ? `失败 · ${escapeHtml(source.lastError ?? '')}` : '正常'}`, keyboard);
  }

  private async showSyncMenu(chatId: string, user: TelegramUser, callback?: TelegramCallbackPayload) {
    const overview = await getRulesOverview(this.env, 0);
    const sources = overview.categories.flatMap((category) => category.sources ?? []);
    const failed = sources.filter((source) => source.lastStatus === 'error');
    const keyboard: TelegramReplyMarkup = { inlineKeyboard: [
      [{ text: '立即同步全部', callbackData: 'sync:a' }],
      ...(failed.length ? [[{ text: `重试失败来源（${failed.length}）`, callbackData: 'sync:f' }]] : []),
      [{ text: '查看上游状态', callbackData: 'src:l:0' }],
      [{ text: '返回首页', callbackData: 'home' }],
    ] };
    const text = `<b>同步信息</b>\n\n上游来源：${sources.length}\n失败来源：${failed.length}\n上次同步：${overview.lastSyncedAt ? escapeHtml(new Date(overview.lastSyncedAt).toLocaleString('zh-CN')) : '暂无'}\n\n可直接在 Bot 中执行手动同步，完成后会发送每个来源的最终结果。`;
    return callback ? this.edit(callback, text, keyboard) : this.replyEphemeral(chatId, text, keyboard);
  }

  private showPanel(chatId: string) {
    if (!this.env.TELEGRAM!.miniAppUrl) return this.replyEphemeral(chatId, '当前未配置 BASE_URL。');
    return this.replyEphemeral(chatId, '打开私有规则面板：', { inlineKeyboard: [[{ text: '规则面板', webAppUrl: `${this.env.TELEGRAM!.miniAppUrl}/admin?view=dashboard` }]] });
  }

  private async scheduleSync(user: TelegramUser, chatId: string, action: string, targetId?: string) {
    const limited = await this.repository.consumeRateLimit(`${user.telegramUserId}:${chatId}`, 'sync', 5);
    if (!limited.allowed) return this.replyEphemeral(chatId, '同步操作过于频繁，请稍后再试。');
    await this.repository.audit({ telegramUserId: user.telegramUserId, chatId, action, targetType: targetId ? 'category' : 'all', targetId, result: 'started', summary: '同步任务已启动' });
    await this.replyEphemeral(chatId, '同步任务已启动。完成后会发送结果。');
    const task = (async () => {
      const started = Date.now();
      try {
        const results = action === 'sync-failed' ? await retryFailedSources(this.env)
          : action === 'sync-source' && targetId ? [await syncSourceById(this.env, targetId)]
            : await syncRuleSources(this.env, targetId);
        await this.replyEphemeral(chatId, `<b>同步${results.some((result) => !result.ok) ? '完成（部分失败）' : '完成'}</b>\n\n${escapeHtml(syncSummary(results))}\n\n耗时：${((Date.now() - started) / 1000).toFixed(1)} 秒`);
        await this.repository.audit({ telegramUserId: user.telegramUserId, chatId, action, targetId, result: results.every((result) => result.ok) ? 'success' : 'failure', summary: `${results.length} 个来源` });
      } catch (cause) {
        const message = safeTaskError(cause);
        await this.replyEphemeral(chatId, `<b>同步失败</b>\n\n${escapeHtml(message)}`);
        await this.repository.audit({ telegramUserId: user.telegramUserId, chatId, action, targetId, result: 'failure', summary: message });
      }
    })();
    this.env.BACKGROUND_TASKS?.schedule(task);
    if (!this.env.BACKGROUND_TASKS) await task;
  }

  private async handleCallback(callback: TelegramCallbackPayload, user: TelegramUser) {
    const chatId = String(callback.message?.chat.id ?? callback.from.id);
    await this.client.answerCallbackQuery(callback.id).catch(() => undefined);
    const limited = await this.repository.consumeRateLimit(`${user.telegramUserId}:${chatId}`, 'callback', this.env.TELEGRAM!.rateLimitPerMinute);
    if (!limited.allowed) return this.client.answerCallbackQuery(callback.id, { text: '操作过于频繁', showAlert: true });
    const data = callback.data ?? '';
    if (!data || data.length > 64 || !/^[A-Za-z0-9:_-]+$/.test(data)) return this.client.answerCallbackQuery(callback.id, { text: '无效操作', showAlert: true });
    if (data === 'noop') return;
    if (data === 'home') return this.showHome(chatId, user, callback);
    if (data === 'panel') return this.showPanel(chatId);
    if (data === 'sync:m') return this.showSyncMenu(chatId, user, callback);
    if (/^(?:cat:[ts]:|rule:[td]:|sub:m:|src:[tsd]:|cf:)/.test(data)) {
      const keyboard = this.env.TELEGRAM!.miniAppUrl ? { inlineKeyboard: [[{ text: '打开规则面板', webAppUrl: `${this.env.TELEGRAM!.miniAppUrl}/admin?view=dashboard` }]] } : undefined;
      return this.edit(callback, '这项维护操作已移至规则面板，请在面板中完成。', keyboard);
    }
    if (data === 'sync:a') return this.scheduleSync(user, chatId, 'sync-all');
    if (data === 'sync:f') return this.scheduleSync(user, chatId, 'sync-failed');
    if (data === 'rule:q') {
      await this.repository.saveConversation(user.telegramUserId, chatId, 'rule-search', {}, 300);
      return this.replyEphemeral(chatId, '请输入搜索内容；发送 /cancel 取消。');
    }
    let match = data.match(/^cat:l:(\d+)$/);
    if (match) return this.showCategories(chatId, Number(match[1]), callback);
    match = data.match(/^cat:v:([A-Za-z0-9_-]+)$/);
    if (match) return this.showCategory(callback, match[1], user);
    match = data.match(/^cat:t:([A-Za-z0-9_-]+)$/);
    if (match) {
      const overview = await getRulesOverview(this.env, 0);
      const category = overview.categories.find((item) => item.id === match![1]);
      if (!category) throw new Error('目标不存在');
      await updateCategory(this.env, category.id, { enabled: category.enabled === false });
      await this.repository.audit({ telegramUserId: user.telegramUserId, chatId, action: 'toggle-category', targetType: 'category', targetId: category.id, result: 'success', summary: category.enabled === false ? 'enabled' : 'disabled' });
      return this.showCategory(callback, category.id, user);
    }
    match = data.match(/^cat:s:([A-Za-z0-9_-]+)$/);
    if (match) return this.scheduleSync(user, chatId, 'sync-category', match[1]);
    match = data.match(/^rule:c:([A-Za-z0-9_-]+):(\d+)$/);
    if (match) return this.showCategoryRules(callback, match[1], Number(match[2]), user);
    match = data.match(/^rule:v:([A-Za-z0-9_-]+)$/);
    if (match) return this.showRule(callback, match[1], user);
    match = data.match(/^rule:t:([A-Za-z0-9_-]+)$/);
    if (match) {
      const rule = (await listRules(this.env, { limit: 0 })).find((item) => item.id === match![1]);
      if (!rule || rule.sourceId) throw new Error('目标不存在');
      await updateRule(this.env, rule.categoryId!, rule.id, { enabled: !rule.enabled });
      await this.repository.audit({ telegramUserId: user.telegramUserId, chatId, action: 'toggle-rule', targetType: 'rule', targetId: rule.id, result: 'success', summary: rule.enabled ? 'disabled' : 'enabled' });
      return this.showRule(callback, rule.id, user);
    }
    match = data.match(/^rule:d:([A-Za-z0-9_-]+)$/);
    if (match) {
      const rule = (await listRules(this.env, { limit: 0 })).find((item) => item.id === match![1]);
      if (!rule || rule.sourceId) throw new Error('目标不存在');
      const nonce = await this.repository.createConfirmation({ telegramUserId: user.telegramUserId, chatId, action: 'delete-rule', targetId: rule.id });
      return this.edit(callback, `<b>确认删除自定义规则？</b>\n\n<code>${escapeHtml(rule.type)},${escapeHtml(rule.value)}</code>\n\n此操作无法撤销。`, { inlineKeyboard: [[{ text: '确认删除', callbackData: `cf:rd:${nonce}` }, { text: '取消', callbackData: `rule:v:${rule.id}` }]] });
    }
    match = data.match(/^cf:rd:([A-Za-z0-9_-]+)$/);
    if (match) {
      const ruleId = await this.repository.consumeConfirmation(match[1], user.telegramUserId, chatId, 'delete-rule');
      if (!ruleId) return this.client.answerCallbackQuery(callback.id, { text: '操作已过期', showAlert: true });
      const rule = (await listRules(this.env, { limit: 0 })).find((item) => item.id === ruleId);
      if (!rule || rule.sourceId) throw new Error('目标不存在');
      await deleteRule(this.env, rule.categoryId!, rule.id);
      await this.repository.audit({ telegramUserId: user.telegramUserId, chatId, action: 'delete-rule', targetType: 'rule', targetId: rule.id, result: 'success', summary: `${rule.type},${rule.value}` });
      return this.edit(callback, '规则已删除。', { inlineKeyboard: [[{ text: '返回分类', callbackData: `cat:v:${rule.categoryId}` }]] });
    }
    match = data.match(/^sub:l:(\d+)$/);
    if (match) return this.showSubscriptions(chatId, Number(match[1]), callback);
    match = data.match(/^sub:v:([A-Za-z0-9_-]+)$/);
    if (match) return this.showSubscription(callback, match[1], user);
    match = data.match(/^sub:m:([A-Za-z0-9_-]+):([tpx])$/);
    if (match) {
      const target = `${match[1]}:${match[2]}`;
      const nonce = await this.repository.createConfirmation({ telegramUserId: user.telegramUserId, chatId, action: 'subscription-policy', targetId: target });
      return this.edit(callback, `<b>确认切换订阅策略？</b>\n\n目标策略：${match[2] === 't' ? '私密' : match[2] === 'p' ? '公开' : '禁用'}`, { inlineKeyboard: [[{ text: '确认切换', callbackData: `cf:sp:${nonce}` }, { text: '取消', callbackData: `sub:v:${match[1]}` }]] });
    }
    match = data.match(/^cf:sp:([A-Za-z0-9_-]+)$/);
    if (match) {
      const target = await this.repository.consumeConfirmation(match[1], user.telegramUserId, chatId, 'subscription-policy');
      if (!target) return this.client.answerCallbackQuery(callback.id, { text: '操作已过期', showAlert: true });
      const [categoryId, mode] = target.split(':');
      await updateCategory(this.env, categoryId, { tokenLinksEnabled: mode === 't', publicLinksEnabled: mode === 'p' });
      await this.repository.audit({ telegramUserId: user.telegramUserId, chatId, action: 'subscription-policy', targetType: 'category', targetId: categoryId, result: 'success', summary: mode });
      return this.showSubscription(callback, categoryId, user);
    }
    match = data.match(/^src:l:(\d+)$/);
    if (match) return this.showSources(chatId, Number(match[1]), callback);
    match = data.match(/^src:c:([A-Za-z0-9_-]+):(\d+)$/);
    if (match) return this.showSources(chatId, Number(match[2]), callback, match[1]);
    match = data.match(/^src:v:([A-Za-z0-9_-]+)$/);
    if (match) return this.showSource(callback, match[1], user);
    match = data.match(/^src:t:([A-Za-z0-9_-]+)$/);
    if (match) {
      const source = await getSource(this.env, match[1]);
      if (!source) throw new Error('目标不存在');
      await toggleSource(this.env, source.id, !source.enabled);
      await this.repository.audit({ telegramUserId: user.telegramUserId, chatId, action: 'toggle-source', targetType: 'source', targetId: source.id, result: 'success', summary: source.enabled ? 'disabled' : 'enabled' });
      return this.showSource(callback, source.id, user);
    }
    match = data.match(/^src:s:([A-Za-z0-9_-]+)$/);
    if (match) return this.scheduleSync(user, chatId, 'sync-source', match[1]);
    match = data.match(/^src:d:([A-Za-z0-9_-]+)$/);
    if (match) {
      const source = await getSource(this.env, match[1]);
      if (!source) throw new Error('目标不存在');
      const overview = await getRulesOverview(this.env, 0);
      const category = overview.categories.find((item) => item.id === source.categoryId);
      const nonce = await this.repository.createConfirmation({ telegramUserId: user.telegramUserId, chatId, action: 'delete-source', targetId: source.id });
      return this.edit(callback, `<b>即将删除上游来源</b>\n\n类型：${source.sourceType === 'url' ? 'Remote' : source.sourceType}\n名称：${escapeHtml(source.name)}\n分类：${escapeHtml(category?.name ?? '未知')}\n镜像规则：${source.lastCount ?? 0} 条\n\n删除后，该来源及其规则将从订阅中移除。`, { inlineKeyboard: [[{ text: '确认删除', callbackData: `cf:sd:${nonce}` }, { text: '取消', callbackData: `src:v:${source.id}` }]] });
    }
    match = data.match(/^cf:sd:([A-Za-z0-9_-]+)$/);
    if (match) {
      const sourceId = await this.repository.consumeConfirmation(match[1], user.telegramUserId, chatId, 'delete-source');
      if (!sourceId) return this.client.answerCallbackQuery(callback.id, { text: '操作已过期', showAlert: true });
      const source = await deleteSource(this.env, sourceId);
      await this.repository.audit({ telegramUserId: user.telegramUserId, chatId, action: 'delete-source', targetType: 'source', targetId: source.id, result: 'success', summary: source.name });
      return this.edit(callback, '来源及其镜像规则已删除。', { inlineKeyboard: [[{ text: '返回来源列表', callbackData: `src:c:${source.categoryId}:0` }]] });
    }
    return this.client.answerCallbackQuery(callback.id, { text: '无效或已过期的操作', showAlert: true });
  }
}
