import { memo, useState } from 'react';
import { Button, List, Tag, Segmented, App, Empty, Spin } from 'antd';
import { DeleteOutlined, UndoOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';

const TYPE_ICON: Record<string, string> = {
  task: '📋',
  project: '📦',
  spec: '📄',
};

export const TrashTab = memo(function TrashTab() {
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [filter, setFilter] = useState<string>('all');

  const { data: items, isLoading } = useQuery({
    queryKey: ['trash', filter],
    queryFn: () => getAdapter().getTrash(filter === 'all' ? undefined : filter),
    staleTime: 10_000,
  });

  const handleRestore = async (id: string) => {
    try {
      await getAdapter().restoreTrash(id);
      message.success('已恢复');
      queryClient.invalidateQueries({ queryKey: ['trash'] });
    } catch (err) {
      message.error(`恢复失败: ${(err as Error).message}`);
    }
  };

  const handlePurge = (id: string, title: string) => {
    modal.confirm({
      title: '彻底删除',
      content: `确认彻底删除「${title}」？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await getAdapter().purgeTrash(id);
          message.success('已彻底删除');
          queryClient.invalidateQueries({ queryKey: ['trash'] });
        } catch (err) {
          message.error(`删除失败: ${(err as Error).message}`);
          throw err;
        }
      },
    });
  };

  const handleEmpty = () => {
    modal.confirm({
      title: '清空垃圾桶',
      content: `确认清空全部 ${items?.length ?? 0} 项？此操作不可恢复。`,
      okText: '清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await getAdapter().emptyTrash();
          message.success(`已清空 ${result.count} 项`);
          queryClient.invalidateQueries({ queryKey: ['trash'] });
        } catch (err) {
          message.error(`清空失败: ${(err as Error).message}`);
          throw err;
        }
      },
    });
  };

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          size='small'
          value={filter}
          onChange={(v) => setFilter(v as string)}
          options={[
            { label: '全部', value: 'all' },
            { label: '任务', value: 'task' },
            { label: '项目', value: 'project' },
            { label: 'Spec', value: 'spec' },
          ]}
        />
        {items && items.length > 0 && (
          <Button size='small' danger icon={<DeleteOutlined />} onClick={handleEmpty}>
            清空
          </Button>
        )}
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : !items || items.length === 0 ? (
        <Empty description='垃圾桶为空' />
      ) : (
        <List
          size='small'
          dataSource={items}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key='restore'
                  size='small'
                  icon={<UndoOutlined />}
                  onClick={() => handleRestore(item.id)}>
                  恢复
                </Button>,
                <Button
                  key='purge'
                  size='small'
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handlePurge(item.id, item.title)}
                />,
              ]}>
              <List.Item.Meta
                avatar={<span style={{ fontSize: 18 }}>{TYPE_ICON[item.type] ?? '📄'}</span>}
                title={item.title}
                description={
                  <span style={{ fontSize: 11 }}>
                    <Tag>{item.type}</Tag>
                    {item.username && <Tag color='blue'>{item.username}</Tag>}
                    {new Date(item.trashedAt).toLocaleString('zh-CN')}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
});
