import { useState } from 'react';
import { Button, Card, Space, Switch, Tabs, Typography } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { i18nT } from '@lattice-web-ui';
import { ConfigField, groupLabel } from '../fields';
import { useConfig } from '../context';
import {
  CORE_GLOBAL_FIELDS,
  CORE_LOCAL_FIELDS,
  type ConfigFieldSchema,
} from '../../../../shared/config-schema';
import { readPath, sameConfigValue } from '../paths';

function CoreFields({
  fields,
  store,
  defaults,
  values,
  storedValues = values,
}: {
  fields: readonly ConfigFieldSchema[];
  store: 'global' | 'local';
  defaults: Record<string, unknown>;
  /** Values shown in the form (effective values, including inheritance). */
  values: Record<string, unknown>;
  /** Raw values persisted in the file; used to decide whether reset is meaningful. */
  storedValues?: Record<string, unknown>;
}) {
  const { draft, search, setField, resetField, clearField, pickDirectories } = useConfig();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const normalized = search.trim().toLowerCase();
  const visible = fields.filter((field) => {
    if (field.advanced && !showAdvanced) return false;
    if (!normalized) return true;
    return [field.key, field.label.zh, field.label.en, field.description.zh, field.description.en]
      .join(' ')
      .toLowerCase()
      .includes(normalized);
  });

  const groups = new Map<string, ConfigFieldSchema[]>();
  for (const field of visible) {
    const list = groups.get(field.group) ?? [];
    list.push(field);
    groups.set(field.group, list);
  }

  return (
    <Space direction='vertical' size={12} style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
        <Space size={6}>
          <Typography.Text type='secondary'>{i18nT('高级字段', 'Advanced')}</Typography.Text>
          <Switch size='small' checked={showAdvanced} onChange={setShowAdvanced} />
        </Space>
      </Space>
      {groups.size === 0 && (
        <Typography.Text type='secondary'>
          {i18nT('没有匹配的配置项。', 'No matching settings.')}
        </Typography.Text>
      )}
      {[...groups.entries()].map(([group, list]) => (
        <Card key={group} size='small' title={groupLabel(list[0])}>
          {list.map((field) => {
            const unsetKey = store === 'global' ? 'unsetGlobal' : 'unsetLocal';
            const currentValue = readPath(values, field.key);
            const storedValue = readPath(storedValues, field.key);
            const modified =
              (field.key in draft[store] &&
                !sameConfigValue(draft[store][field.key], currentValue)) ||
              (draft[unsetKey].includes(field.key) && storedValue !== undefined);
            const value = field.key in draft[store] ? draft[store][field.key] : currentValue;
            const defaultValue = readPath(defaults, field.key) ?? field.default;
            return (
              <ConfigField
                key={field.key}
                field={field}
                value={value}
                defaultValue={defaultValue}
                modified={modified}
                canReset={storedValue !== undefined || modified}
                onChange={(next) => setField(store, field.key, next)}
                onReset={() => {
                  if (storedValue !== undefined) resetField(store, field.key);
                  else if (field.key in draft[store]) {
                    clearField(store, field.key);
                  }
                }}
                {...(field.type === 'path' || field.type === 'pathArray'
                  ? {
                      onBrowse: () => {
                        void pickDirectories().then((paths) => {
                          if (paths.length > 0) {
                            setField(store, field.key, field.type === 'path' ? paths[0] : paths);
                          }
                        });
                      },
                    }
                  : {})}
              />
            );
          })}
        </Card>
      ))}
    </Space>
  );
}

export function CoreSection() {
  const { state, openConfigFile } = useConfig();
  return (
    <Space direction='vertical' size={16} style={{ width: '100%' }}>
      <Tabs
        items={[
          {
            key: 'global',
            label: i18nT('全局配置 config.json', 'Global config.json'),
            children: (
              <Space direction='vertical' size={12} style={{ width: '100%' }}>
                <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Typography.Text
                    type='secondary'
                    copyable={{ text: state.runtime.configPaths.global }}>
                    {state.runtime.configPaths.global}
                  </Typography.Text>
                  <Button
                    size='small'
                    icon={<FileTextOutlined />}
                    onClick={() => void openConfigFile('global')}>
                    {i18nT('打开文件', 'Open file')}
                  </Button>
                </Space>
                <Typography.Text type='secondary' style={{ fontSize: 12 }}>
                  {i18nT(
                    '表单显示实际生效值；本机配置可覆盖全局。',
                    'The form shows effective values; local config can override global settings.',
                  )}
                </Typography.Text>
                <CoreFields
                  fields={CORE_GLOBAL_FIELDS}
                  store='global'
                  defaults={state.core.globalDefaults}
                  values={state.core.globalEffective ?? state.core.global}
                  storedValues={state.core.global}
                />
              </Space>
            ),
          },
          {
            key: 'local',
            label: i18nT('本机配置 config-local.json', 'Local config-local.json'),
            children: (
              <Space direction='vertical' size={12} style={{ width: '100%' }}>
                <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Typography.Text
                    type='secondary'
                    copyable={{ text: state.runtime.configPaths.local }}>
                    {state.runtime.configPaths.local}
                  </Typography.Text>
                  <Button
                    size='small'
                    icon={<FileTextOutlined />}
                    onClick={() => void openConfigFile('local')}>
                    {i18nT('打开文件', 'Open file')}
                  </Button>
                </Space>
                <Typography.Text type='secondary'>
                  {i18nT(
                    '用户名在「用户与同步」切换；Web 密码在 Web 工作台管理。',
                    'Switch users in Users & Sync; manage the web password in the Web Workbench.',
                  )}
                </Typography.Text>
                <CoreFields
                  fields={CORE_LOCAL_FIELDS}
                  store='local'
                  defaults={state.core.localDefaults}
                  values={{ ...state.core.localDefaults, ...state.core.local }}
                  storedValues={state.core.local}
                />
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}
