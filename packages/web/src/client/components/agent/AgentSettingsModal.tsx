/**
 * AgentSettingsModal — Agent 配置页（通用 / 模型 两个 tab）
 * 持久化到 local config 的 agent 段：
 *   agent.defaultSource / agent.defaultModel / agent.customModels.<sourceId>
 */
import { useState, useEffect, useCallback } from 'react';
import { Modal, Tabs, Select, Input, Button, Tag, App } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useSnapshot } from 'valtio';
import type { ModelListItem } from '@qcqx/lattice-agent-protocol';
import { getAdapter } from '../../adapters';
import { agentStore } from './store';
import { fetchModels, loadAgentConfig, loadModels, clearModelListCache } from './api';

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text)',
  marginBottom: 4,
};
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  marginBottom: 8,
};

export function AgentSettingsModal() {
  const snap = useSnapshot(agentStore);
  const { message } = App.useApp();

  const [defaultSource, setDefaultSource] = useState<string | undefined>();
  const [defaultModel, setDefaultModel] = useState<string | undefined>();
  const [customModels, setCustomModels] = useState<Record<string, string[]>>({});
  const [defaultSourceModels, setDefaultSourceModels] = useState<ModelListItem[]>([]);
  const [viewSourceId, setViewSourceId] = useState<string>('');
  const [viewModels, setViewModels] = useState<ModelListItem[]>([]);
  const [newModelId, setNewModelId] = useState('');
  const [activeTab, setActiveTab] = useState('general');

  // 打开时加载配置；源下拉齿轮入口携带聚焦源 → 直接定位模型 tab + 该源
  useEffect(() => {
    if (!snap.settingsOpen) return;
    const focus = agentStore.settingsFocusSourceId;
    agentStore.settingsFocusSourceId = '';
    setViewSourceId(focus || agentStore.activeSourceId);
    setActiveTab(focus ? 'models' : 'general');
    loadAgentConfig().then((cfg) => {
      setDefaultSource(cfg.defaultSource);
      setDefaultModel(cfg.defaultModel);
      setCustomModels(cfg.customModels ?? {});
    });
  }, [snap.settingsOpen]);

  // 通用 tab：默认源变化 → 拉取该源模型作为默认模型候选（先清空防残留 + 竞态守卫）
  useEffect(() => {
    setDefaultSourceModels([]);
    if (!snap.settingsOpen || !defaultSource) return;
    let cancelled = false;
    fetchModels(defaultSource).then((ms) => {
      if (!cancelled) setDefaultSourceModels(ms);
    });
    return () => {
      cancelled = true;
    };
  }, [snap.settingsOpen, defaultSource]);

  // 模型 tab：查看源变化 → 拉取模型列表；切源时立即清空旧列表（避免残留展示上一个源的模型）
  // + cancelled 守卫（快速切换时旧响应不覆盖新响应）
  useEffect(() => {
    setViewModels([]);
    if (!snap.settingsOpen || !viewSourceId) return;
    let cancelled = false;
    fetchModels(viewSourceId).then((ms) => {
      if (!cancelled) setViewModels(ms);
    });
    return () => {
      cancelled = true;
    };
  }, [snap.settingsOpen, viewSourceId]);

  const persist = useCallback(
    async (key: string, value: unknown) => {
      const ok =
        value === undefined
          ? await getAdapter().unsetConfig(key, 'local')
          : await getAdapter().setConfig(key, value, 'local');
      if (!ok) message.error('保存失败');
      return ok;
    },
    [message],
  );

  const handleDefaultSourceChange = useCallback(
    async (value: string | undefined) => {
      setDefaultSource(value);
      setDefaultModel(undefined);
      await persist('agent.defaultSource', value);
      await persist('agent.defaultModel', undefined);
      // 虚拟根始终可换源：直接应用为当前选择（下一段新对话生效）
      if (value) {
        agentStore.activeSourceId = value;
        agentStore.activeModelId = '';
        loadModels(value);
      }
    },
    [persist],
  );

  const handleDefaultModelChange = useCallback(
    async (value: string | undefined) => {
      setDefaultModel(value);
      await persist('agent.defaultModel', value);
      if (value && (defaultSource ?? agentStore.activeSourceId) === agentStore.activeSourceId) {
        agentStore.activeModelId = value;
      }
    },
    [persist, defaultSource],
  );

  const viewSource = snap.sources.find((s) => s.id === viewSourceId);
  const supportsCustom = viewSource ? viewSource.modelPolicy !== 'catalog' : false;

  const refreshAfterCustomChange = useCallback(async (sourceId: string) => {
    clearModelListCache();
    fetchModels(sourceId).then(setViewModels);
    if (sourceId === agentStore.activeSourceId) await loadModels(sourceId);
  }, []);

  const handleAddCustomModel = useCallback(async () => {
    const id = newModelId.trim();
    if (!id || !viewSourceId) return;
    const list = customModels[viewSourceId] ?? [];
    if (list.includes(id) || viewModels.some((m) => m.id === id)) {
      message.warning('模型已存在');
      return;
    }
    const next = { ...customModels, [viewSourceId]: [...list, id] };
    setCustomModels(next);
    setNewModelId('');
    if (await persist(`agent.customModels.${viewSourceId}`, next[viewSourceId])) {
      await refreshAfterCustomChange(viewSourceId);
    }
  }, [
    newModelId,
    viewSourceId,
    customModels,
    viewModels,
    persist,
    message,
    refreshAfterCustomChange,
  ]);

  const handleRemoveCustomModel = useCallback(
    async (modelId: string) => {
      if (!viewSourceId) return;
      const list = (customModels[viewSourceId] ?? []).filter((m) => m !== modelId);
      const next = { ...customModels, [viewSourceId]: list };
      setCustomModels(next);
      if (await persist(`agent.customModels.${viewSourceId}`, list)) {
        await refreshAfterCustomChange(viewSourceId);
      }
    },
    [viewSourceId, customModels, persist, refreshAfterCustomChange],
  );

  const sourceOptions = snap.sources.map((s) => ({
    value: s.id,
    label: `${s.displayName} (${s.modelPolicy})`,
  }));

  const generalTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
      <div>
        <div style={labelStyle}>默认源</div>
        <div style={hintStyle}>新建对话时默认使用的源（对话开始后源锁定，不可切换）</div>
        <Select
          style={{ width: 280 }}
          size='small'
          allowClear
          placeholder='跟随系统（qoder）'
          value={defaultSource}
          options={sourceOptions}
          onChange={handleDefaultSourceChange}
        />
      </div>
      <div>
        <div style={labelStyle}>默认模型</div>
        <div style={hintStyle}>新建对话时默认选中的模型（未设置时取源模型列表第一项）</div>
        <Select
          style={{ width: 280 }}
          size='small'
          allowClear
          disabled={!defaultSource}
          placeholder={defaultSource ? '选择默认模型' : '请先选择默认源'}
          value={defaultModel}
          options={defaultSourceModels.map((m) => ({
            value: m.id,
            label: m.custom ? `${m.displayName}（自定义）` : m.displayName,
          }))}
          onChange={handleDefaultModelChange}
        />
      </div>
    </div>
  );

  const modelsTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
      <div>
        <div style={labelStyle}>源</div>
        <Select
          style={{ width: 280 }}
          size='small'
          value={viewSourceId || undefined}
          options={sourceOptions}
          onChange={(v) => setViewSourceId(v)}
        />
      </div>
      <div>
        <div style={labelStyle}>模型列表</div>
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            maxHeight: 260,
            overflow: 'auto',
          }}>
          {viewModels.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderBottom: '1px solid var(--border)',
                fontSize: 12,
              }}>
              <span style={{ color: 'var(--text)' }}>{m.displayName}</span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{m.id}</span>
              {m.costLabel && (
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{m.costLabel}</span>
              )}
              {m.contextWindow > 0 && (
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                  {Math.round(m.contextWindow / 1000)}k ctx
                </span>
              )}
              {m.custom && (
                <>
                  <Tag color='blue' style={{ marginLeft: m.contextWindow > 0 ? 8 : 'auto' }}>
                    自定义
                  </Tag>
                  <Button
                    type='text'
                    size='small'
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemoveCustomModel(m.id)}
                  />
                </>
              )}
            </div>
          ))}
          {viewModels.length === 0 && (
            <div
              style={{
                padding: 16,
                fontSize: 12,
                color: 'var(--text-secondary)',
                textAlign: 'center',
              }}>
              该源暂无模型
            </div>
          )}
        </div>
      </div>
      {supportsCustom ? (
        <div>
          <div style={labelStyle}>添加自定义模型</div>
          <div style={hintStyle}>
            该源 modelPolicy 为 {viewSource?.modelPolicy}，支持使用列表之外的模型 ID
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              size='small'
              style={{ width: 220 }}
              placeholder='模型 ID，如 claude-opus-4'
              value={newModelId}
              onChange={(e) => setNewModelId(e.target.value)}
              onPressEnter={handleAddCustomModel}
            />
            <Button
              size='small'
              type='primary'
              icon={<PlusOutlined />}
              disabled={!newModelId.trim()}
              onClick={handleAddCustomModel}>
              添加
            </Button>
          </div>
        </div>
      ) : (
        viewSource && <div style={hintStyle}>该源 modelPolicy 为 catalog，仅支持列表内模型</div>
      )}
    </div>
  );

  return (
    <Modal
      title='Agent 设置'
      open={snap.settingsOpen}
      onCancel={() => {
        agentStore.settingsOpen = false;
      }}
      footer={null}
      width={520}
      // 高于 antd Dropdown 默认弹层（1050），避免源/模型菜单盖住设置弹窗
      zIndex={1100}>
      <Tabs
        size='small'
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'general', label: '通用', children: generalTab },
          { key: 'models', label: '模型', children: modelsTab },
        ]}
      />
    </Modal>
  );
}
