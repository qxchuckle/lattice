/**
 * 思考块 — 对齐主流 agent 的「深度思考 · 78s」体验
 *
 * 时间来自块内 startedAt/endedAt（事件 ts 吸收，reload 后不丢），非 UI 计时。
 * 展开策略：流式期间展开（灰体正文可见 + 秒数实时增长），不再是当前流式块后自动折叠；
 * 用户手动展开后不再被自动折叠覆盖（userTouched 守卫）。
 *
 * 注意：不能用 endedAt 判断「是否完成」——appendMerge 首个 delta 就写 endedAt 且
 * 每个 delta 刷新，流式期间 endedAt 始终有值。完成信号用 active（是否当前流式末块）。
 */
import { useState, useEffect, useRef } from 'react';
import { Collapsible } from './Collapsible';
import { formatDuration } from '../turnSummary';

export function ThinkingBlock({
  text,
  startedAt,
  endedAt,
  active,
}: {
  text: string;
  startedAt?: number;
  endedAt?: number;
  /** 该块是否当前正在流式生成的末块（true → 展开 + 实时计时） */
  active?: boolean;
}) {
  // 完成后手动展开过 → 不再自动折叠
  const userTouched = useRef(false);
  const [open, setOpen] = useState(!!active);
  useEffect(() => {
    if (!active && !userTouched.current) setOpen(false);
  }, [active]);

  // 流式期间秒数实时增长：以 startedAt 为基准计算（非累加计数器），刷新后仍准
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || startedAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  // active 时用 now 实时算；结束后用 endedAt 定格（endedAt 缺失时回退 now）
  const duration =
    startedAt !== undefined ? (active ? now - startedAt : (endedAt ?? now) - startedAt) : undefined;
  const durationLabel = duration !== undefined ? formatDuration(duration) : '';

  return (
    <Collapsible
      label={durationLabel ? `深度思考 · ${durationLabel}` : '深度思考'}
      icon='💭'
      status={active ? 'running' : undefined}
      open={open}
      onToggle={(next) => {
        userTouched.current = true;
        setOpen(next);
      }}>
      <div
        style={{
          fontStyle: 'italic',
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          fontSize: 11,
        }}>
        {text}
      </div>
    </Collapsible>
  );
}
