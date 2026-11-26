import { zhCNCore } from './zh-CN.core';
import { zhCNPages } from './zh-CN.pages';

export const zhCN = {
  ...zhCNCore,
  ...zhCNPages,
} as const;

export type MessageKey = keyof typeof zhCN;
export type Messages = Record<MessageKey, string>;
