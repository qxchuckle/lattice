/**
 * FilePathBar — 文件路径栏 + 项目路径栏
 *
 * 从 DetailPanel.tsx 拆分：显示实体文件路径，支持复制、用编辑器打开、终端打开。
 * ProjectPathBar 处理多本地路径的项目。
 */
import { Button, Dropdown, Tooltip, Modal, Radio, App as AntdApp } from 'antd';
import { FolderOpenOutlined, DownOutlined, CopyOutlined, CodeOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '../../adapters';
import type { EditorApp } from '../../adapters/types';
import { apiGet } from '../../lib';
import { openTerminal } from '../../store';

export const editorMenuItems = [
  { key: 'finder', label: '系统文件管理器' },
  { key: 'vscode', label: 'VSCode' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'qoder', label: 'Qoder' },
];

// ── 文件路径获取 hook ──

function useFilePath(pathType: string | null | undefined, id: string | null | undefined) {
  return useQuery({
    queryKey: ['path', pathType, id],
    queryFn: async () => {
      if (!pathType || !id) return null;
      const data = await apiGet<{ path?: string; error?: string }>(`/api/paths/${pathType}/${id}`);
      return data.path || null;
    },
    enabled: !!pathType && !!id,
    staleTime: 60_000,
  });
}

// ── 文件路径栏组件 ──

export function FilePathBar({
  path,
  pathType,
  entityId,
}: {
  path?: string | null;
  pathType?: string | null;
  entityId?: string | null;
}) {
  const { message } = AntdApp.useApp();
  const pathQuery = useFilePath(path ? null : pathType, path ? null : entityId);
  const finalPath = path ?? pathQuery.data ?? null;

  if (!finalPath && pathQuery.isLoading) {
    return (
      <div className='file-path-bar'>
        <span className='mono file-path-bar__text' style={{ color: 'var(--text-secondary)' }}>
          加载路径中...
        </span>
      </div>
    );
  }

  if (!finalPath) return null;

  const handleOpen = async (app: EditorApp) => {
    const adapter = getAdapter();
    const success = await adapter.openPathByPath(finalPath, app);
    if (!success) {
      message.warning(`无法用 ${app} 打开`);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(finalPath).then(() => {
      message.success('已复制路径');
    });
  };

  return (
    <div className='file-path-bar'>
      <span className='mono file-path-bar__text' title={finalPath}>
        {finalPath}
      </span>
      <Button size='small' type='text' icon={<CopyOutlined />} onClick={handleCopy} />
      <Dropdown.Button
        size='small'
        type='text'
        icon={<DownOutlined />}
        onClick={() => handleOpen('finder')}
        menu={{
          items: editorMenuItems,
          onClick: ({ key }) => handleOpen(key as EditorApp),
        }}>
        <FolderOpenOutlined />
      </Dropdown.Button>
      <Tooltip title='在内置终端打开'>
        <Button
          size='small'
          type='text'
          icon={<CodeOutlined />}
          onClick={() => openTerminal(finalPath)}
        />
      </Tooltip>
    </div>
  );
}

// ── 项目本地路径栏组件 ──

export function ProjectPathBar({ projectId }: { projectId: string }) {
  const { message } = AntdApp.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState<EditorApp>('finder');

  const pathsQuery = useQuery({
    queryKey: ['project-local-paths', projectId],
    queryFn: async () => {
      const data = await apiGet<{ paths?: string[]; error?: string }>(
        `/api/projects/${encodeURIComponent(projectId)}/local-paths`,
      );
      return data.paths || [];
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const paths = pathsQuery.data || [];
  if (paths.length === 0) return null;

  if (paths.length === 1) {
    return <FilePathBar path={paths[0]} />;
  }

  const handleOpen = async (path: string, app: EditorApp) => {
    const adapter = getAdapter();
    const success = await adapter.openPathByPath(path, app);
    if (!success) {
      message.warning(`无法用 ${app} 打开`);
    }
    setModalOpen(false);
  };

  return (
    <>
      <div className='project-path-bar'>
        <span className='project-path-bar__text'>{paths.length} 个本地路径</span>
        <Dropdown.Button
          size='small'
          type='text'
          icon={<DownOutlined />}
          onClick={() => {
            setSelectedApp('finder');
            setModalOpen(true);
          }}
          menu={{
            items: editorMenuItems,
            onClick: ({ key }) => {
              setSelectedApp(key as EditorApp);
              setModalOpen(true);
            },
          }}>
          <FolderOpenOutlined /> 打开
        </Dropdown.Button>
      </div>
      <Modal
        title='选择要打开的路径'
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={600}>
        <Radio.Group
          style={{ width: '100%' }}
          onChange={(e) => {
            const path = e.target.value;
            handleOpen(path, selectedApp);
          }}>
          {paths.map((p) => (
            <Radio key={p} value={p} className='path-radio'>
              <span className='mono'>{p}</span>
            </Radio>
          ))}
        </Radio.Group>
      </Modal>
    </>
  );
}
