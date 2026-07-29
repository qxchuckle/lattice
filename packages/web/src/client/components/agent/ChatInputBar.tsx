/**
 * ChatInputBar — 对话输入组件（RootInputNode 与 ConversationNodeComponent 共用）
 *
 * 布局契约（两处一致）：
 *   第一行：多行输入框（独占一行）
 *   第二行：控件 chips（源/模型/参数等，由调用方插槽提供）+ 右侧发送按钮
 *
 * 数据控制渲染：模型菜单项的费率（costLabel）与编辑入口（tuning + onEdit 提供）均由数据门控。
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Dropdown, Image } from 'antd';
import { DownOutlined, EditOutlined } from '@ant-design/icons';
import type { ModelListItem, ResourceListItem, PromptSegment } from '@qcqx/lattice-agent-protocol';
import { segmentsToDisplayText } from '@qcqx/lattice-agent-protocol';
import { apiGet } from '../../lib';
import {
  buildSegments,
  chipDisplay,
  commandChip,
  imageChip,
  fileChip,
  selectionChip,
  filterCommandResources,
  slashKeyword,
  atKeyword,
} from './promptSegments';
import type { ChipItem, FileSearchResult } from './promptSegments';

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

/** 输入框补全菜单统一项：/ 命令 或 @ 引用（文件/选区） */
type MenuEntry =
  | { kind: 'command'; key: string; name: string; hint?: string; desc?: string }
  | { kind: 'file'; path: string; name: string; root: string }
  | { kind: 'selection'; text: string; display: string };

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
 *   输入框独占一行（chip 编辑器：命令 chip + 尾部自由文本）；控件行 = controls 插槽 + 弹性空白 + trailing 插槽 + 发送按钮
 *   首字符 `/` 触发命令补全菜单（数据来自 /api/agent/resources 聚合：本地 lattice 命令 + 源级命令）；
 *   选中插入原子 chip（整体删除），发送时序列化为 segments 交给编排层展开
 */
export function ChatInputBox(props: {
  placeholder: string;
  /** false 时禁止提交（如流式中） */
  canSubmit: boolean;
  /** text = 用户可见文本（displayText）；segments = 结构化输入（含 chip 时提供） */
  onSubmit: (text: string, segments?: PromptSegment[]) => void;
  /** 当前模型是否支持图片输入（由调用方按源下发的 capabilities.vision 计算）；不支持时粘贴图片静默忽略 */
  allowImages?: boolean;
  /** 提供编辑器选区时，@ 菜单顶部出现「插入选区」入口（workbench 传入，画布不传） */
  getSelection?: () => { text: string; display: string } | null;
  /** 控件行左侧（源/模型/参数 chips） */
  controls?: React.ReactNode;
  /** 发送按钮左侧（如上下文查看） */
  trailing?: React.ReactNode;
  /** 输入框聚焦状态变化（外层高亮边框用） */
  onFocusChange?: (focused: boolean) => void;
}) {
  const [input, setInput] = useState('');
  const [chips, setChips] = useState<ChipItem[]>([]);
  const [resources, setResources] = useState<ResourceListItem[] | null>(null);
  const [fileResults, setFileResults] = useState<FileSearchResult[] | null>(null);
  const [menuIdx, setMenuIdx] = useState(0);
  const [menuSuppressed, setMenuSuppressed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 触发态：/ 命令菜单 或 @ 引用菜单（文件搜索 + 选区）
  const kw = slashKeyword(input);
  const atKw = atKeyword(input);

  // 惰性加载命令资源（首次输入 / 时）；失败降级为空列表（纯文本路径不受影响）
  useEffect(() => {
    if (kw === null || resources !== null) return;
    let cancelled = false;
    apiGet<{ resources: ResourceListItem[] }>('/api/agent/resources?kinds=command')
      .then((res) => {
        if (!cancelled) setResources(res.resources);
      })
      .catch(() => {
        if (!cancelled) setResources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kw, resources]);

  // @ 文件搜索（250ms 防抖）；离开 @ 态时清空
  useEffect(() => {
    if (atKw === null) {
      setFileResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      apiGet<{ files: FileSearchResult[] }>(`/api/agent/file-search?q=${encodeURIComponent(atKw)}`)
        .then((r) => {
          if (!cancelled) setFileResults(r.files);
        })
        .catch(() => {
          if (!cancelled) setFileResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [atKw]);

  // 统一菜单项：/ → 命令；@ → 选区入口（如有）+ 文件搜索结果
  const selection = atKw !== null ? (props.getSelection?.() ?? null) : null;
  const menuEntries: MenuEntry[] = (() => {
    if (menuSuppressed) return [];
    if (kw !== null && resources) {
      return filterCommandResources(resources, kw)
        .slice(0, 12)
        .map((r) => ({
          kind: 'command' as const,
          key: `${r.origin}-${r.sourceId ?? 'local'}-${r.name}`,
          name: r.name,
          hint: r.argumentHint,
          desc: r.description,
        }));
    }
    if (atKw !== null) {
      const entries: MenuEntry[] = [];
      if (selection && selection.text.trim()) {
        entries.push({ kind: 'selection', text: selection.text, display: selection.display });
      }
      for (const f of fileResults ?? []) {
        entries.push({ kind: 'file', path: f.path, name: f.name, root: f.root });
      }
      return entries.slice(0, 12);
    }
    return [];
  })();
  const menuVisible = menuEntries.length > 0;

  const insertEntry = useCallback((entry: MenuEntry) => {
    setChips((prev) => [
      ...prev,
      entry.kind === 'command'
        ? commandChip(entry.name)
        : entry.kind === 'file'
          ? fileChip(entry.path, entry.root || entry.name)
          : selectionChip(entry.text, entry.display),
    ]);
    setInput('');
    setMenuIdx(0);
    textareaRef.current?.focus();
  }, []);

  const removeChip = useCallback((key: string) => {
    setChips((prev) => prev.filter((c) => c.key !== key));
  }, []);

  // 粘贴图片 → base64 image chip（仅 vision 模型；能力由源的模型信息声明，调用方门控）
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!props.allowImages) return; // 非 vision 模型：保持默认文本粘贴行为
      const images = [...e.clipboardData.items].filter((it) => it.type.startsWith('image/'));
      if (images.length === 0) return;
      e.preventDefault();
      for (const item of images) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const url = String(reader.result); // data:image/png;base64,xxx
          const base64 = url.slice(url.indexOf(',') + 1);
          setChips((prev) => [...prev, imageChip(base64, file.type, file.name || undefined)]);
        };
        reader.readAsDataURL(file);
      }
    },
    [props.allowImages],
  );

  const handleSubmit = useCallback(() => {
    const segments = buildSegments(chips, input);
    const text = segments ? segmentsToDisplayText(segments) : input.trim();
    if (!text || !props.canSubmit) return;
    props.onSubmit(text, segments ?? undefined);
    setInput('');
    setChips([]);
  }, [input, chips, props]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      // 菜单导航优先于提交
      if (menuVisible) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setMenuIdx((i) => {
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            return (i + delta + menuEntries.length) % menuEntries.length;
          });
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          insertEntry(menuEntries[Math.min(menuIdx, menuEntries.length - 1)]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMenuSuppressed(true);
          return;
        }
      }
      // 空输入时 Backspace 整体删除最后一个 chip（原子性）
      if (e.key === 'Backspace' && input.length === 0 && chips.length > 0) {
        e.preventDefault();
        setChips((prev) => prev.slice(0, -1));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, menuVisible, menuEntries, menuIdx, insertEntry, input, chips.length],
  );

  const submittable = (input.trim().length > 0 || chips.length > 0) && props.canSubmit;

  // 图片 chip 与命令 chip 分流渲染：图片置顶行（Qoder 同款：横滚 + 删除 + 点击看大图），命令行内
  const imageChips = chips.filter((c) => c.segment.type === 'image');
  const inlineChips = chips.filter((c) => c.segment.type !== 'image');

  return (
    <div
      className='nodrag nowheel nopan'
      style={{ position: 'relative' }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}>
      {/* 补全菜单（输入框上方浮层）：/ 命令 或 @ 文件/选区 */}
      {menuVisible && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: 4,
            maxHeight: 220,
            overflowY: 'auto',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: 'var(--shadow)',
            zIndex: 30,
          }}>
          {menuEntries.map((entry, i) => {
            const active = i === menuIdx;
            const rowStyle: React.CSSProperties = {
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '5px 10px',
              cursor: 'pointer',
              background: active ? 'var(--bg-tertiary)' : 'transparent',
            };
            const tailStyle: React.CSSProperties = {
              fontSize: 11,
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginLeft: 'auto',
              minWidth: 0,
            };
            if (entry.kind === 'command') {
              return (
                <div
                  key={entry.key}
                  onMouseDown={(e) => {
                    e.preventDefault(); // 保持输入框焦点
                    insertEntry(entry);
                  }}
                  onMouseEnter={() => setMenuIdx(i)}
                  style={rowStyle}>
                  <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
                    /{entry.name}
                  </span>
                  {entry.hint && (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {entry.hint}
                    </span>
                  )}
                  <span style={tailStyle}>{entry.desc}</span>
                </div>
              );
            }
            if (entry.kind === 'file') {
              return (
                <div
                  key={entry.path}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertEntry(entry);
                  }}
                  onMouseEnter={() => setMenuIdx(i)}
                  style={rowStyle}>
                  <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>📄 {entry.name}</span>
                  <span style={tailStyle}>{entry.root}</span>
                </div>
              );
            }
            return (
              <div
                key='__selection__'
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertEntry(entry);
                }}
                onMouseEnter={() => setMenuIdx(i)}
                style={rowStyle}>
                <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>📎 插入编辑器选区</span>
                <span style={tailStyle}>{entry.display}</span>
              </div>
            );
          })}
        </div>
      )}
      {/* 图片行：输入框顶部独立一行，超宽横向滚动，点击缩略图看大图，× 删除 */}
      {imageChips.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            padding: '4px 2px',
            marginBottom: 2,
          }}>
          {imageChips.map((c) => {
            const seg = c.segment as Extract<PromptSegment, { type: 'image' }>;
            const src = `data:${seg.mimeType};base64,${seg.data}`;
            return (
              <div key={c.key} style={{ position: 'relative', flexShrink: 0 }}>
                <Image
                  src={src}
                  alt={seg.name ?? 'image'}
                  width={48}
                  height={48}
                  style={{
                    objectFit: 'cover',
                    borderRadius: 6,
                    display: 'block',
                    cursor: 'zoom-in',
                  }}
                  preview={{ mask: false }}
                />
                <span
                  onClick={() => removeChip(c.key)}
                  title='移除图片'
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                    fontSize: 9,
                    lineHeight: '14px',
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}>
                  ✕
                </span>
              </div>
            );
          })}
        </div>
      )}
      {/* 第一行：chip + 输入框（同一视觉容器） */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          padding: '4px 8px',
          marginBottom: 2,
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
        }}>
        {inlineChips.map((c) => (
          <span
            key={c.key}
            contentEditable={false}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 4,
              background: 'var(--brand-color)',
              color: '#fff',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
            {chipDisplay(c.segment)}
            <span
              onClick={() => removeChip(c.key)}
              style={{ cursor: 'pointer', opacity: 0.8, fontSize: 10 }}
              title='移除'>
              ✕
            </span>
          </span>
        ))}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setMenuSuppressed(false);
            setMenuIdx(0);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => props.onFocusChange?.(true)}
          onBlur={() => props.onFocusChange?.(false)}
          placeholder={chips.length > 0 ? '补充参数或直接发送...' : props.placeholder}
          rows={1}
          className='nowheel'
          style={{
            flex: 1,
            minWidth: 120,
            resize: 'none',
            padding: '2px 0',
            background: 'transparent',
            border: 'none',
            color: 'var(--text)',
            fontSize: 12,
            lineHeight: 1.4,
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
      </div>
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
