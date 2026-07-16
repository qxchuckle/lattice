import { memo, useState } from 'react';
import { Card, Descriptions, Tag, Button, App, Space, Tooltip } from 'antd';
import { SettingOutlined, FolderOpenOutlined, CodeOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';
import { useStats } from '../../hooks';
import { ConfigModal } from './ConfigModal';

interface GlobalStatus {
  latticeRoot: string;
  username: string;
  projectCount: number;
  taskCount: number;
  activeTaskCount: number;
  dbSizeKB: number;
  gitEnabled: boolean;
  scanDirs: string[];
}

export const OverviewTab = memo(function OverviewTab() {
  const { data: stats } = useStats();
  const [configOpen, setConfigOpen] = useState(false);
  const { message } = App.useApp();

  const { data: ragStatus } = useQuery({
    queryKey: ['rag-status'],
    queryFn: () => getAdapter().getRagStatus(),
    staleTime: 30_000,
  });

  const { data: globalStatus } = useQuery({
    queryKey: ['global-status'],
    queryFn: async (): Promise<GlobalStatus | null> => {
      const res = await fetch('/api/global-status');
      if (!res.ok) return null;
      const data = await res.json();
      return data.error ? null : (data as GlobalStatus);
    },
    staleTime: 30_000,
  });

  const handleOpenRoot = async (mode: 'finder' | 'terminal') => {
    try {
      const res = await fetch('/api/open-lattice-root', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (data.success) {
        message.success(data.message ?? '已打开');
      } else {
        message.error(data.message ?? '打开失败');
      }
    } catch (err) {
      message.error(`打开失败: ${(err as Error).message}`);
    }
  };

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button size='small' icon={<SettingOutlined />} onClick={() => setConfigOpen(true)}>
          编辑配置
        </Button>
      </div>

      {globalStatus && (
        <Card size='small' title='Lattice 全局状态'>
          <Descriptions column={1} size='small'>
            <Descriptions.Item label='根目录'>
              <Space>
                <span style={{ fontSize: 11, wordBreak: 'break-all' }}>
                  {globalStatus.latticeRoot}
                </span>
                <Tooltip title='在文件管理器中打开'>
                  <Button
                    size='small'
                    type='text'
                    icon={<FolderOpenOutlined />}
                    onClick={() => handleOpenRoot('finder')}
                  />
                </Tooltip>
                <Tooltip title='在终端中打开'>
                  <Button
                    size='small'
                    type='text'
                    icon={<CodeOutlined />}
                    onClick={() => handleOpenRoot('terminal')}
                  />
                </Tooltip>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label='用户名'>{globalStatus.username}</Descriptions.Item>
            <Descriptions.Item label='项目数'>{globalStatus.projectCount}</Descriptions.Item>
            <Descriptions.Item label='任务数'>
              {globalStatus.taskCount}（活跃 {globalStatus.activeTaskCount}）
            </Descriptions.Item>
            <Descriptions.Item label='数据库'>{globalStatus.dbSizeKB} KB</Descriptions.Item>
            <Descriptions.Item label='Git'>
              <Tag color={globalStatus.gitEnabled ? 'green' : 'default'}>
                {globalStatus.gitEnabled ? '已启用' : '未启用'}
              </Tag>
            </Descriptions.Item>
            {globalStatus.scanDirs.length > 0 && (
              <Descriptions.Item label='扫描目录'>
                <span style={{ fontSize: 11, wordBreak: 'break-all' }}>
                  {globalStatus.scanDirs.join(', ')}
                </span>
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      )}

      <Card size='small' title='统计'>
        <Descriptions column={2} size='small'>
          <Descriptions.Item label='项目'>{stats?.projectCount ?? '-'}</Descriptions.Item>
          <Descriptions.Item label='任务'>{stats?.taskCount ?? '-'}</Descriptions.Item>
          <Descriptions.Item label='进行中'>
            <Tag color='blue'>{stats?.activeTaskCount ?? '-'}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label='关系'>{stats?.relationCount ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      {ragStatus && (
        <Card size='small' title='RAG 状态'>
          <Descriptions column={1} size='small'>
            <Descriptions.Item label='模型'>{ragStatus.modelId}</Descriptions.Item>
            <Descriptions.Item label='文档数'>{ragStatus.indexedDocuments}</Descriptions.Item>
            <Descriptions.Item label='向量数'>{ragStatus.totalEmbeddings}</Descriptions.Item>
            <Descriptions.Item label='FTS 版本'>
              <Tag
                color={
                  ragStatus.ftsIndexVersion < ragStatus.expectedFtsVersion ? 'orange' : 'green'
                }>
                v{ragStatus.ftsIndexVersion}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label='模型安装'>
              <Tag color={ragStatus.modelInstalled ? 'green' : 'red'}>
                {ragStatus.modelInstalled ? '已安装' : '未安装'}
              </Tag>
            </Descriptions.Item>
            {ragStatus.modelChanged && (
              <Descriptions.Item label='模型变更'>
                <Tag color='orange'>需 rebuild</Tag>
              </Descriptions.Item>
            )}
          </Descriptions>
        </Card>
      )}
      <ConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
});
