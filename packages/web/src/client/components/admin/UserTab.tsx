import { memo, useState } from 'react';
import { Button, List, Tag, Input, App, Space, Modal, Form } from 'antd';
import { SwapOutlined, UserAddOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';
import { apiPost } from '../../lib';

export const UserTab = memo(function UserTab() {
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [newName, setNewName] = useState('');
  const [renameUser, setRenameUser] = useState<string | null>(null);
  const [renameForm] = Form.useForm();

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => getAdapter().getUsers(),
    staleTime: 30_000,
  });

  const handleSwitch = (username: string) => {
    modal.confirm({
      title: '切换用户',
      content: `确认切换到用户「${username}」？所有数据视图将改变。`,
      onOk: async () => {
        try {
          await apiPost('/api/users/switch', { username });
          message.success(`已切换到 ${username}`);
          queryClient.invalidateQueries();
        } catch (err) {
          message.error(`切换失败: ${(err as Error).message}`);
        }
      },
    });
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      message.warning('请输入用户名');
      return;
    }
    try {
      const data = await apiPost<{ success?: boolean; message?: string }>('/api/users/create', {
        name: newName.trim(),
      });
      if (!data.success) throw new Error(data.message ?? '创建失败');
      message.success(`用户 ${newName.trim()} 已创建`);
      setNewName('');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      message.error(`创建失败: ${(err as Error).message}`);
    }
  };

  const handleRename = async () => {
    let values;
    try {
      values = await renameForm.validateFields();
    } catch {
      return; // 校验错误，表单自行展示
    }
    try {
      const data = await apiPost<{ success?: boolean; message?: string }>('/api/users/rename', {
        oldName: renameUser,
        newName: values.newName,
      });
      if (data.success) {
        message.success(`已重命名为 ${values.newName}`);
        setRenameUser(null);
        renameForm.resetFields();
        queryClient.invalidateQueries({ queryKey: ['users'] });
      } else {
        throw new Error(data.message ?? '重命名失败');
      }
    } catch (err) {
      message.error(`重命名失败: ${(err as Error).message}`);
      throw err;
    }
  };

  const handleRemove = (username: string) => {
    modal.confirm({
      title: '删除用户',
      content: `确认删除用户「${username}」及其所有数据？此操作不可恢复。`,
      okType: 'danger',
      onOk: async () => {
        try {
          const data = await apiPost<{ success?: boolean; message?: string }>('/api/users/remove', {
            name: username,
          });
          if (data.success) {
            message.success(`用户 ${username} 已删除`);
            queryClient.invalidateQueries({ queryKey: ['users'] });
          } else {
            throw new Error(data.message ?? '删除失败');
          }
        } catch (err) {
          message.error(`删除失败: ${(err as Error).message}`);
          throw err;
        }
      },
    });
  };

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          placeholder='新用户名'
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={handleCreate}
        />
        <Button icon={<UserAddOutlined />} onClick={handleCreate}>
          创建
        </Button>
      </Space.Compact>

      <List
        size='small'
        dataSource={usersData?.users ?? []}
        renderItem={(username) => {
          const isCurrent = username === usersData?.currentUser;
          return (
            <List.Item
              actions={[
                !isCurrent && (
                  <Button
                    key='switch'
                    size='small'
                    icon={<SwapOutlined />}
                    onClick={() => handleSwitch(username)}>
                    切换
                  </Button>
                ),
                <Button
                  key='rename'
                  size='small'
                  type='text'
                  icon={<EditOutlined />}
                  onClick={() => {
                    setRenameUser(username);
                    renameForm.setFieldsValue({ newName: username });
                  }}
                />,
                !isCurrent && (
                  <Button
                    key='remove'
                    size='small'
                    type='text'
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemove(username)}
                  />
                ),
              ].filter(Boolean)}>
              <List.Item.Meta
                title={
                  <span>
                    {username}
                    {isCurrent && (
                      <Tag color='green' style={{ marginLeft: 8 }}>
                        当前
                      </Tag>
                    )}
                  </span>
                }
              />
            </List.Item>
          );
        }}
      />

      <Modal
        title={`重命名用户 - ${renameUser ?? ''}`}
        open={!!renameUser}
        onCancel={() => setRenameUser(null)}
        onOk={handleRename}
        width={400}>
        <Form form={renameForm} layout='vertical' size='small'>
          <Form.Item name='newName' label='新用户名' rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
});
