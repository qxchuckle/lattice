/**
 * Vitest 测试环境初始化
 * - 引入 jest-dom 匹配器（toBeInTheDocument / toHaveTextContent 等）
 * - mock window.matchMedia（antd Modal/Grid 等组件依赖，jsdom 环境下不存在）
 */
import '@testing-library/jest-dom/vitest';

// antd 组件（Modal、Grid 等）内部调用 matchMedia 做响应式断点，jsdom 环境下缺失
type WindowWithMatchMedia = typeof globalThis & {
  matchMedia?: (query: string) => unknown;
};
const w = globalThis as WindowWithMatchMedia;
if (typeof w.matchMedia !== 'function') {
  w.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
