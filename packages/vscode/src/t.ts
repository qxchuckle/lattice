import * as vscode from 'vscode';

type L10nArg = string | number | boolean;

/**
 * l10n 统一入口：运行时用户可见文案必须经此函数。
 * 源码英文原文为 key；中文翻译在 l10n/bundle.l10n.zh-cn.json。
 */
export function t(message: string, ...args: L10nArg[]): string {
  return vscode.l10n.t(message, ...args);
}
