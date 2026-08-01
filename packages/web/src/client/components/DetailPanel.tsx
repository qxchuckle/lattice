/**
 * DetailPanel — 详情面板主组件（精简编排器）
 *
 * 批次四重构：从 1677 行拆为子组件 + hook
 *   MarkdownWithToc / FilePathBar / TaskDetailView /
 *   ProjectDetailView / SpecDetailView + useDetailPanel hook
 *
 * 本文件仅做路由分发：根据 entityType 委托对应子视图渲染。
 */
import { memo } from 'react';
import { Skeleton, Empty, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useDetailPanel } from '../hooks/useDetailPanel';
import { DetailHeader } from './detail/shared';
import { TaskDetailView } from './detail/TaskDetailView';
import { ProjectDetailView } from './detail/ProjectDetailView';
import { SpecDetailView } from './detail/SpecDetailView';
import './DetailPanel.less';

export const DetailPanel = memo(function DetailPanel() {
  const { entityId, entityType, entityData, isLoading, isError, data, refetch } = useDetailPanel();

  // spec 直接从节点 data 渲染
  if (entityType === 'spec' && entityData && entityData.entityType === 'spec') {
    return (
      <div className='detail-panel-root'>
        <DetailHeader entityId={entityId} entityType={entityType} />
        <div className='detail-panel-content'>
          <SpecDetailView data={entityData} />
        </div>
      </div>
    );
  }

  if (!entityId || !entityType) {
    return (
      <div className='detail-empty'>
        <Empty description='选择一个节点查看详情' image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className='detail-loading'>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className='detail-error'>
        <Empty description='加载失败' image={Empty.PRESENTED_IMAGE_SIMPLE} />
        <Button size='small' icon={<ReloadOutlined />} onClick={() => refetch()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className='detail-panel-root'>
      <DetailHeader entityId={entityId} entityType={entityType} />
      <div className='detail-panel-content'>
        {data.type === 'task' && data.task && (
          <TaskDetailView task={data.task} progress={data.progress} />
        )}
        {data.type === 'project' && (
          <ProjectDetailView
            project={data.project}
            gitStatus={data.gitStatus}
            specs={data.specs}
            tasks={data.tasks}
            relations={data.relations}
          />
        )}
      </div>
    </div>
  );
});
