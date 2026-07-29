/**
 * ThinkingBlock 组件测试 — 「深度思考 · Ns」展开/折叠与计时逻辑
 *
 * 核心回归点：完成信号用 active（是否当前流式末块），而非 endedAt——
 * 流式期间 endedAt 始终有值（每个 delta 刷新），若用它判断完成会导致流式时误折叠。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThinkingBlock } from './ThinkingBlock';

afterEach(cleanup);

describe('ThinkingBlock', () => {
  it('active（流式中）→ 展开显示正文', () => {
    render(<ThinkingBlock text='思考正文内容' startedAt={1000} endedAt={1500} active />);
    expect(screen.getByText('思考正文内容')).toBeTruthy();
  });

  it('非 active（已完成）→ 默认折叠，正文不可见，标签带耗时', () => {
    render(<ThinkingBlock text='思考正文内容' startedAt={1000} endedAt={4500} active={false} />);
    // 折叠：正文不渲染
    expect(screen.queryByText('思考正文内容')).toBeNull();
    // 耗时 = 4500 - 1000 = 3.5s
    expect(screen.getByText('深度思考 · 3.5s')).toBeTruthy();
  });

  it('无时间字段（旧数据）→ 标签仅「深度思考」，不报错', () => {
    render(<ThinkingBlock text='x' active={false} />);
    expect(screen.getByText('深度思考')).toBeTruthy();
  });

  it('active 由 true 转 false → 自动折叠', () => {
    const { rerender } = render(
      <ThinkingBlock text='思考正文内容' startedAt={1000} endedAt={1200} active />,
    );
    expect(screen.getByText('思考正文内容')).toBeTruthy();
    // 流式结束（不再是末块）
    rerender(<ThinkingBlock text='思考正文内容' startedAt={1000} endedAt={2000} active={false} />);
    expect(screen.queryByText('思考正文内容')).toBeNull();
  });

  it('用户手动展开后，active 转 false 不再自动折叠', () => {
    const { rerender } = render(
      <ThinkingBlock text='思考正文内容' startedAt={1000} endedAt={1200} active />,
    );
    // 先手动折叠再手动展开（标记 userTouched）
    fireEvent.click(screen.getByText(/深度思考/));
    fireEvent.click(screen.getByText(/深度思考/));
    rerender(<ThinkingBlock text='思考正文内容' startedAt={1000} endedAt={2000} active={false} />);
    // userTouched 守卫：保持展开
    expect(screen.getByText('思考正文内容')).toBeTruthy();
  });
});
