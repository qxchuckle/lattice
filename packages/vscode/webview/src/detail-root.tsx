import { useEffect } from 'react';
import { Button, Empty, Typography } from 'antd';
import { MemoryRouter } from 'react-router';
import { useSnapshot } from 'valtio';
import {
  DetailPanel,
  ErrorBoundary,
  closeDetail,
  detailStore,
  getAdapter,
  i18nT,
  selectNode,
  type SpecNodeData,
} from '@lattice-web-ui';

/**
 * 侧栏「详情」WebviewView 根组件：**点哪看哪**（任务 / 规范 / 项目），默认跟随活动任务。
 *
 * 路由约定（与图谱面板一致的事件通道）：
 * - `/task/<id>` · `/spec/<id>` · `/project/<id>` → 选中对应实体；
 * - `/detail`（或 `/task`、`/`）→ 清空（空态提示）。
 *
 * 注：DetailPanel 内部依赖 react-router 上下文（useNavigate 等），此处以 MemoryRouter 承载。
 */

export async function applyRoutePath(path: string): Promise<void> {
  if (!path) return;
  const match = /^\/(task|spec|project)\/([^/]+)$/.exec(path);
  if (!match) {
    if (path === '/task' || path === '/detail' || path === '/') closeDetail();
    return;
  }
  const kind = match[1] as 'task' | 'spec' | 'project';
  const id = decodeURIComponent(match[2]);
  if (kind === 'spec') {
    await selectSpec(id);
    return;
  }
  selectNode(id, kind);
}

/** 规范详情渲染依赖节点数据（图谱同源）：从快照行构造最小 SpecNodeData，读取失败时兜底。 */
async function selectSpec(id: string): Promise<void> {
  const adapter = getAdapter();
  let data: SpecNodeData = { entityType: 'spec', specId: id, title: id, scope: 'project' };
  try {
    const specs = await adapter.getSpecs();
    const all = [
      ...(specs?.project ?? []),
      ...(specs?.user ?? []),
      ...(specs?.global ?? []),
    ] as Array<{
      id?: string;
      fileName?: string;
      filePath?: string;
      title?: string;
      scope?: string;
    }>;
    const spec = all.find((row) => row.id === id || row.fileName === id || row.filePath === id);
    if (spec) {
      data = {
        entityType: 'spec',
        specId: spec.id ?? id,
        title: spec.title || spec.id || id,
        scope: spec.scope ?? 'project',
        filePath: spec.filePath,
      };
    }
  } catch {
    /* 兜底最小数据 */
  }
  selectNode(id, 'spec', data);
}

export function DetailRoot({ initialPath }: { initialPath?: string } = {}) {
  const { entityId } = useSnapshot(detailStore);

  useEffect(() => {
    const handler = (event: Event) =>
      void applyRoutePath((event as CustomEvent<string>).detail ?? '');
    window.addEventListener('lattice:route', handler);
    if (initialPath) void applyRoutePath(initialPath);
    return () => window.removeEventListener('lattice:route', handler);
  }, [initialPath]);

  if (!entityId) {
    const adapter = getAdapter();
    const canChooseTask = typeof adapter.executeCommand === 'function';
    return (
      <div style={{ padding: '32px 16px' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              {i18nT('暂无详情目标', 'Nothing selected')}
              <br />
              <Typography.Text type='secondary' style={{ fontSize: 12 }}>
                {i18nT(
                  '在侧栏点选任务、规范或项目；或开始一个任务（自动设为活动）',
                  'Pick a task, spec or project in the sidebar — or start a task (it becomes active)',
                )}
              </Typography.Text>
            </span>
          }
        />
        {canChooseTask && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Button
              type='primary'
              onClick={() => adapter.executeCommand?.('lattice.task.setActive')}>
              {i18nT('选择任务…', 'Choose a Task…')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <MemoryRouter initialEntries={['/']}>
      <ErrorBoundary>
        <div style={{ minHeight: '100vh' }}>
          <DetailPanel />
        </div>
      </ErrorBoundary>
    </MemoryRouter>
  );
}
