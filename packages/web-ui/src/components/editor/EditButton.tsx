import { lazy, Suspense, useState } from 'react';
import { Button } from 'antd';
import { EditOutlined, EyeOutlined } from '@ant-design/icons';
import { getAdapter } from '../../adapters';
import { isWebviewHost } from '../../host-mode';

/**
 * 文档编辑按钮（按需加载的编辑器入口）。
 *
 * - webview 宿主：直接调 adapter.openPath 打开**原生编辑器**，不加载弹窗与 CodeMirror；
 * - web 宿主：点击后才懒加载 DocumentEditorModal（CodeMirror 等重依赖随 chunk 按需进入）。
 */
const DocumentEditorModal = lazy(() =>
  import('./DocumentEditorModal').then((module) => ({ default: module.DocumentEditorModal })),
);

export function EditButton({
  contentType,
  entityId,
  title,
  isYaml,
  size = 'small',
  readOnly = false,
}: {
  contentType: string;
  entityId: string;
  title: string;
  isYaml?: boolean;
  size?: 'small' | 'middle';
  /** 域数据：按钮变「查看」，弹窗只读无保存 */
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size}
        type='text'
        icon={readOnly ? <EyeOutlined /> : <EditOutlined />}
        onClick={() => {
          // VSCode Webview：容器能力由 adapter 承担（打开原生编辑器即 openPath 的一种宿主实现）
          if (isWebviewHost()) {
            void getAdapter().openPath(contentType, entityId, 'vscode');
            return;
          }
          setOpen(true);
        }}>
        {readOnly ? '查看详情' : '编辑'}
      </Button>
      {open && (
        <Suspense fallback={null}>
          <DocumentEditorModal
            open={open}
            onClose={() => setOpen(false)}
            contentType={contentType}
            entityId={entityId}
            title={title}
            isYaml={isYaml}
            readOnly={readOnly}
          />
        </Suspense>
      )}
    </>
  );
}
