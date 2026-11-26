import type { MessageKey } from './zh-CN';

/**
 * Manual terminology polish layered on top of OpenCC `cn -> twp` conversion
 * during `scripts/generate-zh-tw.ts` so UI copy matches natural Traditional
 * Chinese (Taiwan) software terminology (design §13.5).
 */
export const ZH_TW_TERM_OVERRIDES: ReadonlyArray<readonly [string, string]> = [
  ['緩存', '快取'],
  ['配置', '設定'],
  ['默認', '預設'],
  ['組件', '元件'],
  ['刷新', '重新整理'],
  ['信息', '資訊'],
  ['支持', '支援'],
  ['鏈接', '連結'],
  ['網絡', '網路'],
  ['端口', '連接埠'],
  ['服務器', '伺服器'],
  ['服務端', '伺服器端'],
  ['訪問', '存取'],
  ['退出登入', '登出'],
  ['退出登錄', '登出'],
  ['登錄', '登入'],
  ['用戶', '使用者'],
  ['文件', '檔案'],
  ['新建', '新增'],
  ['校驗', '驗證'],
  ['悬停', '懸停'],
];

/**
 * Per-key exact overrides when automatic conversion + term polish needs
 * manual phrasing.
 */
export const ZH_TW_KEY_OVERRIDES: Partial<Record<MessageKey, string>> = {
  'lang.zh-CN': '简体中文',
  'lang.zh-TW': '繁體中文',
  'lang.en': 'English',
  'app.name': 'Private Rules',
};
