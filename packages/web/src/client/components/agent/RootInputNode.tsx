/**
 * RootInputNode — 初始输入节点（始终存在，特殊样式）
 * 输入骨架复用 ChatInputBox（与对话节点追问区同布局），控件行 = 源 + 模型 + 参数 chip
 *
 * 源/模型选择用 Dropdown 菜单（非 Select）：菜单项内嵌齿轮/编辑按钮是 Dropdown 的
 * 标准用法；rc-select 的 option 有自己的 mousedown/选中拦截，不支持项内交互元素。
 */
import { useState, memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useSnapshot } from 'valtio';
import { Dropdown } from 'antd';
import { SettingOutlined, DownOutlined } from '@ant-design/icons';
import { agentStore, submitFromNode, setSource, setModel, loadModels } from './agentStore';
import { ModelTuningModal, fmtTokens } from './ModelTuningModal';
import { ChatInputBox, ModelMenuChip, MenuRow, chipStyle } from './ChatInputBar';

function RootInputInner() {
  const snap = useSnapshot(agentStore);
  const [focused, setFocused] = useState(false);
  // 菜单受控：点项内齿轮图标（stopPropagation 不触发选中）时也能主动收起菜单
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);

  // 选项完全由 server 下发的源/模型数据驱动（无硬编码 fallback，未加载时禁用）
  const activeSource = snap.sources.find((s) => s.id === snap.activeSourceId);

  // 当前生效参数（选择值回退 tuning 默认值）：仅模型有 tuning 时展示参数 chip
  const activeModel = snap.models.find((m) => m.id === snap.activeModelId);
  const tuning = activeModel?.tuning;
  const effectiveCw = snap.activeContextWindow || tuning?.contextWindow?.default || 0;
  const effectiveThinking =
    snap.activeThinkingLevel === 'none'
      ? '不思考'
      : snap.activeThinkingLevel || tuning?.thinking?.default || '';
  const paramLabel = [effectiveCw ? fmtTokens(effectiveCw) : null, effectiveThinking || null]
    .filter(Boolean)
    .join(' · ');

  const sourceMenuItems = snap.sources.map((s) => ({
    key: s.id,
    label: (
      <MenuRow
        label={`∞ ${s.displayName}`}
        selected={s.id === snap.activeSourceId}
        action={{
          icon: <SettingOutlined style={{ fontSize: 12 }} />,
          title: '源配置',
          onClick: () => {
            setSourceMenuOpen(false);
            agentStore.settingsFocusSourceId = s.id;
            agentStore.settingsOpen = true;
          },
        }}
      />
    ),
  }));

  return (
    <div className='nowheel nopan' style={{ width: '100%', height: '100%' }}>
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 12,
          border: `1.5px solid ${focused ? 'var(--brand-color)' : 'var(--border)'}`,
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '8px 12px',
          boxShadow: focused ? '0 0 8px rgba(22,119,255,0.2)' : 'var(--shadow)',
          transition: 'border-color 0.2s, box-shadow 0.2s',
        }}>
        <Handle
          type='source'
          position={Position.Bottom}
          style={{ background: 'var(--brand-color)', width: 6, height: 6 }}
        />

        <ChatInputBox
          placeholder='输入消息开始对话...'
          canSubmit
          onSubmit={(text) => submitFromNode(null, text)}
          onFocusChange={setFocused}
          controls={
            <>
              {/* 源选择（仅虚拟根：每次从这里发消息 = 用所选源开启一段全新对话） */}
              <Dropdown
                menu={{
                  items: sourceMenuItems,
                  onClick: ({ key }) => {
                    setSourceMenuOpen(false);
                    setSource(key);
                  },
                }}
                trigger={['click']}
                open={sourceMenuOpen}
                onOpenChange={setSourceMenuOpen}
                disabled={snap.sources.length === 0}>
                <button
                  type='button'
                  style={chipStyle}
                  title='选择源（每次从这里发消息 = 用所选源开启一段全新对话）'>
                  ∞ {activeSource?.displayName ?? '加载源...'}
                  <DownOutlined style={{ fontSize: 9, color: 'var(--text-secondary)' }} />
                </button>
              </Dropdown>

              <ModelMenuChip
                models={snap.models}
                value={snap.activeModelId}
                onChange={setModel}
                onEdit={(id) => {
                  // 编辑即选中该模型（参数作用于当前选择）；已选中时不重置已有参数
                  if (agentStore.activeModelId !== id) setModel(id);
                  agentStore.tuningModelId = id;
                  agentStore.tuningTargetTurnId = ''; // 全局（新线程）
                }}
                // 打开菜单时刷新目录：server 侧 SWR，动态目录就绪后自然替换静态兜底
                onOpen={() => loadModels(agentStore.activeSourceId)}
              />

              {/* 当前参数 chip（有 tuning 规格才展示，数据控制渲染）：点击直接编辑 */}
              {tuning && paramLabel && (
                <button
                  type='button'
                  style={{ ...chipStyle, color: 'var(--text-secondary)' }}
                  title='当前参数（上下文窗口 · 思考深度），点击编辑'
                  onClick={() => {
                    agentStore.tuningModelId = snap.activeModelId;
                    agentStore.tuningTargetTurnId = ''; // 全局（新线程）
                  }}>
                  {paramLabel}
                </button>
              )}
            </>
          }
        />
      </div>

      {/* 模型参数编辑（tuning 规格数据驱动） */}
      <ModelTuningModal />
    </div>
  );
}

export const RootInputNode = memo(RootInputInner);
