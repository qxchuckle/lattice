import { memo, useState, useCallback, useEffect } from 'react';
import {
  Modal,
  Tabs,
  Switch,
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

type ConfigScope = 'global' | 'local';

interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'stringArray';
  options?: { label: string; value: string }[];
  placeholder?: string;
  warning?: string;
}

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
    type: 'select',
    options: [
      { label: 'Xenova/bge-small-zh-v1.5 (推荐)', value: 'Xenova/bge-small-zh-v1.5' },
      { label: 'Xenova/all-MiniLM-L6-v2', value: 'Xenova/all-MiniLM-L6-v2' },
      { label: 'Xenova/multilingual-e5-small', value: 'Xenova/multilingual-e5-small' },
      { label: 'BAAI/bge-base-zh-v1.5', value: 'BAAI/bge-base-zh-v1.5' },
    ],
    warning: '修改模型 ID 后需 rebuild 索引，向量维度可能变化',
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

  const { data: config, isLoading } = useQuery({
    queryKey: ['config', scope, diffMode, open],
    queryFn: () => getAdapter().getConfig(scope, diffMode),
    enabled: open,
  });

  useEffect(() => {
    if (config) {
      setValues(structuredClone(config) as Record<string, unknown>);
      setDirty(false);
    } else {
      setValues({});
      setDirty(false);
    }
  }, [config]);

  const fields = scope === 'global' ? [...GLOBAL_FIELDS, ...EMBEDDING_FIELDS] : LOCAL_FIELDS;

  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => {
      const next = structuredClone(prev) as Record<string, unknown>;
      const parts = key.split('.');
      if (parts.length === 1) {
        next[parts[0]] = value;
      } else {
        let current: Record<string, unknown> = next;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
            current[parts[i]] = {};
          }
          current = current[parts[i]] as Record<string, unknown>;
        }
        current[parts[parts.length - 1]] = value;
      }
      return next;
    });
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
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
            if (value !== undefined) {
              const ok = await getAdapter().setConfig(field.key, value, scope);
              if (!ok) throw new Error(`保存 ${field.label} 失败`);
            }
          }
          message.success('配置已保存');
          setDirty(false);
          queryClient.invalidateQueries({ queryKey: ['config'] });
          queryClient.invalidateQueries({ queryKey: ['rag-status'] });
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
  }, [values, fields, config, scope, message, modal, queryClient, onClose]);

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
            style={{ width: '100%' }}
            size='small'
            showSearch
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
    <Modal
      title='配置编辑'
      open={open}
      onCancel={onClose}
      width={640}
      styles={{ body: { maxHeight: 'calc(80vh - 100px)', overflowY: 'auto' } }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 12, marginRight: 12 }}>仅显示差异</span>
            <Switch checked={diffMode} onChange={setDiffMode} size='small' />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onClose}>取消</Button>
            <Button type='primary' loading={saving} onClick={handleSave} disabled={!dirty}>
              保存
            </Button>
          </div>
        </div>
      }>
      <Tabs
        activeKey={scope}
        onChange={(k) => setScope(k as ConfigScope)}
        size='small'
        items={[
          { key: 'global', label: '全局配置' },
          { key: 'local', label: '本机配置' },
        ]}
        style={{ marginBottom: 12 }}
      />
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
        <div>{LOCAL_FIELDS.map(renderField)}</div>
      )}
    </Modal>
  );
});
