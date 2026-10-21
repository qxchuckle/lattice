import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloudSyncOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  UserAddOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { i18nT } from '@lattice-web-ui';
import { useConfig } from '../context';
import type { ConfigDomainInfo } from '@qcqx/lattice-protocol';

interface DomainForm {
  remote: string;
  branch: string;
  label: string;
  use: 'trusted' | 'reference' | 'off';
  routes: string[];
}

const emptyDomain: DomainForm = {
  remote: '',
  branch: 'main',
  label: '',
  use: 'trusted',
  routes: [],
};

function resultMessage(result: unknown): string | undefined {
  if (result && typeof result === 'object') {
    const value = result as { message?: unknown; success?: unknown };
    if (typeof value.message === 'string') return value.message;
  }
  return undefined;
}

export function UsersSyncSection() {
  const { state, busy, userOp, syncOp, gitOp, refresh } = useConfig();
  const { message, modal } = App.useApp();
  const [userModal, setUserModal] = useState<'create' | 'rename' | null>(null);
  const [userName, setUserName] = useState('');
  const [domainModal, setDomainModal] = useState<'create' | 'edit' | null>(null);
  const [domainHash, setDomainHash] = useState<string | null>(null);
  const [domainForm, setDomainForm] = useState<DomainForm>(emptyDomain);
  const [remoteModal, setRemoteModal] = useState<'add' | 'set' | null>(null);
  const [remoteName, setRemoteName] = useState('origin');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [initRemote, setInitRemote] = useState('');

  const openDomain = (domain?: ConfigDomainInfo) => {
    if (domain) {
      setDomainHash(domain.hash);
      setDomainForm({
        remote: domain.remote,
        branch: domain.branch,
        label: domain.label ?? '',
        use: domain.use,
        routes: domain.routes ?? [],
      });
      setDomainModal('edit');
    } else {
      setDomainHash(null);
      setDomainForm(emptyDomain);
      setDomainModal('create');
    }
  };

  const submitDomain = async () => {
    if (!domainForm.remote.trim()) {
      message.warning(i18nT('Remote 不能为空', 'Remote is required'));
      return;
    }
    try {
      let result: unknown;
      if (domainModal === 'edit' && domainHash) {
        result = await syncOp({
          op: 'update',
          hash: domainHash,
          remote: domainForm.remote.trim(),
          branch: domainForm.branch.trim() || 'main',
          label: domainForm.label.trim(),
          use: domainForm.use,
          routes: domainForm.routes,
        });
      } else {
        result = await syncOp({
          op: 'join',
          remote: domainForm.remote.trim(),
          branch: domainForm.branch.trim() || 'main',
          label: domainForm.label.trim() || undefined,
          use: domainForm.use,
          routes: domainForm.routes,
        });
      }
      const warnings =
        result && typeof result === 'object'
          ? (result as { warnings?: unknown; pullWarning?: unknown })
          : {};
      const warningList = [
        ...(Array.isArray(warnings.warnings)
          ? warnings.warnings.filter((item): item is string => typeof item === 'string')
          : []),
        ...(typeof warnings.pullWarning === 'string' ? [warnings.pullWarning] : []),
      ];
      if (warningList.length > 0) {
        message.warning(
          i18nT(
            `同步域已保存，但初始拉取/预览有问题：${warningList.join('；')}`,
            `Sync domain saved, but initial pull/preview warned: ${warningList.join('; ')}`,
          ),
        );
      } else {
        message.success(i18nT('同步域已保存', 'Sync domain saved'));
      }
      setDomainModal(null);
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const reorder = async (domain: ConfigDomainInfo, delta: number) => {
    const list = [...state.domains].sort((a, b) => a.priority - b.priority);
    const index = list.findIndex((item) => item.hash === domain.hash);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    try {
      await syncOp({ op: 'reorder', hashes: list.map((item) => item.hash) });
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const submitRemote = async () => {
    if (!remoteName.trim() || !remoteUrl.trim()) {
      message.warning(i18nT('名称和 URL 不能为空', 'Name and URL are required'));
      return;
    }
    try {
      const result = await gitOp({
        op: remoteModal === 'set' ? 'remote-set' : 'remote-add',
        name: remoteName.trim(),
        url: remoteUrl.trim(),
      });
      message.success(resultMessage(result) ?? i18nT('Remote 已保存', 'Remote saved'));
      setRemoteModal(null);
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const runDomainSync = async () => {
    try {
      const result = await syncOp({ op: 'sync' });
      const outcomes = Array.isArray(result)
        ? (result as Array<{
            pulled?: boolean;
            pullMessage?: string;
            push?: { status?: string; message?: string };
          }>)
        : [];
      const failed = outcomes.filter(
        (outcome) =>
          outcome.pulled === false ||
          (outcome.push !== undefined &&
            !['pushed', 'no-changes', 'skipped-no-routes'].includes(outcome.push.status ?? '')),
      );
      if (outcomes.length > 0 && failed.length > 0) {
        message.warning(
          i18nT(
            `${outcomes.length - failed.length}/${outcomes.length} 个域同步成功；其余请查看域状态`,
            `${outcomes.length - failed.length}/${outcomes.length} domains synced; check the others`,
          ),
        );
      } else {
        message.success(
          outcomes.length > 0
            ? i18nT(`已同步 ${outcomes.length} 个域`, `Synced ${outcomes.length} domain(s)`)
            : i18nT('同步完成', 'Sync complete'),
        );
      }
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const runGit = async (op: 'pull' | 'push' | 'sync') => {
    try {
      const result = await gitOp({ op });
      if (op === 'sync' && result && typeof result === 'object') {
        const value = result as {
          commit?: { success?: boolean; message?: string };
          pull?: { success?: boolean; message?: string };
          push?: { success?: boolean; message?: string };
        };
        const messages = [value.commit?.message, value.pull?.message, value.push?.message]
          .filter(Boolean)
          .join(' · ');
        if (
          value.commit?.success === false ||
          value.pull?.success === false ||
          value.push?.success === false
        ) {
          message.warning(messages || i18nT('同步未完全成功', 'Sync did not fully succeed'));
        } else {
          message.success(messages || i18nT('同步完成', 'Sync complete'));
        }
      } else {
        message.success(resultMessage(result) ?? i18nT('操作完成', 'Done'));
      }
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Space direction='vertical' size={16} style={{ width: '100%' }}>
      <Card
        size='small'
        title={i18nT('用户', 'Users')}
        extra={
          <Button
            size='small'
            icon={<UserAddOutlined />}
            onClick={() => {
              setUserName('');
              setUserModal('create');
            }}>
            {i18nT('新建用户', 'New user')}
          </Button>
        }>
        <Space direction='vertical' size={8} style={{ width: '100%' }}>
          {state.users.length === 0 && (
            <Typography.Text type='secondary'>{i18nT('暂无用户', 'No users')}</Typography.Text>
          )}
          {state.users.map((user) => (
            <Space key={user} wrap style={{ justifyContent: 'space-between', width: '100%' }}>
              <Space>
                <Typography.Text strong>{user}</Typography.Text>
                {user === state.user && <Tag color='green'>{i18nT('当前用户', 'Current')}</Tag>}
              </Space>
              <Space>
                {user !== state.user && (
                  <Button
                    size='small'
                    icon={<UserSwitchOutlined />}
                    onClick={() => {
                      void userOp({ op: 'switch', username: user })
                        .then(() => refresh())
                        .catch((error: unknown) =>
                          message.error(error instanceof Error ? error.message : String(error)),
                        );
                    }}>
                    {i18nT('切换', 'Switch')}
                  </Button>
                )}
                {user === state.user && (
                  <Button
                    size='small'
                    onClick={() => {
                      setUserName(user);
                      setUserModal('rename');
                    }}>
                    {i18nT('重命名', 'Rename')}
                  </Button>
                )}
              </Space>
            </Space>
          ))}
        </Space>
      </Card>

      <Card
        size='small'
        title={i18nT('同步域（经验包）', 'Sync domains (knowledge packs)')}
        extra={
          <Space>
            <Button
              size='small'
              icon={<CloudSyncOutlined />}
              loading={busy === 'sync'}
              onClick={() => void runDomainSync()}>
              {i18nT('同步全部域', 'Sync all domains')}
            </Button>
            <Button size='small' icon={<PlusOutlined />} onClick={() => openDomain()}>
              {i18nT('添加域', 'Add domain')}
            </Button>
          </Space>
        }>
        {state.domains.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={i18nT('尚未配置同步域', 'No sync domains configured')}
          />
        ) : (
          <Table<ConfigDomainInfo>
            rowKey='hash'
            size='small'
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={[...state.domains].sort((a, b) => a.priority - b.priority)}
            columns={[
              {
                title: '#',
                width: 42,
                render: (_value, record) => record.priority,
              },
              {
                title: i18nT('域', 'Domain'),
                render: (_value, record) => (
                  <Space direction='vertical' size={0}>
                    <Typography.Text strong>{record.label || record.remote}</Typography.Text>
                    <Typography.Text type='secondary' style={{ fontSize: 11 }}>
                      {record.remote}#{record.branch}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: i18nT('策略', 'Use'),
                dataIndex: 'use',
                render: (value: string) => <Tag>{value}</Tag>,
              },
              {
                title: i18nT('推送', 'Push'),
                dataIndex: 'pushState',
                render: (value: string) => (
                  <Typography.Text style={{ fontSize: 12 }}>{value}</Typography.Text>
                ),
              },
              {
                title: i18nT('上次同步', 'Last sync'),
                dataIndex: 'lastSync',
                render: (value: ConfigDomainInfo['lastSync']) =>
                  value ? (
                    <Tag color={value.status === 'ok' ? 'green' : 'red'} title={value.message}>
                      {new Date(value.at).toLocaleString()}
                    </Tag>
                  ) : (
                    <Tag>{i18nT('未同步', 'Never')}</Tag>
                  ),
              },
              {
                title: i18nT('操作', 'Actions'),
                width: 190,
                render: (_value, record) => (
                  <Space size={2} wrap>
                    <Button
                      size='small'
                      type='text'
                      icon={<ArrowUpOutlined />}
                      title={i18nT('上移', 'Move up')}
                      aria-label={i18nT('上移', 'Move up')}
                      onClick={() => void reorder(record, -1)}
                    />
                    <Button
                      size='small'
                      type='text'
                      icon={<ArrowDownOutlined />}
                      title={i18nT('下移', 'Move down')}
                      aria-label={i18nT('下移', 'Move down')}
                      onClick={() => void reorder(record, 1)}
                    />
                    <Button
                      size='small'
                      type='text'
                      icon={<EditOutlined />}
                      title={i18nT('编辑域', 'Edit domain')}
                      aria-label={i18nT('编辑域', 'Edit domain')}
                      onClick={() => openDomain(record)}
                    />
                    <Popconfirm
                      title={i18nT('解除该同步域？', 'Unlink this domain?')}
                      description={i18nT(
                        '只删除本机配置与镜像，不会修改远端。',
                        'Removes local config and mirror; the remote is untouched.',
                      )}
                      onConfirm={() => {
                        void syncOp({ op: 'unlink', hash: record.hash })
                          .then(() => refresh())
                          .then(() => message.success(i18nT('已解除同步域', 'Domain unlinked')))
                          .catch((error: unknown) =>
                            message.error(error instanceof Error ? error.message : String(error)),
                          );
                      }}>
                      <Button
                        size='small'
                        type='text'
                        danger
                        icon={<DeleteOutlined />}
                        title={i18nT('解除同步域', 'Unlink domain')}
                        aria-label={i18nT('解除同步域', 'Unlink domain')}
                      />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Card
        size='small'
        title={i18nT('主数据仓 Git', 'Data repo Git')}
        extra={
          <Space>
            <Button size='small' onClick={() => void runGit('pull')}>
              {i18nT('拉取', 'Pull')}
            </Button>
            <Button size='small' onClick={() => void runGit('push')}>
              {i18nT('推送', 'Push')}
            </Button>
            <Button size='small' type='primary' onClick={() => void runGit('sync')}>
              {i18nT('同步', 'Sync')}
            </Button>
          </Space>
        }>
        <Space direction='vertical' size={12} style={{ width: '100%' }}>
          <Descriptions size='small' column={2} colon={false}>
            <Descriptions.Item label={i18nT('已初始化', 'Initialized')}>
              <Tag color={state.git.status.initialized ? 'green' : 'orange'}>
                {state.git.status.initialized ? i18nT('是', 'Yes') : i18nT('否', 'No')}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('分支', 'Branch')}>
              {state.git.status.branch ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('未提交变更', 'Changes')}>
              {state.git.status.changedFiles.length}
            </Descriptions.Item>
            <Descriptions.Item label={i18nT('领先 / 落后', 'Ahead / behind')}>
              {state.git.status.aheadCount} / {state.git.status.behindCount}
            </Descriptions.Item>
          </Descriptions>

          {!state.git.status.initialized && (
            <Space wrap>
              <Input
                style={{ width: 360 }}
                value={initRemote}
                onChange={(event) => setInitRemote(event.target.value)}
                placeholder={i18nT('可选：远程仓库 URL', 'Optional: remote URL')}
              />
              <Button
                type='primary'
                onClick={() => {
                  void gitOp({ op: 'init', remote: initRemote.trim() || undefined })
                    .then((result) => {
                      message.success(
                        resultMessage(result) ?? i18nT('Git 已初始化', 'Git initialized'),
                      );
                      return refresh();
                    })
                    .catch((error: unknown) =>
                      message.error(error instanceof Error ? error.message : String(error)),
                    );
                }}>
                {i18nT('初始化 Git', 'Initialize Git')}
              </Button>
            </Space>
          )}

          <Space wrap>
            <Input
              style={{ width: 360 }}
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder={i18nT('提交信息（可选）', 'Commit message (optional)')}
            />
            <Button
              onClick={() => {
                void gitOp({ op: 'commit', message: commitMessage.trim() || undefined })
                  .then((result) => {
                    message.success(resultMessage(result) ?? i18nT('提交完成', 'Committed'));
                    setCommitMessage('');
                    return refresh();
                  })
                  .catch((error: unknown) =>
                    message.error(error instanceof Error ? error.message : String(error)),
                  );
              }}>
              {i18nT('提交全部', 'Commit all')}
            </Button>
          </Space>

          <Table
            rowKey='name'
            size='small'
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={state.git.remotes}
            locale={{ emptyText: i18nT('未配置 remote', 'No remotes') }}
            columns={[
              { title: 'Name', dataIndex: 'name', width: 120 },
              {
                title: 'URL',
                dataIndex: 'url',
                render: (value: string) => (
                  <Typography.Text copyable={{ text: value }} style={{ fontSize: 12 }}>
                    {value}
                  </Typography.Text>
                ),
              },
              {
                title: i18nT('操作', 'Actions'),
                width: 130,
                render: (_value, record) => (
                  <Space size={2}>
                    <Button
                      size='small'
                      type='link'
                      onClick={() => {
                        setRemoteModal('set');
                        setRemoteName(record.name);
                        setRemoteUrl(record.url);
                      }}>
                      {i18nT('修改', 'Set')}
                    </Button>
                    <Popconfirm
                      title={i18nT('删除该 remote？', 'Remove this remote?')}
                      onConfirm={() => {
                        void gitOp({ op: 'remote-remove', name: record.name })
                          .then(() => refresh())
                          .then(() => message.success(i18nT('Remote 已删除', 'Remote removed')))
                          .catch((error: unknown) =>
                            message.error(error instanceof Error ? error.message : String(error)),
                          );
                      }}>
                      <Button size='small' type='link' danger>
                        {i18nT('删除', 'Remove')}
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            footer={() => (
              <Button
                size='small'
                type='link'
                icon={<PlusOutlined />}
                onClick={() => {
                  setRemoteModal('add');
                  setRemoteName('origin');
                  setRemoteUrl('');
                }}>
                {i18nT('添加 remote', 'Add remote')}
              </Button>
            )}
          />
        </Space>
      </Card>

      <Modal
        open={userModal !== null}
        title={
          userModal === 'rename'
            ? i18nT('重命名用户', 'Rename user')
            : i18nT('新建用户', 'Create user')
        }
        onCancel={() => setUserModal(null)}
        onOk={() => {
          void userOp({
            op: userModal === 'rename' ? 'rename' : 'create',
            username: userName.trim(),
            ...(userModal === 'rename' ? { force: true } : {}),
          })
            .then(() => {
              message.success(
                userModal === 'rename'
                  ? i18nT('用户已重命名', 'User renamed')
                  : i18nT('用户已创建', 'User created'),
              );
              setUserModal(null);
              return refresh();
            })
            .catch((error: unknown) =>
              message.error(error instanceof Error ? error.message : String(error)),
            );
        }}
        okButtonProps={{ disabled: !/^[\w-]+$/.test(userName.trim()) }}>
        <Input
          value={userName}
          onChange={(event) => setUserName(event.target.value)}
          placeholder={i18nT('字母、数字、- 或 _', 'Letters, digits, - or _')}
        />
      </Modal>

      <Modal
        open={domainModal !== null}
        title={
          domainModal === 'edit'
            ? i18nT('编辑同步域', 'Edit sync domain')
            : i18nT('添加同步域', 'Add sync domain')
        }
        onCancel={() => setDomainModal(null)}
        onOk={() => void submitDomain()}
        okButtonProps={{ disabled: !domainForm.remote.trim() }}
        okText={i18nT('保存', 'Save')}
        cancelText={i18nT('取消', 'Cancel')}>
        <Space direction='vertical' size={10} style={{ width: '100%' }}>
          <div>
            <Typography.Text>Remote</Typography.Text>
            <Input
              value={domainForm.remote}
              onChange={(event) => setDomainForm({ ...domainForm, remote: event.target.value })}
              placeholder='https://github.com/you/knowledge.git'
            />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Typography.Text>{i18nT('分支', 'Branch')}</Typography.Text>
              <Input
                value={domainForm.branch}
                onChange={(event) => setDomainForm({ ...domainForm, branch: event.target.value })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Typography.Text>{i18nT('备注名', 'Label')}</Typography.Text>
              <Input
                value={domainForm.label}
                onChange={(event) => setDomainForm({ ...domainForm, label: event.target.value })}
              />
            </div>
          </div>
          <div>
            <Typography.Text>{i18nT('消费策略', 'Use policy')}</Typography.Text>
            <Select
              style={{ width: '100%' }}
              value={domainForm.use}
              onChange={(next) => setDomainForm({ ...domainForm, use: next })}
              options={[
                {
                  value: 'trusted',
                  label: i18nT('trusted（读取并约束）', 'trusted (read + constrain)'),
                },
                { value: 'reference', label: i18nT('reference（只读）', 'reference (read only)') },
                { value: 'off', label: i18nT('off（只同步镜像）', 'off (mirror only)') },
              ]}
            />
          </div>
          <div>
            <Typography.Text>{i18nT('推送规则', 'Push routes')}</Typography.Text>
            <Select
              mode='tags'
              value={domainForm.routes}
              style={{ width: '100%' }}
              placeholder='* / project:foo* / user-spec:* / global-spec:*'
              onChange={(next) => setDomainForm({ ...domainForm, routes: next })}
            />
          </div>
        </Space>
      </Modal>

      <Modal
        open={remoteModal !== null}
        title={
          remoteModal === 'set'
            ? i18nT('修改 remote', 'Set remote')
            : i18nT('添加 remote', 'Add remote')
        }
        onCancel={() => setRemoteModal(null)}
        onOk={() => void submitRemote()}
        okButtonProps={{ disabled: !remoteName.trim() || !remoteUrl.trim() }}
        okText={i18nT('保存', 'Save')}
        cancelText={i18nT('取消', 'Cancel')}>
        <Space direction='vertical' size={10} style={{ width: '100%' }}>
          <Input
            addonBefore='Name'
            value={remoteName}
            disabled={remoteModal === 'set'}
            onChange={(event) => setRemoteName(event.target.value)}
          />
          <Input
            addonBefore='URL'
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.target.value)}
          />
        </Space>
      </Modal>
    </Space>
  );
}
