/**
 * ChatInputBar — 对话输入组件（RootInputNode 与 ConversationNodeComponent 共用）
 *
 * 布局契约（两处一致）：
 *   第一行：多行输入框（独占一行）
 *   第二行：控件 chips（源/模型/参数等，由调用方插槽提供）+ 右侧发送按钮
 *
 * 数据控制渲染：模型菜单项的费率（costLabel）与编辑入口（tuning + onEdit 提供）均由数据门控。
 */
import { useState, useCallback } from 'react';
import { Dropdown } from 'antd';
import { DownOutlined, EditOutlined } from '@ant-design/icons';
import type { ModelListItem } from '@qcqx/lattice-agent-protocol';

/** 深只读（兼容 valtio useSnapshot 返回的深 readonly 结构） */
type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };
type ModelItem = Immutable<ModelListItem>;

export const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--bg-tertiary)',
  color: 'var(--text)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/** 菜单项内容：标签 + 可选费率小字 + 可选后置操作图标（阻止冒泡避免触发项选中） */
export function MenuRow(props: {
  label: string;
  selected: boolean;
  extra?: string;
  action?: { icon: React.ReactNode; title: string; onClick: () => void };
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
      <span style={{ fontWeight: props.selected ? 600 : 400 }}>{props.label}</span>
      {props.selected && <span style={{ color: 'var(--brand-color)', fontSize: 11 }}>✓</span>}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {props.extra && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{props.extra}</span>
        )}
        {props.action && (
          <span
            title={props.action.title}
            onClick={(e) => {
              e.stopPropagation();
              props.action!.onClick();
            }}
            style={{
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}>
            {props.action.icon}
          </span>
        )}
      </span>
    </span>
  );
}

function modelLabel(m: ModelItem): string {
  return m.custom ? `${m.displayName}（自定义）` : m.displayName;
}

/**
 * 模型选择 chip（Dropdown 菜单）：
 * - onEdit 提供时，有 tuning 规格的模型项渲染编辑图标（编辑即选中该模型）
 * - onOpen 提供时，菜单打开触发（如刷新目录）
 */
export function ModelMenuChip(props: {
  models: readonly ModelItem[];
  value: string;
  onChange: (id: string) => void;
  onEdit?: (id: string) => void;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = props.models.find((m) => m.id === props.value);

  const items = props.models.map((m) => ({
    key: m.id,
    label: (
      <MenuRow
        label={modelLabel(m)}
        selected={m.id === props.value}
        extra={m.costLabel}
        action={
          props.onEdit && m.tuning
            ? {
                icon: <EditOutlined style={{ fontSize: 12 }} />,
                title: '编辑参数（上下文窗口/思考深度）',
                onClick: () => {
                  setOpen(false);
                  props.onEdit!(m.id);
                },
              }
            : undefined
        }
      />
    ),
  }));

  return (
    <Dropdown
      menu={{
        items,
        onClick: ({ key }) => {
          setOpen(false);
          props.onChange(key);
        },
      }}
      trigger={['click']}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) props.onOpen?.();
      }}
      disabled={props.models.length === 0}>
      <button type='button' style={chipStyle} title='选择模型'>
        {current ? modelLabel(current) : props.value || '默认模型'}
        <DownOutlined style={{ fontSize: 9, color: 'var(--text-secondary)' }} />
      </button>
    </Dropdown>
  );
}

/**
 * ChatInputBox — 两行输入骨架：
 *   输入框独占一行；控件行 = controls 插槽 + 弹性空白 + trailing 插槽 + 发送按钮
 */
export function ChatInputBox(props: {
  placeholder: string;
  /** false 时禁止提交（如流式中） */
  canSubmit: boolean;
  onSubmit: (text: string) => void;
  /** 控件行左侧（源/模型/参数 chips） */
  controls?: React.ReactNode;
  /** 发送按钮左侧（如上下文查看） */
  trailing?: React.ReactNode;
  /** 输入框聚焦状态变化（外层高亮边框用） */
  onFocusChange?: (focused: boolean) => void;
}) {
  const [input, setInput] = useState('');

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || !props.canSubmit) return;
    props.onSubmit(text);
    setInput('');
  }, [input, props]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const submittable = input.trim().length > 0 && props.canSubmit;

  return (
    <div
      className='nodrag nowheel nopan'
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}>
      {/* 第一行：输入框 */}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => props.onFocusChange?.(true)}
        onBlur={() => props.onFocusChange?.(false)}
        placeholder={props.placeholder}
        rows={1}
        className='nowheel'
        style={{
          width: '100%',
          resize: 'none',
          padding: '6px 8px',
          marginBottom: 2,
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text)',
          fontSize: 12,
          lineHeight: 1.4,
          outline: 'none',
          fontFamily: 'inherit',
        }}
      />
      {/* 第二行：控件 + 发送 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {props.controls}
        <div style={{ flex: 1 }} />
        {props.trailing}
        <button
          onClick={handleSubmit}
          disabled={!submittable}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: 'none',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: submittable ? 'var(--brand-color)' : 'var(--bg-tertiary)',
            color: submittable ? '#fff' : 'var(--text-secondary)',
            cursor: submittable ? 'pointer' : 'default',
            flexShrink: 0,
          }}>
          ↑
        </button>
      </div>
    </div>
  );
}
