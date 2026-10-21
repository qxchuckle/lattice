import { useState } from 'react';
import { Button, Card, Space, Tabs } from 'antd';
import { CopyOutlined, FileTextOutlined } from '@ant-design/icons';
import { i18nT } from '@lattice-web-ui';
import { useConfig } from '../context';
import { bridgeAction } from '../../host';

function JsonBlock({ value }: { value: Record<string, unknown> }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <Space direction='vertical' size={8} style={{ width: '100%' }}>
      <Space>
        <Button
          size='small'
          icon={<CopyOutlined />}
          onClick={() => bridgeAction('copyText', { text })}>
          {i18nT('复制 JSON', 'Copy JSON')}
        </Button>
      </Space>
      <pre
        style={{
          margin: 0,
          maxHeight: 520,
          overflow: 'auto',
          fontSize: 12,
          padding: 12,
          background: 'var(--bg-secondary)',
          borderRadius: 6,
        }}>
        {text}
      </pre>
    </Space>
  );
}

export function AdvancedSection() {
  const { state, openConfigFile } = useConfig();
  const [scope, setScope] = useState<'global' | 'local'>('global');
  return (
    <Space direction='vertical' size={16} style={{ width: '100%' }}>
      <Card
        size='small'
        extra={
          <Button
            size='small'
            icon={<FileTextOutlined />}
            onClick={() => void openConfigFile(scope)}>
            {i18nT('打开当前文件', 'Open current file')}
          </Button>
        }>
        <Tabs
          activeKey={scope}
          onChange={(key) => setScope(key as 'global' | 'local')}
          items={[
            {
              key: 'global',
              label: i18nT('全局 config.json', 'Global config.json'),
              children: <JsonBlock value={state.core.global} />,
            },
            {
              key: 'local',
              label: i18nT('本机 config-local.json', 'Local config-local.json'),
              children: <JsonBlock value={state.core.local} />,
            },
          ]}
        />
      </Card>
    </Space>
  );
}
