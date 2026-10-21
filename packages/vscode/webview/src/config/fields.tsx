import type { ReactNode } from 'react';
import {
  AutoComplete,
  Button,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { FolderOpenOutlined, ReloadOutlined } from '@ant-design/icons';
import { i18nT } from '@lattice-web-ui';
import type { ConfigFieldSchema } from '../../../shared/config-schema';
import { EMBEDDING_MODEL_OPTIONS } from '../../../shared/config-schema';

export function fieldLabel(field: ConfigFieldSchema): string {
  return i18nT(field.label.zh, field.label.en);
}

export function fieldDescription(field: ConfigFieldSchema): string {
  return i18nT(field.description.zh, field.description.en);
}

export function groupLabel(field: ConfigFieldSchema): string {
  return i18nT(field.groupLabel.zh, field.groupLabel.en);
}

function optionsOf(field: ConfigFieldSchema): Array<{ value: string; label: string }> {
  const options = field.type === 'model' ? EMBEDDING_MODEL_OPTIONS : (field.options ?? []);
  return options.map((option) => ({
    value: option.value,
    label: i18nT(option.label.zh, option.label.en),
  }));
}

export interface FieldProps {
  field: ConfigFieldSchema;
  value: unknown;
  defaultValue: unknown;
  source?: 'user' | 'workspace' | 'workspaceFolder' | 'default';
  modified?: boolean;
  canReset?: boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
  onBrowse?: () => void;
}

function sourceText(source: FieldProps['source']): string | undefined {
  switch (source) {
    case 'user':
      return i18nT('用户设置', 'User');
    case 'workspace':
      return i18nT('工作区', 'Workspace');
    case 'workspaceFolder':
      return i18nT('工作区文件夹', 'Workspace folder');
    default:
      return undefined;
  }
}

export function ConfigField({
  field,
  value,
  defaultValue,
  source,
  modified,
  canReset = true,
  onChange,
  onReset,
  onBrowse,
}: FieldProps) {
  const label = fieldLabel(field);
  const description = fieldDescription(field);
  const reset = canReset ? (
    <Tooltip title={i18nT('重置为默认值', 'Reset to default')}>
      <Button
        size='small'
        type='text'
        icon={<ReloadOutlined />}
        aria-label={`${i18nT('重置', 'Reset')} ${label}`}
        onClick={onReset}
      />
    </Tooltip>
  ) : null;

  let control: ReactNode;
  switch (field.type) {
    case 'boolean':
      control = <Switch checked={value === true} onChange={(checked) => onChange(checked)} />;
      break;
    case 'number':
      control = (
        <InputNumber
          value={typeof value === 'number' ? value : undefined}
          min={field.min}
          max={field.max}
          style={{ width: 220 }}
          placeholder={field.placeholder}
          onChange={(next) => onChange(next)}
        />
      );
      break;
    case 'select':
      control = (
        <Select
          value={typeof value === 'string' ? value : undefined}
          options={optionsOf(field)}
          style={{ width: '100%' }}
          onChange={(next) => onChange(next)}
        />
      );
      break;
    case 'multiselect':
      control = (
        <Select
          mode='multiple'
          value={Array.isArray(value) ? (value as string[]) : []}
          options={optionsOf(field)}
          style={{ width: '100%' }}
          onChange={(next) => onChange(next)}
        />
      );
      break;
    case 'stringArray':
      control = (
        <Select
          mode='tags'
          value={Array.isArray(value) ? (value as string[]) : []}
          tokenSeparators={[',', '\n']}
          style={{ width: '100%' }}
          placeholder={field.placeholder ?? i18nT('输入后回车', 'Type and press Enter')}
          onChange={(next) => onChange(next)}
        />
      );
      break;
    case 'pathArray':
      control = (
        <Space.Compact style={{ width: '100%' }}>
          <Select
            mode='tags'
            value={Array.isArray(value) ? (value as string[]) : []}
            tokenSeparators={[',', '\n']}
            style={{ width: '100%' }}
            placeholder={i18nT('输入路径后回车，或点击选择目录', 'Type paths or pick directories')}
            onChange={(next) => onChange(next)}
          />
          {onBrowse && (
            <Button icon={<FolderOpenOutlined />} onClick={onBrowse}>
              {i18nT('选择', 'Pick')}
            </Button>
          )}
        </Space.Compact>
      );
      break;
    case 'path':
      control = (
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          {onBrowse && (
            <Button icon={<FolderOpenOutlined />} onClick={onBrowse}>
              {i18nT('选择', 'Pick')}
            </Button>
          )}
        </Space.Compact>
      );
      break;
    case 'model':
      control = (
        <AutoComplete
          value={typeof value === 'string' ? value : ''}
          options={optionsOf(field)}
          style={{ width: '100%' }}
          placeholder={field.placeholder ?? 'Xenova/bge-small-zh-v1.5'}
          onChange={(next) => onChange(next)}
        />
      );
      break;
    default:
      control = (
        <Input
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }

  const sourceLabel = sourceText(source);
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        padding: '10px 0',
        borderBottom: '1px solid var(--border)',
        alignItems: 'flex-start',
      }}>
      <div style={{ flex: '0 0 38%', minWidth: 180 }}>
        <Space size={6} wrap>
          <Typography.Text strong>{label}</Typography.Text>
          {modified && <Tag color='blue'>{i18nT('已修改', 'Modified')}</Tag>}
          {field.risk === 'high' && <Tag color='orange'>{i18nT('高风险', 'High risk')}</Tag>}
          {sourceLabel && <Tag>{sourceLabel}</Tag>}
        </Space>
        <div style={{ marginTop: 3 }}>
          <Typography.Text type='secondary' style={{ fontSize: 12 }}>
            {description}
          </Typography.Text>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%' }}>
          <div style={{ flex: 1, minWidth: 0 }}>{control}</div>
          <div style={{ flex: '0 0 auto' }}>{reset}</div>
        </div>
        {modified && (
          <Typography.Text type='secondary' style={{ fontSize: 11 }}>
            {i18nT('默认：', 'Default: ')}
            {formatValue(defaultValue)}
          </Typography.Text>
        )}
      </div>
    </div>
  );
}

export function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? i18nT('开', 'On') : i18nT('关', 'Off');
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
