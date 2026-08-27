import { memo, useState, useCallback, useRef } from 'react';
import { Button, App, Tag, Input, Modal, Form, Select, Empty, Tooltip, Popconfirm } from 'antd';
import {
  PlusOutlined,
  DisconnectOutlined,
  SyncOutlined,
  HolderOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../lib';

/**
 * 域（经验包）管理：join / 编辑弹窗（label·use·routes 统一在弹窗内）/ unlink / 拖拽排序优先级 / 全域同步。
 *
 * 域 = 多用户协作经验包（origin 单仓之外的第二轨道）：
 * join 即消费（默认 trusted），routes 决定推送白名单，卡片排序 = 遮蔽优先级。
 * 卡片本身只读展示，一切编辑（含推送规则增删）进入「编辑域」弹窗。
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
  /** 上次同步结果（core 持久化于 .cache/sync-status/） */
  lastSync?: { status: 'ok' | 'error'; message: string; at: string } | null;
  /** 镜像内容统计（各域数据概况） */
  stats?: { users: number; projects: number; specs: number; tasks: number } | null;
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

const USE_OPTIONS = [
  { value: 'trusted', label: 'trusted：读取 + 约束生效（默认）' },
  { value: 'reference', label: 'reference：只读不注入约束' },
  { value: 'off', label: 'off：只同步镜像不读取' },
];

export const DomainSection = memo(function DomainSection() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinForm] = Form.useForm();
  const [editing, setEditing] = useState<DomainInfo | null>(null);
  const [editForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // dry-run 预览：routes 编辑时实时算「将推送什么」（不实际推送，保存前防误推）
  const [previewRoutes, setPreviewRoutes] = useState<string | null>(null);
  const previewQuery = useQuery({
    queryKey: ['domain-preview', editing?.hash, previewRoutes],
    queryFn: async () => {
      if (!editing || previewRoutes === null) return null;
      const r = await apiPost<{
        copied: number;
        removed: number;
        copiedFiles: string[];
        removedFiles: string[];
      }>('/api/git/domains/preview', {
        hash: editing.hash,
        routes: previewRoutes
          .split('\n')
          .map((x: string) => x.trim())
          .filter(Boolean),
      });
      return r;
    },
    enabled: !!editing && previewRoutes !== null,
    staleTime: 0,
  });
  // 拖拽排序
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const { data: domains } = useQuery({
    queryKey: ['git-domains'],
    queryFn: async (): Promise<DomainInfo[]> => await apiGet<DomainInfo[]>('/api/git/domains'),
    staleTime: 10_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['git-domains'] });
    queryClient.invalidateQueries({ queryKey: ['domains-data'] });
    // 同步/编辑/排序等操作都会产生日志——联动失效，日志区立即显示最新
    queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
  }, [queryClient]);

  // ── join ──
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

  // ── 编辑弹窗（label / use / routes 统一管理，外部不可编辑） ──
  const openEdit = useCallback(
    (d: DomainInfo) => {
      const routesStr = (d.routes ?? []).join('\n');
      editForm.setFieldsValue({
        remote: d.remote,
        branch: d.branch,
        label: d.label ?? '',
        use: d.use,
        routes: routesStr,
      });
      setEditing(d);
      setPreviewRoutes(routesStr);
    },
    [editForm],
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editing) return;
    let values;
    try {
      values = await editForm.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const routes = ((values.routes as string) ?? '')
        .split('\n')
        .map((r: string) => r.trim())
        .filter(Boolean);
      const remote = ((values.remote as string) ?? '').trim();
      const branch = ((values.branch as string) ?? '').trim() || 'main';
      const identityChanged = remote !== editing.remote || branch !== editing.branch;
      if (identityChanged) {
        const confirmed = await modal.confirm({
          title: '域地址/分支已变更',
          content:
            '域身份将由地址+分支重新计算：镜像重建、指纹重置（有推送规则时下次同步全量上行），备注/策略/规则保留。',
          okText: '确认迁移',
          cancelText: '取消',
        });
        if (!confirmed) return;
      }
      const result = await apiPost<{
        migrated?: boolean;
        hash?: string;
        pullWarning?: string;
      }>('/api/git/domains/update', {
        hash: editing.hash,
        ...(identityChanged ? { remote, branch } : {}),
        label: (values.label as string)?.trim() || undefined,
        use: values.use,
        routes,
      });
      message.success(
        result.migrated
          ? `域已迁移：${editing.hash.slice(0, 8)} → ${(result.hash ?? '').slice(0, 8)}（镜像已重建）`
          : `已保存域配置（${editing.label ?? editing.hash.slice(0, 8)}）`,
      );
      if (result.pullWarning) {
        message.warning(`初始拉取失败（配置已生效，下次域同步将重试）：${result.pullWarning}`, 8);
      }
      setEditing(null);
      refresh();
    } catch (err) {
      message.error(`保存失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [editing, editForm, message, refresh]);

  // ── unlink ──
  const handleUnlink = useCallback(
    (d: DomainInfo) => {
      modal.confirm({
        title: `解除域 ${d.label ?? d.hash.slice(0, 8)}？`,
        content:
          '将移除本机配置、镜像与指纹；远端仓库与其他成员不受影响，主数据毫发无伤。可随时重新 join。',
        okText: '解除关联',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          try {
            await apiPost('/api/git/domains/unlink', { hash: d.hash });
            message.success(`已解除域 ${d.label ?? d.hash}（主数据毫发无伤）`);
            refresh();
          } catch (err) {
            message.error(`解除失败：${(err as Error).message}`);
          }
        },
      });
    },
    [modal, message, refresh],
  );

  // ── 拖拽排序（卡片顺序 = 读时遮蔽优先级） ──
  const handleDrop = useCallback(
    async (toIndex: number) => {
      const from = dragIndex.current;
      dragIndex.current = null;
      setDragOverIndex(null);
      if (from === null || from === toIndex || !domains) return;
      const next = [...domains];
      const [moved] = next.splice(from, 1);
      next.splice(toIndex, 0, moved);
      try {
        await apiPost('/api/git/domains/reorder', { hashes: next.map((d) => d.hash) });
        message.success(
          `优先级已调整：${moved.label ?? moved.hash.slice(0, 8)} → 第 ${toIndex + 1} 位`,
        );
        refresh();
      } catch (err) {
        message.error(`排序失败：${(err as Error).message}`);
      }
    },
    [domains, message, refresh],
  );

  // ── 全域同步 ──
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

  const domainList = domains ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 标题由外层 Card 提供（域 · 经验包），此处仅保留操作按钮 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1 }} />
        <Button size='small' icon={<PlusOutlined />} onClick={() => setJoinOpen(true)}>
          关联域
        </Button>
        <Button
          size='small'
          icon={<SyncOutlined />}
          loading={syncing}
          onClick={handleSync}
          disabled={!domainList.length}>
          域同步
        </Button>
      </div>

      {domainList.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ fontSize: 11 }}>
              尚未关联域。关联经验包仓库后，其 spec / 任务经统一数据源并入检索视图。
            </span>
          }
        />
      ) : (
        domainList.map((d, i) => (
          <div
            key={d.hash}
            draggable
            onDragStart={() => {
              dragIndex.current = i;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIndex(i);
            }}
            onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
            onDrop={() => void handleDrop(i)}
            style={{
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              background:
                dragOverIndex === i && dragIndex.current !== null && dragIndex.current !== i
                  ? 'var(--bg-secondary)'
                  : undefined,
              opacity: dragIndex.current === i ? 0.6 : 1,
            }}>
            {/* 标题行：⠿ + 优先级数字徽标 + 名称 + 右侧操作按钮 */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Tooltip title='拖动调整优先级（遮蔽顺序）'>
                <HolderOutlined
                  style={{ fontSize: 12, cursor: 'grab', color: 'var(--text-secondary)' }}
                  aria-label='拖动排序'
                />
              </Tooltip>
              <Tooltip
                title={`读时遮蔽优先级（本地 > 域，域间按配置数组顺序）：第 ${d.priority} 位`}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#fff',
                    background: 'color-mix(in srgb, var(--brand-color) 85%, transparent)',
                  }}>
                  {d.priority}
                </span>
              </Tooltip>
              <span style={{ fontWeight: 600, fontSize: 12 }}>{d.label ?? d.remote}</span>
              <div style={{ flex: 1 }} />
              <Button
                size='small'
                type='text'
                icon={<EditOutlined />}
                aria-label='编辑域'
                onClick={() => openEdit(d)}
              />
              <Popconfirm
                title='解除该域关联？'
                description='移除本机配置/镜像/指纹，远端与其他成员不受影响'
                okText='解除'
                cancelText='取消'
                onConfirm={() => handleUnlink(d)}>
                <Button
                  size='small'
                  type='text'
                  danger
                  icon={<DisconnectOutlined />}
                  aria-label='解除关联'
                />
              </Popconfirm>
            </div>
            {/* 标签行：独立一行展示状态标签 */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingLeft: 26 }}>
              <Tooltip title={d.hash}>
                <Tag style={{ fontSize: 10 }}>{d.hash.slice(0, 8)}</Tag>
              </Tooltip>
              <Tag style={{ fontSize: 10 }}>{`#${d.branch}`}</Tag>
              <Tag
                style={{ fontSize: 10 }}
                color={d.use === 'trusted' ? 'green' : d.use === 'reference' ? 'blue' : 'default'}>
                {d.use}
              </Tag>
              <Tag
                style={{ fontSize: 10 }}
                color={d.pushState.includes('只读') ? 'default' : 'blue'}>
                {d.pushState}
              </Tag>
              <Tag style={{ fontSize: 10 }} color={d.mirrorExists ? 'green' : 'orange'}>
                {d.mirrorExists ? '镜像就绪' : '镜像缺失'}
              </Tag>
            </div>
            {/* meta 行：remote / 上次推送 */}
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', paddingLeft: 26 }}>
              {d.remote}
              {d.lastPushAt ? ` · 上次推送 ${new Date(d.lastPushAt).toLocaleString()}` : ''}
            </div>
            {/* 同步状态行：上次同步结果（成功/失败+原因+时间） */}
            {d.lastSync && (
              <div
                style={{
                  fontSize: 10,
                  paddingLeft: 26,
                  color: d.lastSync.status === 'ok' ? 'var(--text-secondary)' : '#FF4D4F',
                }}>
                {d.lastSync.status === 'ok' ? '✓' : '✗'} 上次同步{' '}
                {new Date(d.lastSync.at).toLocaleString()} · {d.lastSync.message}
              </div>
            )}
            {/* 内容统计行：各域数据概况对比 */}
            {d.stats && (
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', paddingLeft: 26 }}>
                {d.stats.users} 用户 · {d.stats.projects} 项目 · {d.stats.specs} spec ·{' '}
                {d.stats.tasks} 任务
              </div>
            )}
            {(d.routes ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingLeft: 26 }}>
                {(d.routes ?? []).map((rule) => (
                  <Tag key={rule} style={{ fontSize: 10 }}>
                    {rule}
                  </Tag>
                ))}
              </div>
            )}
          </div>
        ))
      )}

      {/* 关联域 Modal */}
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
            <Select options={USE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name='routes'
            label='推送白名单（每行一条；留空 = 只读消费）'
            extra='"*" 全量；project:<glob> / user-spec:<glob> / global-spec:<glob>；支持 ! 排除'>
            <Input.TextArea rows={2} placeholder={'project:work-*\nuser-spec:commit-*.md'} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑域 Modal：label / use / routes 统一在此管理，卡片外部只读 */}
      <Modal
        title={`编辑域 · ${editing?.label ?? editing?.hash.slice(0, 8)}`}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={handleSaveEdit}
        confirmLoading={saving}
        okText='保存'
        cancelText='取消'
        destroyOnClose
        width={480}>
        <Form form={editForm} layout='vertical' size='small'>
          <Form.Item
            name='remote'
            label='仓库地址'
            extra='修改地址/分支 = 域身份变更：镜像重建、指纹重置，其余配置保留'
            rules={[{ required: true, message: '请输入域仓库 URL' }]}>
            <Input placeholder='https://github.com/team/lattice-pack.git' />
          </Form.Item>
          <Form.Item name='branch' label='分支'>
            <Input placeholder='main' />
          </Form.Item>
          <Form.Item name='label' label='备注名（纯本机显示）'>
            <Input placeholder='团队域' />
          </Form.Item>
          <Form.Item name='use' label='消费策略'>
            <Select options={USE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name='routes'
            label='推送白名单（每行一条；清空 = 只读消费）'
            extra='"*" 全量；project:<glob> / user-spec:<glob> / global-spec:<glob>；支持 ! 排除（如 user-spec:!secret-*.md）；保存后 ltc sync 推送生效'>
            <Input.TextArea
              rows={3}
              placeholder={'project:work-*\nuser-spec:commit-*.md'}
              onChange={(e) => setPreviewRoutes(e.target.value)}
            />
          </Form.Item>
          {/* dry-run 预览：实时显示「将推送什么」（不实际推送，保存前防误推） */}
          {previewQuery.data && (
            <div
              style={{
                fontSize: 10,
                color: 'var(--text-secondary)',
                padding: '4px 8px',
                background: 'var(--bg-tertiary)',
                borderRadius: 3,
                marginTop: -4,
                marginBottom: 8,
              }}>
              <b style={{ color: 'var(--brand-color)' }}>预览</b>：将上行 {previewQuery.data.copied}{' '}
              个文件
              {previewQuery.data.removed > 0 ? `、退出 ${previewQuery.data.removed} 个` : ''}
              {previewQuery.data.copied === 0 ? '（无匹配，只读消费）' : ''}
              {previewQuery.data.copied > 0 && previewQuery.data.copiedFiles.length > 0 && (
                <div style={{ marginTop: 2, fontFamily: 'monospace', opacity: 0.8 }}>
                  {previewQuery.data.copiedFiles.slice(0, 5).join('，')}
                  {previewQuery.data.copiedFiles.length > 5
                    ? ` …等 ${previewQuery.data.copied} 个`
                    : ''}
                </div>
              )}
            </div>
          )}
        </Form>
      </Modal>
    </div>
  );
});
