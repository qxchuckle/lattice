import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/** webview HTML 构建（图谱面板与任务详情视图共用）。 */

export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

/** 编辑器显示语言归一化：zh-* → zh-cn，其余 → en（与 package.nls / l10n 的加载口径一致）。 */
export function webviewLanguage(): 'zh-cn' | 'en' {
  return (vscode.env.language ?? 'en').toLowerCase().startsWith('zh') ? 'zh-cn' : 'en';
}

export function themeMode(): 'light' | 'dark' {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
    ? 'dark'
    : 'light';
}

export function errorHtml(message: string): string {
  const escaped = message.replace(/</g, '&lt;');
  return `<!doctype html><html><body style="font-family: -apple-system, sans-serif; padding: 16px; color: var(--vscode-foreground, #333);"><h3>Lattice</h3><p>${escaped}</p></body></html>`;
}

/**
 * 构建 webview HTML。
 * - `options.view` 注入 `window.__LATTICE_VIEW__`（前端以此选择渲染模式：侧栏详情视图为 `detail`）；
 * - 语言与主题在模块加载前注入（模块级常量依赖此值；CSP 以 nonce 放行这一条内联脚本）。
 */
export function buildWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  options: { view?: 'detail' } = {},
): string {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview');
  const html = readFileSync(path.join(mediaRoot.fsPath, 'webview.html'), 'utf8');
  const withUris = html.replace(
    /(src|href)="\.\/assets\/([^"]+)"/g,
    (_match, attr: string, relative: string) =>
      `${attr}="${webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'assets', relative))}"`,
  );
  const nonce = createNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `font-src ${webview.cspSource} data:`,
    `connect-src 'none'`,
  ].join('; ');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const viewInit = options.view
    ? ` window.__LATTICE_VIEW__ = ${JSON.stringify(options.view)}; document.documentElement.setAttribute('data-lattice-view', ${JSON.stringify(options.view)});`
    : '';
  const bootstrap = `<script nonce="${nonce}">window.__LATTICE_LANG__ = ${JSON.stringify(
    webviewLanguage(),
  )}; window.__LATTICE_THEME__ = ${JSON.stringify(themeMode())};${viewInit}</script>`;
  return withUris.includes('</head>')
    ? withUris.replace('</head>', `  ${meta}\n  ${bootstrap}\n</head>`)
    : withUris.replace('<head>', `<head>\n  ${meta}\n  ${bootstrap}`);
}
