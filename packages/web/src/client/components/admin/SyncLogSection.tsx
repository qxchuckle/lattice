import { memo, useState, useCallback, useEffect } from 'react';
import { Button, Tag, Select, Empty, Spin, Tooltip, Pagination } from 'antd';
import { ReloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../../lib';

/**
 * 同步日志（JSONL）：core 写入 ~/.lattice/.cache/sync-log/<target>.jsonl，
 * 此处聚合展示（origin 主数据 + 各域），带目标筛选与刷新。
 */

interface SyncLogEntry {
  at: string;
  target: string;
  action:
    | 'join'
    | 'unlink'
    | 'reorder'
    | 'route-update'
    | 'pull'
    | 'push'
    | 'conflict'
    | 'enable-git'
    | 'commit';
  status: 'ok' | 'error' | 'skip';
  message: string;
  detail?: Record<string, unknown>;
}

const ACTION_LABEL: Record<string, string> = {
  join: '关联',
  unlink: '解除',
  reorder: '排序',
  'route-update': '规则',
  pull: '拉取',
  push: '推送',
  conflict: '冲突',
  'enable-git': '启用',
  commit: '提交',
};

const ACTION_COLOR: Record<string, string> = {
  join: 'blue',
  unlink: 'red',
  reorder: 'purple',
  'route-update': 'cyan',
  pull: 'geekblue',
  push: 'green',
  conflict: 'orange',
  'enable-git': 'blue',
  commit: 'default',
};

/** 详情分区渲染数据（审计明细：统计/目标/文件清单/冲突） */
function detailSections(e: SyncLogEntry): Array<{ key: string; label: string; items: string[] }> {
  const d = e.detail ?? {};
  const sections: Array<{ key: string; label: string; items: string[] }> = [];
  const stats: string[] = [];
  if (d.copied !== undefined) stats.push(`上行 ${d.copied} 个文件`);
  if (d.removed !== undefined) stats.push(`退出 ${d.removed} 个文件`);
  if (d.users !== undefined) stats.push(`${d.users} 用户`);
  if (d.projects !== undefined) stats.push(`${d.projects} 项目`);
  if (d.specs !== undefined) stats.push(`${d.specs} spec`);
  if (Array.isArray(d.globalSpecs) && d.globalSpecs.length)
    stats.push(`全局 spec：${(d.globalSpecs as string[]).join('、')}`);
  if (stats.length) sections.push({ key: 'stats', label: '统计', items: stats });
  if (d.remote) sections.push({ key: 'remote', label: '目标', items: [String(d.remote)] });
  if (Array.isArray(d.changedFiles) && d.changedFiles.length)
    sections.push({
      key: 'changedFiles',
      label: `拉取变更（${(d.changedFiles as string[]).length}）`,
      items: (d.changedFiles as string[]).map(String),
    });
  if (Array.isArray(d.copiedFiles) && d.copiedFiles.length)
    sections.push({
      key: 'copiedFiles',
      label: `上行清单（${(d.copiedFiles as string[]).length}）`,
      items: (d.copiedFiles as string[]).map(String),
    });
  if (Array.isArray(d.removedFiles) && d.removedFiles.length)
    sections.push({
      key: 'removedFiles',
      label: `退出清单（${(d.removedFiles as string[]).length}）`,
      items: (d.removedFiles as string[]).map(String),
    });
  if (Array.isArray(d.conflicts) && d.conflicts.length)
    sections.push({
      key: 'conflicts',
      label: `冲突（${(d.conflicts as string[]).length}）`,
      items: (d.conflicts as string[]).map(String),
    });
  return sections;
}

export const SyncLogSection = memo(function SyncLogSection({
  domainOptions,
}: {
  /** 域下拉选项（hash + label），由 GitSyncTab 传入 */
  domainOptions: Array<{ value: string; label: string }>;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState('all');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['sync-logs', target],
    queryFn: async (): Promise<SyncLogEntry[]> => {
      const r = await apiGet<{ entries: SyncLogEntry[] }>(
        `/api/git/sync-logs?target=${encodeURIComponent(target)}&limit=500`,
      );
      return r.entries;
    },
    staleTime: 5_000,
  });

  // 切换目标或页大小后回到第一页并收起展开态
  useEffect(() => {
    setPage(1);
    setExpandedKey(null);
  }, [target, pageSize]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
  }, [queryClient]);

  const all = data ?? [];
  const entries = all.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <FileTextOutlined style={{ fontSize: 11 }} />
        <span style={{ fontWeight: 600, fontSize: 12 }}>同步日志</span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>JSONL</span>
        <div style={{ flex: 1 }} />
        <Select
          size='small'
          value={target}
          onChange={setTarget}
          style={{ width: 180 }}
          options={[{ value: 'all', label: '全部目标' }, ...domainOptions]}
        />
        <Button size='small' icon={<ReloadOutlined />} loading={isFetching} onClick={refresh}>
          刷新
        </Button>
      </div>
      {isLoading ? (
        <div style={{ padding: 16, textAlign: 'center' }}>
          <Spin size='small' />
        </div>
      ) : entries.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ fontSize: 11 }}>暂无同步日志（执行域同步 / Git 操作后产生）</span>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {entries.map((e, i) => {
            const rowKey = `${e.at}-${i}`;
            const expanded = expandedKey === rowKey;
            const sections = detailSections(e);
            const expandable = sections.length > 0;
            return (
              <div
                key={rowKey}
                style={{
                  borderRadius: 3,
                  background: i % 2 === 0 ? 'var(--bg-secondary)' : undefined,
                }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'baseline',
                    fontSize: 10,
                    padding: '2px 4px',
                    cursor: expandable ? 'pointer' : 'default',
                    userSelect: expandable ? 'none' : undefined,
                  }}
                  onClick={() => expandable && setExpandedKey(expanded ? null : rowKey)}>
                  <span
                    style={{
                      color: 'var(--text-secondary)',
                      flexShrink: 0,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                    {new Date(e.at).toLocaleString()}
                  </span>
                  <Tooltip title={e.target}>
                    <Tag
                      style={{
                        fontSize: 9,
                        margin: 0,
                        lineHeight: '14px',
                        padding: '0 3px',
                        flexShrink: 0,
                      }}>
                      {e.target === 'origin' ? 'origin' : e.target.slice(0, 8)}
                    </Tag>
                  </Tooltip>
                  <Tag
                    color={ACTION_COLOR[e.action]}
                    style={{
                      fontSize: 9,
                      margin: 0,
                      lineHeight: '14px',
                      padding: '0 3px',
                      flexShrink: 0,
                    }}>
                    {ACTION_LABEL[e.action] ?? e.action}
                  </Tag>
                  <span
                    style={{
                      color: e.status === 'error' ? '#FF4D4F' : 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}>
                    {e.status === 'error' ? '✗ ' : e.status === 'skip' ? '− ' : '✓ '}
                    {e.message}
                  </span>
                  {expandable && (
                    <span style={{ color: 'var(--text-secondary)', flexShrink: 0, fontSize: 9 }}>
                      {expanded ? '▴ 收起' : '▾ 详情'}
                    </span>
                  )}
                </div>
                {expanded && sections.length > 0 && (
                  <div
                    style={{
                      margin: '2px 4px 4px 120px',
                      padding: '4px 8px',
                      borderRadius: 3,
                      borderLeft: '2px solid var(--brand-color)',
                      background: 'var(--bg-tertiary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}>
                    {sections.map((sec) => (
                      <div key={sec.key}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
                          {sec.label}
                        </div>
                        <div
                          style={{
                            fontSize: 9,
                            fontFamily: 'monospace',
                            color: 'var(--text)',
                            maxHeight: 120,
                            overflow: 'auto',
                          }}>
                          {sec.items.map((item, j) => (
                            <div key={j}>{item}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {all.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Pagination
            size='small'
            current={page}
            pageSize={pageSize}
            total={all.length}
            showSizeChanger
            showTotal={(t) => `共 ${t} 条`}
            pageSizeOptions={[10, 20, 50, 100]}
            onChange={(p, ps) => {
              setPage(p);
              setPageSize(ps);
              setExpandedKey(null);
            }}
          />
        </div>
      )}
    </div>
  );
});
