/**
 * ModelTuningModal — 模型参数编辑（上下文窗口 / 思考深度）
 *
 * 纯数据驱动：渲染完全由模型 tuning 规格决定——
 *   有规格才渲染对应控件；freeform 才渲染自由输入；无任何源类型判断。
 * 作用域：tuningTargetTurnId 非空 = 节点作用域（读写该节点参数，追问时生效）；
 *   空 = 全局（虚拟根/新线程，写 activeContextWindow / activeThinkingLevel）。
 * 0/'' = 源默认；'none' = 关闭思考。
 */
import { useState, useEffect } from 'react';
import { Modal, Switch, InputNumber, Input } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import type { ModelListItem } from '@qcqx/lattice-agent-protocol';
import { agentStore, MISSING_TURN } from './store';
import type { TurnNode } from './types';
import { fetchModelsCached } from './api';

/** tokens 数格式化（200000 → 200K / 1000000 → 1M），参数 chip/上下文指示共用 */
export function fmtTokens(n: number): string {
  if (n >= 1000000) return `${n / 1000000}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  margin: '10px 0 4px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

function OptionRow(props: {
  label: string;
  isDefault: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={props.onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 13,
        color: 'var(--text)',
        background: props.selected ? 'rgba(22,119,255,0.08)' : 'transparent',
      }}>
      <span>{props.label}</span>
      {props.isDefault && (
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>默认</span>
      )}
      {props.selected && (
        <CheckOutlined style={{ marginLeft: 'auto', color: 'var(--brand-color)', fontSize: 12 }} />
      )}
    </div>
  );
}

export function ModelTuningModal() {
  const snap = useSnapshot(agentStore);
  // 目标：节点作用域（tuningTargetTurnId）或全局（虚拟根/新线程）
  const targetTurnId = snap.tuningTargetTurnId;
  const targetTurnProxy = targetTurnId ? agentStore.turns.get(targetTurnId) : undefined;
  const targetTurn = useSnapshot(targetTurnProxy ?? MISSING_TURN) as TurnNode;
  const isNode = !!targetTurnProxy;

  // 模型列表按目标的源拉取（节点用其线程源，根用活动源）
  const sourceId = isNode ? targetTurn.sourceId : snap.activeSourceId;
  const [models, setModels] = useState<ModelListItem[]>([]);
  useEffect(() => {
    if (!snap.tuningModelId || !sourceId) {
      setModels([]);
      return;
    }
    let cancelled = false;
    fetchModelsCached(sourceId).then((ms) => {
      if (!cancelled) setModels(ms);
    });
    return () => {
      cancelled = true;
    };
  }, [snap.tuningModelId, sourceId]);

  const model = models.find((m) => m.id === snap.tuningModelId);
  const tuning = model?.tuning;

  const close = () => {
    agentStore.tuningModelId = '';
    agentStore.tuningTargetTurnId = '';
  };

  const cw = tuning?.contextWindow;
  const think = tuning?.thinking;
  // 当前值：节点目标读节点参数，否则读全局
  const curCw = isNode ? (targetTurn.contextWindow ?? 0) : snap.activeContextWindow;
  const curThinking = isNode ? (targetTurn.thinkingLevel ?? '') : snap.activeThinkingLevel;
  const applyCw = (v: number) => {
    if (isNode && targetTurnProxy) targetTurnProxy.contextWindow = v;
    else agentStore.activeContextWindow = v;
  };
  const applyThinking = (v: string) => {
    if (isNode && targetTurnProxy) targetTurnProxy.thinkingLevel = v;
    else agentStore.activeThinkingLevel = v;
  };

  // 0/'' = 使用规格默认值；'none' = 思考关闭
  const selectedCw = curCw || cw?.default || 0;
  const thinkingOff = curThinking === 'none';
  const selectedLevel = thinkingOff ? '' : curThinking || think?.default || '';
  const cwIsPreset = cw ? cw.options.includes(selectedCw) : true;
  const levelIsPreset = think ? think.options.includes(selectedLevel) : true;

  return (
    <Modal
      title={`${model?.displayName ?? ''} 参数`}
      open={!!model && !!tuning}
      onCancel={close}
      footer={null}
      width={340}
      // 高于 antd Dropdown 默认弹层（1050），避免菜单盖住参数弹窗
      zIndex={1100}>
      {cw && (
        <div>
          <div style={sectionTitle}>上下文窗口</div>
          {cw.options.map((v) => (
            <OptionRow
              key={v}
              label={fmtTokens(v)}
              isDefault={v === cw.default}
              selected={v === selectedCw && cwIsPreset}
              onClick={() => {
                // 选中默认项 = 回到"源默认"（不显式传值）
                applyCw(v === cw.default ? 0 : v);
              }}
            />
          ))}
          {cw.freeform && (
            <InputNumber
              size='small'
              style={{ width: '100%', marginTop: 4 }}
              placeholder='自定义 tokens（留空 = 默认）'
              min={1000}
              step={1000}
              value={!cwIsPreset && curCw ? curCw : undefined}
              onChange={(v) => {
                applyCw(v ?? 0);
              }}
            />
          )}
        </div>
      )}

      {think && (
        <div>
          <div style={sectionTitle}>
            思考模式
            {think.toggleable && (
              <Switch
                size='small'
                checked={!thinkingOff}
                onChange={(on) => {
                  applyThinking(on ? '' : 'none');
                }}
              />
            )}
          </div>
          {!thinkingOff && (
            <>
              {think.options.map((lv) => (
                <OptionRow
                  key={lv}
                  label={lv}
                  isDefault={lv === think.default}
                  selected={lv === selectedLevel && levelIsPreset}
                  onClick={() => {
                    applyThinking(lv === think.default ? '' : lv);
                  }}
                />
              ))}
              {think.freeform && (
                <Input
                  size='small'
                  style={{ marginTop: 4 }}
                  placeholder='自定义深度（留空 = 默认）'
                  value={!levelIsPreset ? curThinking : ''}
                  onChange={(e) => {
                    applyThinking(e.target.value.trim());
                  }}
                />
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
