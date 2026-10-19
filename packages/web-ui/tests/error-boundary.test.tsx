import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

// antd（cssinjs / 响应式）在 jsdom 下需要 matchMedia 桩
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(cleanup);

it('子组件抛错时渲染兜底 UI（标题 + 错误信息）而非白屏', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const Boom = (): never => {
    throw new Error('boom-测试');
  };
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
  expect(screen.getByText('页面出错了')).toBeTruthy();
  expect(screen.getByText('boom-测试')).toBeTruthy();
  spy.mockRestore();
});

it('无错误时透传子节点', () => {
  render(
    <ErrorBoundary>
      <div>正常内容</div>
    </ErrorBoundary>,
  );
  expect(screen.getByText('正常内容')).toBeTruthy();
});
