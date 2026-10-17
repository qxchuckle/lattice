import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel('Lattice');
  return channel;
}

function stamp(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(
    now.getMinutes(),
  )}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

export function log(message: string): void {
  getChannel().appendLine(`[${stamp()}] ${message}`);
}

export function warnLog(message: string): void {
  log(`WARN ${message}`);
}

export function errorLog(message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? `${error.message}` : error !== undefined ? String(error) : '';
  log(`ERROR ${message}${detail ? ` — ${detail}` : ''}`);
}

export function disposeLogging(): void {
  channel?.dispose();
  channel = undefined;
}
