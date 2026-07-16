import { memo, useState, useCallback } from 'react';
import {
  Button,
  App,
  Tag,
  Descriptions,
  Card,
  Input,
  Space,
  List,
  Empty,
  Spin,
  Modal,
  Form,
} from 'antd';
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  SyncOutlined,
  CheckOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface GitStatus {
  initialized: boolean;
  remote: string | null;
  hasChanges: boolean;
  changedFiles: string[];
  branch: string | null;
  aheadCount: number;
  behindCount: number;
}

interface GitOpResult {
  success: boolean;
  message: string;
  output?: string;
}

interface GitRemoteInfo {
  name: string;
  url: string;
  fetchUrl: string;
  pushUrl: string;
}

export const GitSyncTab = memo(function GitSyncTab() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [log, setLog] = useState('');
  const [running, setRunning] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');

  // Remote 管理
  const [addOpen, setAddOpen] = useState(false);
  const [editRemote, setEditRemote] = useState<GitRemoteInfo | null>(null);
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const { data: gitStatus, isLoading } = useQuery({
    queryKey: ['git-status'],
    queryFn: async (): Promise<GitStatus> => {
      const res = await fetch('/api/git/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    },
    staleTime: 10_000,
  });

  const { data: remotes } = useQuery({
    queryKey: ['git-remotes'],
    queryFn: async (): Promise<GitRemoteInfo[]> => {
      const res = await fetch('/api/git/remotes');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    },
    staleTime: 10_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['git-status'] });
    queryClient.invalidateQueries({ queryKey: ['git-remotes'] });
  }, [queryClient]);

  const handleOp = useCallback(
    async (op: 'commit' | 'pull' | 'push' | 'sync') => {
      setRunning(true);
      setLog('');
      try {
        const body = op === 'commit' ? { message: commitMsg || undefined } : undefined;
        const res = await fetch(`/api/git/${op}`, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as
          | GitOpResult
          | { commit: GitOpResult; pull: GitOpResult; push: GitOpResult };

        if ('commit' in data) {
          const lines = [
            `提交: ${data.commit.success ? '✓' : '⚠'} ${data.commit.message}`,
            `拉取: ${data.pull.success ? '✓' : '⚠'} ${data.pull.message}`,
            `推送: ${data.push.success ? '✓' : '⚠'} ${data.push.message}`,
          ];
          setLog(lines.join('\n'));
          message.success('同步完成');
        } else {
          if (data.success) {
            setLog(data.message + (data.output ? `\n${data.output}` : ''));
            message.success(data.message);
            if (op === 'commit') setCommitMsg('');
          } else {
            setLog(data.message);
            message.warning(data.message);
          }
        }
        refresh();
      } catch (err) {
        setLog(`操作失败: ${(err as Error).message}`);
        message.error('操作失败');
      } finally {
        setRunning(false);
      }
    },
    [commitMsg, message, refresh],
  );

  const handleAddRemote = useCallback(async () => {
    let values;
    try {
      values = await addForm.validateFields();
    } catch {
      return; // 校验错误，表单自身已展示
    }
    try {
      const res = await fetch('/api/git/remotes/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: values.name, url: values.url }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GitOpResult;
      if (data.success) {
        message.success(data.message);
        setAddOpen(false);
        addForm.resetFields();
        refresh();
      } else {
        message.warning(data.message);
      }
    } catch (err) {
      message.error(`添加失败: ${(err as Error).message}`);
      throw err;
    }
  }, [addForm, message, refresh]);

  const handleSetRemoteUrl = useCallback(async () => {
    if (!editRemote) return;
    let values;
    try {
      values = await editForm.validateFields();
    } catch {
      return; // 校验错误，表单自身已展示
    }
    try {
      const res = await fetch('/api/git/remotes/set-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editRemote.name, url: values.url }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GitOpResult;
      if (data.success) {
        message.success(data.message);
        setEditRemote(null);
        editForm.resetFields();
        refresh();
      } else {
        message.warning(data.message);
      }
    } catch (err) {
      message.error(`修改失败: ${(err as Error).message}`);
      throw err;
    }
  }, [editRemote, editForm, message, refresh]);

  const handleRemoveRemote = useCallback(
    (name: string) => {
      modal.confirm({
        title: '删除 Remote',
        content: `确认删除 remote '${name}'？关联的拉取/推送将不可用。`,
        okType: 'danger',
        onOk: async () => {
          try {
            const res = await fetch('/api/git/remotes/remove', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as GitOpResult;
            if (data.success) {
              message.success(data.message);
              refresh();
            } else {
              message.warning(data.message);
            }
          } catch (err) {
            message.error(`删除失败: ${(err as Error).message}`);
            throw err;
          }
        },
      });
    },
    [modal, message, refresh],
  );

  if (isLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (!gitStatus?.initialized) {
    return (
      <div style={{ padding: '12px' }}>
        <Empty description='~/.lattice 未启用 Git 管理' />
      </div>
    );
  }

  const hasRemote = !!gitStatus.remote;
  const remoteList = remotes ?? [];

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Git 状态 */}
      <Card size='small' title='Git 状态'>
        <Descriptions column={1} size='small'>
          <Descriptions.Item label='分支'>
            {gitStatus.branch && <Tag color='blue'>{gitStatus.branch}</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label='远程仓库'>
            {hasRemote ? (
              <span style={{ fontSize: 11, wordBreak: 'break-all' }}>{gitStatus.remote}</span>
            ) : (
              <Tag color='orange'>未配置</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label='变更'>
            {gitStatus.hasChanges ? (
              <Tag color='orange'>{gitStatus.changedFiles.length} 个文件</Tag>
            ) : (
              <Tag color='green'>无变更</Tag>
            )}
          </Descriptions.Item>
          {gitStatus.aheadCount > 0 && (
            <Descriptions.Item label='领先'>
              <Tag color='blue'>{gitStatus.aheadCount} 个 commit 未推送</Tag>
            </Descriptions.Item>
          )}
          {gitStatus.behindCount > 0 && (
            <Descriptions.Item label='落后'>
              <Tag color='orange'>{gitStatus.behindCount} 个 commit 未拉取</Tag>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* Remote 管理 */}
      <Card
        size='small'
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <LinkOutlined /> Remote 仓库
          </span>
        }
        extra={
          <Button
            size='small'
            type='text'
            icon={<PlusOutlined />}
            onClick={() => setAddOpen(true)}
          />
        }>
        {remoteList.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            未关联任何远程仓库。点击 + 添加。
          </div>
        ) : (
          <List
            size='small'
            dataSource={remoteList}
            renderItem={(remote) => (
              <List.Item
                actions={[
                  <Button
                    key='edit'
                    size='small'
                    type='text'
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditRemote(remote);
                      editForm.setFieldsValue({ url: remote.url });
                    }}
                  />,
                  <Button
                    key='remove'
                    size='small'
                    type='text'
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemoveRemote(remote.name)}
                  />,
                ]}>
                <List.Item.Meta
                  title={
                    <span style={{ fontSize: 13 }}>
                      {remote.name}
                      {remote.name === 'origin' && (
                        <Tag color='blue' style={{ marginLeft: 4 }}>
                          默认
                        </Tag>
                      )}
                    </span>
                  }
                  description={
                    <span style={{ fontSize: 11, wordBreak: 'break-all' }}>{remote.url}</span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* 变更文件 */}
      {gitStatus.changedFiles.length > 0 && (
        <Card size='small' title={`变更文件 (${gitStatus.changedFiles.length})`}>
          <List
            size='small'
            dataSource={gitStatus.changedFiles.slice(0, 20)}
            renderItem={(file) => (
              <List.Item style={{ fontSize: 11, padding: '4px 0' }}>{file}</List.Item>
            )}
          />
          {gitStatus.changedFiles.length > 20 && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              ...还有 {gitStatus.changedFiles.length - 20} 个文件
            </div>
          )}
        </Card>
      )}

      {/* 提交 */}
      <div>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder='提交信息（可选）'
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onPressEnter={() => handleOp('commit')}
            size='small'
          />
          <Button
            icon={<CheckOutlined />}
            loading={running}
            onClick={() => handleOp('commit')}
            size='small'
            type='primary'>
            提交
          </Button>
        </Space.Compact>
        {!hasRemote && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
            未配置远程仓库，可先本地提交。配置 Remote 后即可 Pull / Push。
          </div>
        )}
      </div>

      {/* 同步操作 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          icon={<CloudDownloadOutlined />}
          loading={running}
          onClick={() => handleOp('pull')}
          disabled={!hasRemote}
          block>
          Pull
        </Button>
        <Button
          icon={<CloudUploadOutlined />}
          loading={running}
          onClick={() => handleOp('push')}
          disabled={!hasRemote}
          block>
          Push
        </Button>
        <Button
          type='primary'
          icon={<SyncOutlined />}
          loading={running}
          onClick={() => handleOp('sync')}
          disabled={!hasRemote}
          block>
          全部同步
        </Button>
      </div>

      {/* 日志 */}
      {log && (
        <div
          style={{
            fontSize: 11,
            padding: 8,
            background: 'var(--bg-secondary)',
            borderRadius: 4,
            whiteSpace: 'pre-wrap',
            color: 'var(--text-secondary)',
          }}>
          {log}
        </div>
      )}

      {/* 添加 Remote Modal */}
      <Modal
        title='添加 Remote'
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={handleAddRemote}
        destroyOnClose
        width={420}>
        <Form form={addForm} layout='vertical' size='small'>
          <Form.Item name='name' label='名称' rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder='origin' />
          </Form.Item>
          <Form.Item name='url' label='URL' rules={[{ required: true, message: '请输入 URL' }]}>
            <Input placeholder='https://github.com/user/repo.git' />
          </Form.Item>
        </Form>
      </Modal>

      {/* 切换 Remote URL Modal */}
      <Modal
        title={`切换 URL - ${editRemote?.name ?? ''}`}
        open={!!editRemote}
        onCancel={() => setEditRemote(null)}
        onOk={handleSetRemoteUrl}
        destroyOnClose
        width={420}>
        <Form form={editForm} layout='vertical' size='small'>
          <Form.Item name='url' label='新 URL' rules={[{ required: true, message: '请输入 URL' }]}>
            <Input placeholder='https://github.com/user/repo.git' />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
});
