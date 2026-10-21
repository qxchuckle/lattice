import { useState } from 'react';
import { Button, Card, Radio, Space, Switch, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { i18nT } from '@lattice-web-ui';
import { ConfigField, groupLabel } from '../fields';
import { useConfig } from '../context';
import { sameConfigValue } from '../paths';
import { VSCODE_FIELDS } from '../../../../shared/config-schema';

export function SettingsSection() {
  const {
    state,
    draft,
    search,
    settingsTarget,
    setSettingsTarget,
    setField,
    resetField,
    clearField,
    pickDirectories,
    openSettings,
  } = useConfig();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const normalized = search.trim().toLowerCase();
  const fields = VSCODE_FIELDS.filter((field) => {
    if (field.advanced && !showAdvanced) return false;
    if (!normalized) return true;
    return [field.key, field.label.zh, field.label.en, field.description.zh, field.description.en]
      .join(' ')
      .toLowerCase()
      .includes(normalized);
  });

  const groups = new Map<string, typeof fields>();
  for (const field of fields) {
    const list = groups.get(field.group) ?? [];
    list.push(field);
    groups.set(field.group, list);
  }

  return (
    <Space direction='vertical' size={16} style={{ width: '100%' }}>
      <Card size='small'>
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space wrap>
            <Typography.Text strong>{i18nT('写入范围', 'Write scope')}</Typography.Text>
            <Radio.Group
              value={settingsTarget}
              onChange={(event) => setSettingsTarget(event.target.value)}
              optionType='button'
              buttonStyle='solid'
              options={[
                {
                  label: i18nT('工作区设置', 'Workspace'),
                  value: 'workspace',
                  disabled: state.workspace.length === 0,
                },
                { label: i18nT('用户设置', 'User'), value: 'user' },
              ]}
            />
          </Space>
          <Space>
            <Space size={6}>
              <Typography.Text type='secondary'>{i18nT('高级字段', 'Advanced')}</Typography.Text>
              <Switch size='small' checked={showAdvanced} onChange={setShowAdvanced} />
            </Space>
            <Button size='small' icon={<SettingOutlined />} onClick={() => void openSettings()}>
              {i18nT('原生设置页', 'Native settings')}
            </Button>
          </Space>
        </Space>
      </Card>

      {groups.size === 0 && (
        <Card>
          <Typography.Text type='secondary'>
            {i18nT('没有匹配的设置项。', 'No matching settings.')}
          </Typography.Text>
        </Card>
      )}

      {[...groups.entries()].map(([group, list]) => (
        <Card key={group} size='small' title={groupLabel(list[0])}>
          {list.map((field) => {
            const currentValue = state.settings.values[field.key] as unknown;
            const stored = state.settings.sources[field.key] !== 'default';
            const modified =
              (field.key in draft.vscode &&
                !sameConfigValue(draft.vscode[field.key], currentValue)) ||
              (draft.unsetVscode.includes(field.key) && stored);
            const value = field.key in draft.vscode ? draft.vscode[field.key] : currentValue;
            return (
              <ConfigField
                key={field.key}
                field={field}
                value={value}
                defaultValue={state.settings.defaults[field.key]}
                source={state.settings.sources[field.key]}
                modified={modified}
                canReset={stored || modified}
                onChange={(next) => setField('vscode', field.key, next)}
                onReset={() => {
                  if (stored) resetField('vscode', field.key);
                  else if (field.key in draft.vscode) {
                    clearField('vscode', field.key);
                  }
                }}
                {...(field.type === 'path'
                  ? {
                      onBrowse: () => {
                        void pickDirectories().then((paths) => {
                          if (paths[0]) setField('vscode', field.key, paths[0]);
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
