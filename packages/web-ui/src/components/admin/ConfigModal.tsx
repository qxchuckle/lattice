import { memo, useState, useCallback, useEffect, useRef } from 'react';
import {
  Modal,
  Tabs,
  Switch,
  Alert,
  AutoComplete,
  Button,
  Input,
  InputNumber,
  Select,
  App,
  Spin,
  Collapse,
  Tag,
} from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';
import { WebPasswordSection } from './WebPasswordSection';
import {
  EMBEDDING_MODEL_PRESETS,
  applyEmbeddingPresetToValues,
  getEmbeddingModelPreset,
} from './embedding-presets';

type ConfigScope = 'global' | 'local';

interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'autocomplete' | 'stringArray';
  options?: { label: string; value: string }[];
  placeholder?: string;
  warning?: string;
}

interface CustomModelDraft {
  modelId: string;
  previousModelId: string;
  dimension: number | null;
  queryPrefix: string;
  documentPrefix: string;
}

const EMBEDDING_PRESET_FIELD_KEYS = new Set([
  'rag.embedding.modelId',
  'rag.embedding.dimension',
  'rag.embedding.dtype',
  'rag.embedding.pooling',
  'rag.embedding.queryPrefix',
  'rag.embedding.documentPrefix',
]);

const GLOBAL_FIELDS: ConfigField[] = [
  {
    key: 'registryTemplates',
    label: '模板仓库',
    type: 'stringArray',
    placeholder: 'https://github.com/...',
  },
];

const EMBEDDING_FIELDS: ConfigField[] = [
  {
    key: 'rag.embedding.modelId',
    label: '模型 ID',
    type: 'autocomplete',
    options: EMBEDDING_MODEL_PRESETS.map((preset) => ({
      label: `${preset.label} · ${preset.dimension} 维`,
      value: preset.id,
    })),
    placeholder: '默认：Xenova/bge-small-zh-v1.5',
    warning:
      '切换内置模型会自动同步维度、精度、池化和前缀；自定义模型需手动确认这些参数，保存后需 rebuild 索引',
  },
  {
    key: 'rag.embedding.dimension',
    label: '向量维度',
    type: 'number',
    warning: '维度与模型不匹配会导致向量搜索失败',
  },
  {
    key: 'rag.embedding.dtype',
    label: '模型精度',
    type: 'select',
    options: [
      { label: 'q8 (推荐, CPU 最快)', value: 'q8' },
      { label: 'fp32', value: 'fp32' },
      { label: 'fp16', value: 'fp16' },
      { label: 'int8', value: 'int8' },
    ],
  },
  {
    key: 'rag.embedding.pooling',
    label: '池化策略',
    type: 'select',
    options: [
      { label: 'mean (推荐)', value: 'mean' },
      { label: 'cls', value: 'cls' },
    ],
  },
  {
    key: 'rag.embedding.remoteHost',
    label: '模型下载源',
    type: 'string',
    placeholder: 'https://huggingface.co/',
  },
  {
    key: 'rag.embedding.proxy',
    label: '下载代理',
    type: 'string',
    placeholder: 'http://127.0.0.1:7890',
  },
  {
    key: 'rag.embedding.distanceThreshold',
    label: '语义距离阈值',
    type: 'number',
  },
  {
    key: 'rag.embedding.queryPrefix',
    label: '查询前缀',
    type: 'string',
  },
  {
    key: 'rag.embedding.documentPrefix',
    label: '文档前缀',
    type: 'string',
  },
  {
    key: 'rag.embedding.batchSize',
    label: '批量大小',
    type: 'number',
  },
  {
    key: 'rag.embedding.minChunkSize',
    label: '最小分片大小',
    type: 'number',
  },
];

const LOCAL_FIELDS: ConfigField[] = [
  {
    key: 'username',
    label: '用户名',
    type: 'string',
    warning: '切换用户将改变所有数据视图',
  },
  {
    key: 'scanDirs',
    label: '扫描目录',
    type: 'stringArray',
    placeholder: '/Users/xxx/projects',
    warning: '不存在的目录将被跳过',
  },
  {
    key: 'gitEnabled',
    label: 'Git 管理',
    type: 'boolean',
  },
  {
    key: 'gitRemote',
    label: 'Git 远程仓库',
    type: 'string',
    placeholder: 'https://github.com/...',
  },
  {
    key: 'registryTemplates',
    label: '模板仓库 (本机覆盖)',
    type: 'stringArray',
    placeholder: 'https://github.com/...',
  },
];

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

export const ConfigModal = memo(function ConfigModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<ConfigScope>('global');
  const [diffMode, setDiffMode] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customModelDraft, setCustomModelDraft] = useState<CustomModelDraft | null>(null);
  const confirmedModelIdRef = useRef('');

  const { data: config, isLoading } = useQuery({
    queryKey: ['config', scope, diffMode, open],
    queryFn: () => getAdapter().getConfig(scope, diffMode),
    enabled: open,
  });

  const { data: ragStatus } = useQuery({
    queryKey: ['rag-status'],
    queryFn: () => getAdapter().getRagStatus(),
    enabled: open && scope === 'global',
    staleTime: 15_000,
  });

  useEffect(() => {
    if (config) {
      setValues(structuredClone(config) as Record<string, unknown>);
      const modelId = getByPath(config, 'rag.embedding.modelId');
      confirmedModelIdRef.current = typeof modelId === 'string' ? modelId.trim() : '';
      setDirty(false);
    } else {
      setValues({});
      confirmedModelIdRef.current = '';
      setDirty(false);
    }
    setCustomModelDraft(null);
  }, [config]);

  const fields = scope === 'global' ? [...GLOBAL_FIELDS, ...EMBEDDING_FIELDS] : LOCAL_FIELDS;
  const selectedModelId = getByPath(values, 'rag.embedding.modelId');
  const selectedPreset =
    typeof selectedModelId === 'string' ? getEmbeddingModelPreset(selectedModelId) : undefined;
  const selectedDimension = getByPath(values, 'rag.embedding.dimension');
  const hasValidDimension =
    typeof selectedDimension === 'number' &&
    Number.isFinite(selectedDimension) &&
    selectedDimension > 0;
  const presetDimensionMismatch =
    !!selectedPreset && hasValidDimension && selectedDimension !== selectedPreset.dimension;
  const selectedModelIdTrimmed = typeof selectedModelId === 'string' ? selectedModelId.trim() : '';
  const selectedModelChangedToIndex =
    scope === 'global' &&
    !!ragStatus &&
    selectedModelIdTrimmed.length > 0 &&
    selectedModelIdTrimmed !== ragStatus.modelId;
  const embeddingAlert =
    scope !== 'global' || !ragStatus
      ? null
      : selectedModelChangedToIndex
        ? {
            type: 'warning' as const,
            message: `模型将切换为 ${selectedModelIdTrimmed}：保存后需运行 ltc rag rebuild 重建索引；若模型未安装，rebuild 会自动下载。`,
          }
        : ragStatus.modelChanged
          ? {
              type: 'warning' as const,
              message: `当前模型 ${ragStatus.modelId} 与上次索引模型 ${ragStatus.lastModelId ?? '未知'} 不一致，请运行 ltc rag rebuild 重建索引。`,
            }
          : !ragStatus.modelInstalled
            ? {
                type: 'info' as const,
                message: `当前模型 ${ragStatus.modelId} 尚未安装；运行 ltc rag rebuild 会自动下载并重建索引。`,
              }
            : null;

  const handleFieldChange = useCallback((key: string, value: unknown) => {
    if (key === 'rag.embedding.modelId' && typeof value === 'string') {
      if (getEmbeddingModelPreset(value)) {
        confirmedModelIdRef.current = value.trim();
        setCustomModelDraft(null);
      }
    }

    setValues((prev) => {
      const next = structuredClone(prev) as Record<string, unknown>;
      setByPath(next, key, value);
      if (key === 'rag.embedding.modelId' && typeof value === 'string') {
        applyEmbeddingPresetToValues(next, value);
      }
      return next;
    });
    setDirty(true);
  }, []);

  const openCustomModelDraft = useCallback(
    (modelId: string) => {
      const normalized = modelId.trim();
      if (
        !normalized ||
        getEmbeddingModelPreset(normalized) ||
        normalized === confirmedModelIdRef.current
      ) {
        return false;
      }

      const storedModelId = config ? getByPath(config, 'rag.embedding.modelId') : undefined;
      const previousModelId =
        confirmedModelIdRef.current ||
        (typeof storedModelId === 'string' ? storedModelId.trim() : '');
      const dimension = getByPath(values, 'rag.embedding.dimension');

      setCustomModelDraft({
        modelId: normalized,
        previousModelId,
        dimension: typeof dimension === 'number' ? dimension : 512,
        queryPrefix: '',
        documentPrefix: '',
      });
      return true;
    },
    [config, values],
  );

  const handleModelBlur = useCallback(() => {
    const modelId = getByPath(values, 'rag.embedding.modelId');
    if (typeof modelId === 'string') {
      openCustomModelDraft(modelId);
    }
  }, [values, openCustomModelDraft]);

  const cancelCustomModel = useCallback(() => {
    if (customModelDraft) {
      setValues((prev) => {
        const next = structuredClone(prev) as Record<string, unknown>;
        setByPath(next, 'rag.embedding.modelId', customModelDraft.previousModelId);
        return next;
      });
    }
    setCustomModelDraft(null);
  }, [customModelDraft]);

  const confirmCustomModel = useCallback(() => {
    if (!customModelDraft) return;
    if (!customModelDraft.dimension || customModelDraft.dimension <= 0) {
      message.warning('请输入有效的向量维度');
      return;
    }

    setValues((prev) => {
      const next = structuredClone(prev) as Record<string, unknown>;
      setByPath(next, 'rag.embedding.modelId', customModelDraft.modelId);
      setByPath(next, 'rag.embedding.dimension', customModelDraft.dimension);
      setByPath(next, 'rag.embedding.queryPrefix', customModelDraft.queryPrefix);
      setByPath(next, 'rag.embedding.documentPrefix', customModelDraft.documentPrefix);
      return next;
    });
    confirmedModelIdRef.current = customModelDraft.modelId;
    setDirty(true);
    setCustomModelDraft(null);
    message.success('自定义模型参数已应用；保存后请运行 ltc rag rebuild');
  }, [customModelDraft, message]);

  const handleClose = useCallback(() => {
    if (!dirty) {
      setCustomModelDraft(null);
      onClose();
      return;
    }
    modal.confirm({
      title: '放弃未保存的修改？',
      content: '关闭后当前修改将丢失。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: () => {
        setCustomModelDraft(null);
        onClose();
      },
    });
  }, [dirty, modal, onClose]);
  const confirmDiscardChanges = useCallback(
    (title: string, onConfirm: () => void) => {
      if (!dirty) {
        onConfirm();
        return;
      }
      modal.confirm({
        title,
        content: '当前修改尚未保存，切换后将丢失，确定继续吗？',
        okText: '继续',
        cancelText: '取消',
        onOk: onConfirm,
      });
    },
    [dirty, modal],
  );

  const handleScopeChange = useCallback(
    (nextScope: ConfigScope) => {
      if (nextScope === scope) return;
      confirmDiscardChanges('切换配置范围', () => setScope(nextScope));
    },
    [confirmDiscardChanges, scope],
  );

  const handleDiffModeChange = useCallback(
    (nextDiffMode: boolean) => {
      confirmDiscardChanges('切换显示模式', () => setDiffMode(nextDiffMode));
    },
    [confirmDiscardChanges],
  );

  const handleSave = useCallback(async () => {
    const modelIdValue = getByPath(values, 'rag.embedding.modelId');
    if (scope === 'global' && typeof modelIdValue === 'string') {
      if (!modelIdValue.trim()) {
        message.warning('模型 ID 不能为空');
        return;
      }
      if (openCustomModelDraft(modelIdValue)) {
        return;
      }
    }

    const fallbackModelId = config ? getByPath(config, 'rag.embedding.modelId') : undefined;
    const previousEffectiveModelId =
      ragStatus?.modelId ?? (typeof fallbackModelId === 'string' ? fallbackModelId.trim() : '');
    const nextModelId = typeof modelIdValue === 'string' ? modelIdValue.trim() : '';
    const modelChangedAfterSave =
      scope === 'global' &&
      !!nextModelId &&
      !!previousEffectiveModelId &&
      nextModelId !== previousEffectiveModelId;
    const embeddingParamsChanged =
      scope === 'global' &&
      ['dimension', 'dtype', 'pooling', 'queryPrefix', 'documentPrefix', 'minChunkSize'].some(
        (field) => {
          const key = `rag.embedding.${field}`;
          const before = config ? getByPath(config, key) : undefined;
          const after = getByPath(values, key);
          return JSON.stringify(before) !== JSON.stringify(after);
        },
      );

    setSaving(true);
    try {
      // 检查关键项修改
      const warnings: string[] = [];
      for (const field of fields) {
        if (field.warning) {
          const originalValue = config ? getByPath(config, field.key) : undefined;
          const newValue = getByPath(values, field.key);
          if (JSON.stringify(originalValue) !== JSON.stringify(newValue)) {
            warnings.push(`${field.label}: ${field.warning}`);
          }
        }
      }

      const doSave = async () => {
        setSaving(true);
        try {
          for (const field of fields) {
            const value = getByPath(values, field.key);
            if (value === undefined) continue;
            // 只写入用户实际修改过的字段，避免把接口返回的生效默认值固化进配置文件
            const originalValue = config ? getByPath(config, field.key) : undefined;
            const unchanged = JSON.stringify(originalValue) === JSON.stringify(value);
            // 切换模型时后端会自动同步预设字段；这里强制把表单值全部写回，
            // 避免用户手动改回旧值（如维度）后被后端预设覆盖。
            if (
              unchanged &&
              !(modelChangedAfterSave && EMBEDDING_PRESET_FIELD_KEYS.has(field.key))
            ) {
              continue;
            }
            const ok = await getAdapter().setConfig(field.key, value, scope);
            if (!ok) throw new Error(`保存 ${field.label} 失败`);
          }
          setDirty(false);
          queryClient.invalidateQueries({ queryKey: ['config'] });
          queryClient.invalidateQueries({ queryKey: ['rag-status'] });
          queryClient.invalidateQueries({ queryKey: ['model-status'] });
          if (modelChangedAfterSave) {
            let installed: boolean | null = null;
            try {
              installed = (await getAdapter().getRagStatus()).modelInstalled;
            } catch {
              installed = null;
            }
            message.warning(
              `模型已切换为 ${nextModelId}；${
                installed === true
                  ? '模型已安装'
                  : installed === false
                    ? '模型尚未安装，rebuild 时会自动下载'
                    : '请确认模型安装状态'
              }。请运行 ltc rag rebuild 重建索引。`,
              8,
            );
          } else if (embeddingParamsChanged) {
            message.warning(
              '配置已保存；embedding 参数已变更，请运行 ltc rag rebuild 重建索引。',
              8,
            );
          } else {
            message.success('配置已保存');
          }
          onClose();
        } catch (err) {
          message.error(`保存失败: ${(err as Error).message}`);
        } finally {
          setSaving(false);
        }
      };

      if (warnings.length > 0) {
        modal.confirm({
          title: '关键配置修改确认',
          content: (
            <div>
              {warnings.map((w, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          ),
          onOk: doSave,
        });
        setSaving(false); // 确认弹窗期间不保持 loading
      } else {
        await doSave();
      }
    } catch (err) {
      message.error(`保存失败: ${(err as Error).message}`);
      setSaving(false);
    }
  }, [
    values,
    fields,
    config,
    scope,
    ragStatus,
    message,
    modal,
    queryClient,
    onClose,
    openCustomModelDraft,
  ]);

  const renderField = (field: ConfigField) => {
    const value = config ? getByPath(config, field.key) : undefined;
    const editValue = getByPath(values, field.key);

    const isModified =
      diffMode && config ? JSON.stringify(value) !== JSON.stringify(editValue) : false;

    // Use current config value as placeholder when field is empty
    const placeholder =
      field.placeholder ?? (value !== undefined && value !== '' ? String(value) : undefined);

    return (
      <div key={field.key} style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{field.label}</span>
          {isModified && <Tag color='blue'>已修改</Tag>}
          {diffMode && value !== undefined && !isModified && (
            <Tag style={{ fontSize: 10 }}>默认</Tag>
          )}
        </div>
        {field.type === 'boolean' ? (
          <Switch
            checked={!!editValue}
            onChange={(v) => handleFieldChange(field.key, v)}
            size='small'
          />
        ) : field.type === 'number' ? (
          <InputNumber
            value={editValue as number}
            onChange={(v) => handleFieldChange(field.key, v)}
            style={{ width: '100%' }}
            size='small'
            placeholder={placeholder}
          />
        ) : field.type === 'select' ? (
          <Select
            value={editValue as string}
            onChange={(v) => handleFieldChange(field.key, v)}
            options={field.options}
            placeholder={field.placeholder}
            optionFilterProp='label'
            style={{ width: '100%' }}
            size='small'
            showSearch
          />
        ) : field.type === 'autocomplete' ? (
          <AutoComplete
            value={editValue as string}
            onChange={(v) => handleFieldChange(field.key, v)}
            onBlur={handleModelBlur}
            options={field.options}
            placeholder={field.placeholder}
            filterOption={(input, option) =>
              String(option?.label ?? '')
                .toLowerCase()
                .includes(input.toLowerCase())
            }
            style={{ width: '100%' }}
            size='small'
          />
        ) : field.type === 'stringArray' ? (
          <Input.TextArea
            value={Array.isArray(editValue) ? (editValue as string[]).join('\n') : ''}
            onChange={(e) =>
              handleFieldChange(field.key, e.target.value.split('\n').filter(Boolean))
            }
            rows={3}
            size='small'
            placeholder={placeholder ?? '每行一个'}
          />
        ) : (
          <Input
            value={editValue as string}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            size='small'
            placeholder={placeholder}
          />
        )}
        {field.key === 'rag.embedding.dimension' &&
          typeof selectedModelId === 'string' &&
          selectedModelId.trim().length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11, color: '#d46b08' }}>
              {!hasValidDimension
                ? '请填写有效的向量维度'
                : presetDimensionMismatch && selectedPreset
                  ? `该模型预设维度为 ${selectedPreset.dimension}，当前为 ${selectedDimension}；保存后可能无法搜索。`
                  : !selectedPreset
                    ? '自定义模型：请确认该维度与模型实际输出一致。'
                    : null}
            </div>
          )}
        {field.warning && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
            ⚠ {field.warning}
          </div>
        )}
      </div>
    );
  };

  const globalGroups = [
    { key: 'general', label: '通用', fields: GLOBAL_FIELDS },
    { key: 'embedding', label: 'RAG - 模型配置', fields: EMBEDDING_FIELDS.slice(0, 4) },
    { key: 'download', label: 'RAG - 下载配置', fields: EMBEDDING_FIELDS.slice(4, 7) },
    { key: 'retrieval', label: 'RAG - 检索参数', fields: EMBEDDING_FIELDS.slice(7) },
  ];

  return (
    <>
      <Modal
        title='配置编辑'
        open={open}
        onCancel={handleClose}
        width={640}
        styles={{ body: { maxHeight: 'calc(80vh - 100px)', overflowY: 'auto' } }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 12, marginRight: 12 }}>仅显示差异</span>
              <Switch checked={diffMode} onChange={handleDiffModeChange} size='small' />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={handleClose}>取消</Button>
              <Button type='primary' loading={saving} onClick={handleSave} disabled={!dirty}>
                保存
              </Button>
            </div>
          </div>
        }>
        <Tabs
          activeKey={scope}
          onChange={(k) => handleScopeChange(k as ConfigScope)}
          size='small'
          items={[
            { key: 'global', label: '全局配置' },
            { key: 'local', label: '本机配置' },
          ]}
          style={{ marginBottom: 12 }}
        />
        {embeddingAlert && (
          <Alert
            type={embeddingAlert.type}
            showIcon
            style={{ marginBottom: 12 }}
            message={embeddingAlert.message}
          />
        )}
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : scope === 'global' ? (
          <Collapse
            size='small'
            defaultActiveKey={globalGroups.map((g) => g.key)}
            items={globalGroups.map((group) => ({
              key: group.key,
              label: group.label,
              children: <div>{group.fields.map(renderField)}</div>,
            }))}
          />
        ) : (
          <div>
            {LOCAL_FIELDS.map(renderField)}
            <WebPasswordSection />
          </div>
        )}
      </Modal>
      <Modal
        title='配置自定义模型'
        open={open && customModelDraft !== null}
        onCancel={cancelCustomModel}
        onOk={confirmCustomModel}
        okText='应用参数'
        cancelText='取消'
        width={520}
        okButtonProps={{
          disabled: !customModelDraft?.dimension || customModelDraft.dimension <= 0,
        }}>
        <div style={{ marginBottom: 12 }}>
          未识别模型 <code>{customModelDraft?.modelId}</code>
          。请确认向量维度与查询/文档前缀；保存后仍需运行 <code>ltc rag rebuild</code>。
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>向量维度</div>
          <InputNumber
            min={1}
            precision={0}
            value={customModelDraft?.dimension ?? undefined}
            onChange={(v) =>
              setCustomModelDraft((prev) =>
                prev ? { ...prev, dimension: typeof v === 'number' ? v : null } : prev,
              )
            }
            style={{ width: '100%' }}
            placeholder='例如 384 / 512 / 768'
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>查询前缀</div>
          <Input
            value={customModelDraft?.queryPrefix ?? ''}
            onChange={(e) =>
              setCustomModelDraft((prev) =>
                prev ? { ...prev, queryPrefix: e.target.value } : prev,
              )
            }
            placeholder='例如 E5 使用 query: '
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>文档前缀</div>
          <Input
            value={customModelDraft?.documentPrefix ?? ''}
            onChange={(e) =>
              setCustomModelDraft((prev) =>
                prev ? { ...prev, documentPrefix: e.target.value } : prev,
              )
            }
            placeholder='例如 E5 使用 passage: '
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          精度和池化沿用当前配置；不确定时可先保持默认 q8 / mean。
        </div>
      </Modal>
    </>
  );
});
