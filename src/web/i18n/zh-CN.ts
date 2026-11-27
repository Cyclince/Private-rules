import { zhCNCore } from './zh-CN.core';
import { zhCNPages } from './zh-CN.pages';
// Type-only: the picker copy lives in its own module so the shared pages dictionary stays small.
import type { zhCNApps } from './zh-CN.apps';

export const zhCN = {
  ...zhCNCore,
  ...zhCNPages,
} as const;

export type MessageKey = keyof typeof zhCN | keyof typeof zhCNApps;
export type Messages = Record<MessageKey, string>;
