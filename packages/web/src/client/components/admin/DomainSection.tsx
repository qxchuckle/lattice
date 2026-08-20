import { memo, useState, useCallback } from 'react';
import { Button, App, Tag, Input, Space, Modal, Form, Select, Empty, Tooltip } from 'antd';
import { PlusOutlined, LinkOutlined, DisconnectOutlined, SyncOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../lib';

/**
 * 域（经验包）管理：join / unlink / route 编辑 / 全域同步。
 *
 * 域 = 多用户协作经验包（origin 单仓之外的第二轨道）：
 * join 即消费（默认 trusted），routes 决定推送白名单，数组顺序 = 遮蔽优先级。
 */

interface DomainInfo {
  hash: string;
  remote: string;
  branch: string;
  label?: string;
  use: 'trusted' | 'reference' | 'off';
  routes?: string[];
  pushState: string;
  mirrorExists: boolean;
  lastPushAt: string | null;
  priority: number;
}

interface JoinResult {
  domainHash: string;
  summary: {
    users: number;
    projects: number;
    specs: number;
    globalSpecTitles: string[];
    sameNameUserPresent: boolean;
  } | null;
  warnings: string[];
}

export const DomainSection = memo(function DomainSection() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinForm] = Form.useForm();
  const [syncing, setSyncing] = useState(false);
  const [routeInput, setRouteInput] = useState<Record<string, string>>({});

  const { data: domains } = useQuery({
    queryKey: ['git-domains'],
    queryFn: async (): Promise<DomainInfo[]> => await apiGet<DomainInfo[]>('/api/git/domains'),
    staleTime: 10_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['git-domains'] });
  }, [queryClient]);

  const handleJoin = useCallback(async () => {
    let values;
    try {
      values = await joinForm.validateFields();
    } catch {
      return;
    }
    try {
      const result = await apiPost<JoinResult>('/api/git/domains/join', {
        remote: values.remote,
        branch: values.branch || undefined,
        label: values.label || undefined,
        use: values.use || 'trusted',
        routes: values.routes
          ? values.routes
              .split('\n')
              .map((r: string) => r.trim())
              .filter(Boolean)
          : undefined,
      });
      const summary = result.summary
        ? `（${result.summary.users} 用户 · ${result.summary.projects} 项目 · ${result.summary.specs} spec）`
        : '';
      message.success(`已关联域 ${result.domainHash}${summary}`);
      if (result.warnings.length > 0) {
        message.warning(result.warnings.join('；'), 8);
      }
      setJoinOpen(false);
      joinForm.resetFields();
      refresh();
    } catch (err) {
      message.error(`关联失败：${(err as Error).message}`);
    }
  }, [joinForm, message, refresh]);

  const handleUnlink = useCallback(
    async (d: DomainInfo) => {
      try {
        await apiPost('/api/git/domains/unlink', { hash: d.hash });
        message.success(`已解除域 ${d.label ?? d.hash}（主数据毫发无伤）`);
        refresh();
      } catch (err) {
        message.error(`解除失败：${(err as Error).message}`);
      }
    },
    [message, refresh],
  );

  const handleRouteAdd = useCallback(
    async (hash: string) => {
      const rule = (routeInput[hash] ?? '').trim();
      if (!rule) return;
      try {
        await apiPost('/api/git/domains/route/add', { hash, rule });
        setRouteInput((prev) => ({ ...prev, [hash]: '' }));
        refresh();
      } catch (err) {
        message.error(`${(err as Error).message}`);
      }
    },
    [routeInput, message, refresh],
  );

  const handleRouteRemove = useCallback(
    async (hash: string, rule: string) => {
      try {
        await apiPost('/api/git/domains/route/remove', { hash, rule });
        refresh();
      } catch (err) {
        message.error(`${(err as Error).message}`);
      }
    },
    [message, refresh],
  );

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const data = await apiPost<{
        outcomes: Array<{
          domainHash: string;
          label?: string;
          pulled: boolean;
          pullMessage: string;
          push?: { status: string; message: string };
        }>;
      }>('/api/git/domains/sync');
      const lines = data.outcomes.map(
        (o) =>
          `${o.label ?? o.domainHash}: ${o.pulled ? '拉取✓' : `拉取⚠ ${o.pullMessage}`}${
            o.push
              ? `；${o.push.status === 'pushed' ? `推送✓ ${o.push.message}` : `推送 ${o.push.message}`}`
              : ''
          }`,
      );
      message.info(lines.join('\n'), 10);
      refresh();
    } catch (err) {
      message.error(`域同步失败：${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }, [message, refresh]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>域（经验包）</span>
        <Tag style={{ fontSize: 10 }}>多用户协作</Tag>
        <div style={{ flex: 1 }} />
        <Button size='small' icon={<PlusOutlined />} onClick={() => setJoinOpen(true)}>
          关联域
        </Button>
        <Button
          size='small'
          icon={<SyncOutlined />}
          loading={syncing}
          onClick={handleSync}
          disabled={!domains?.length}>
          域同步
        </Button>
      </div>

      {!domains || domains.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ fontSize: 11 }}>
              尚未关联域。关联经验包仓库后，其 spec / 任务经统一数据源并入检索视图。
            </span>
          }
        />
      ) : (
        domains.map((d) => (
          <div
            key={d.hash}
            style={{
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <LinkOutlined style={{ fontSize: 11 }} />
              <span style={{ fontWeight: 600, fontSize: 12 }}>{d.label ?? d.remote}</span>
              <Tooltip title={d.hash}>
                <Tag style={{ fontSize: 10 }}>{d.hash.slice(0, 8)}</Tag>
              </Tooltip>
              <Tag style={{ fontSize: 10 }}>{`#${d.branch}`}</Tag>
              <Tag
                style={{ fontSize: 10 }}
                color={d.use === 'trusted' ? 'green' : d.use === 'reference' ? 'blue' : 'default'}>
                {d.use}
              </Tag>
              <Tag style={{ fontSize: 10 }}>{d.pushState}</Tag>
              {!d.mirrorExists && (
                <Tag style={{ fontSize: 10 }} color='orange'>
                  镜像缺失
                </Tag>
              )}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                优先级 {d.priority}
              </span>
              <Button
                size='small'
                type='text'
                icon={<DisconnectOutlined />}
                onClick={() => handleUnlink(d)}
              />
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{d.remote}</div>
            {d.lastPushAt && (
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                上次推送 {new Date(d.lastPushAt).toLocaleString()}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {(d.routes ?? []).map((rule) => (
                <Tag
                  key={rule}
                  style={{ fontSize: 10 }}
                  closable
                  onClose={(e) => {
                    e.preventDefault();
                    void handleRouteRemove(d.hash, rule);
                  }}>
                  {rule}
                </Tag>
              ))}
            </div>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                size='small'
                placeholder='添加推送规则：* | project:<glob> | user-spec:<glob> | global-spec:<glob>'
                value={routeInput[d.hash] ?? ''}
                onChange={(e) => setRouteInput((prev) => ({ ...prev, [d.hash]: e.target.value }))}
                onPressEnter={() => void handleRouteAdd(d.hash)}
              />
              <Button size='small' onClick={() => void handleRouteAdd(d.hash)}>
                添加
              </Button>
            </Space.Compact>
          </div>
        ))
      )}

      <Modal
        title='关联域（经验包仓库）'
        open={joinOpen}
        onCancel={() => setJoinOpen(false)}
        onOk={handleJoin}
        destroyOnClose
        width={480}>
        <Form form={joinForm} layout='vertical' size='small'>
          <Form.Item
            name='remote'
            label='仓库地址'
            rules={[{ required: true, message: '请输入域仓库 URL' }]}>
            <Input placeholder='https://github.com/team/lattice-pack.git' />
          </Form.Item>
          <Form.Item name='branch' label='分支（经验包分支，建议只 fast-forward）'>
            <Input placeholder='main' />
          </Form.Item>
          <Form.Item name='label' label='备注名（纯本机显示）'>
            <Input placeholder='团队域' />
          </Form.Item>
          <Form.Item name='use' label='消费策略' initialValue='trusted'>
            <Select
              options={[
                { value: 'trusted', label: 'trusted：读取 + 约束生效（默认）' },
                { value: 'reference', label: 'reference：只读不注入约束' },
                { value: 'off', label: 'off：只同步镜像不读取' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name='routes'
            label='推送白名单（每行一条；留空 = 只读消费）'
            extra='"*" 全量；project:<glob> / user-spec:<glob> / global-spec:<glob>'>
            <Input.TextArea rows={2} placeholder={'project:work-*\nuser-spec:commit-*.md'} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
});
