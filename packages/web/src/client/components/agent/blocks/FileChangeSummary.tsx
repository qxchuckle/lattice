/**
 * 回合末改动文件汇总 — 「本轮干了什么」的结构化收口
 *
 * 数据来自 collectFileChanges(turn.blocks) 纯函数聚合（live/reload 同一数据源），
 * 回合完成（非 streaming）且有改动时渲染在 UsageFooter 上方，默认折叠一行。
 * 点击路径走 /api/open-path（后端 isPathSafe 校验），前端不直接传 path 给其他接口。
 */
import { useState, useCallback } from 'react';
import { App } from 'antd';
import type { NodeContent } from '@qcqx/lattice-agent-protocol';
import { collectFileChanges } from '../turnSummary';
import { getAdapter } from '../../../adapters';

const KIND_LABEL: Record<string, string> = {
  create: '新建',
  edit: '编辑',
  delete: '删除',
};

export function FileChangeSummary({
  blocks,
  streaming,
}: {
  blocks: NodeContent[];
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { message } = App.useApp();
  const items = collectFileChanges(blocks);

  const handleOpenPath = useCallback(
    async (path: string) => {
      const ok = await getAdapter().openPathByPath(path, 'qoder');
      if (!ok) message.warning('无法打开该文件（可能不在已注册项目内）');
    },
    [message],
  );

  // 流式期间不渲染（回合未结束，清单不完整会造成误导）
  if (streaming || items.length === 0) return null;

  return (
    <div
      style={{
        margin: '4px 0',
        borderRadius: 6,
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          cursor: 'pointer',
          fontSize: 11,
          background: 'var(--bg-tertiary)',
          userSelect: 'none',
          color: 'var(--text)',
        }}>
        <span
          style={{
            fontSize: 10,
            opacity: 0.6,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}>
          ▶
        </span>
        <span>📝</span>
        <span style={{ flex: 1 }}>本轮改动 {items.length} 个文件</span>
      </div>
      {open && (
        <div style={{ padding: '4px 8px', borderTop: '1px solid var(--border)' }}>
          {items.map((item) => (
            <div
              key={item.path}
              onClick={() => handleOpenPath(item.path)}
              title={item.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 0',
                fontSize: 10,
                cursor: 'pointer',
                color: 'var(--brand-color)',
              }}>
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  direction: 'rtl',
                  textAlign: 'left',
                }}>
                {item.path}
              </span>
              <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
                {KIND_LABEL[item.kind ?? 'edit'] ?? '编辑'}
                {item.count > 1 ? ` ×${item.count}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
