import { afterEach, expect, it } from 'vitest';
import { isWebviewHost } from '../src/host-mode';

interface GlobalWithVscode {
  acquireVsCodeApi?: unknown;
}

afterEach(() => {
  delete (globalThis as GlobalWithVscode).acquireVsCodeApi;
});

it('无宿主注入时返回 false（浏览器宿主）', () => {
  expect(isWebviewHost()).toBe(false);
});

it('VSCode Webview 注入 acquireVsCodeApi 时返回 true', () => {
  (globalThis as GlobalWithVscode).acquireVsCodeApi = () => ({});
  expect(isWebviewHost()).toBe(true);
});

it('acquireVsCodeApi 非函数时不误判', () => {
  (globalThis as GlobalWithVscode).acquireVsCodeApi = 'not-a-function';
  expect(isWebviewHost()).toBe(false);
});
