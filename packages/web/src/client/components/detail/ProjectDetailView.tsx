/**
 * ProjectDetailView — 项目详情视图
 *
 * 从 DetailPanel.tsx 拆分：项目标题、路径栏、Git 状态、
 * 关联任务/项目关系/Spec 板块 Tab。
 */
import { Empty, Tag, List, Tabs, Tooltip } from 'antd';
import { WarningOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type {
  ProjectMeta,
  GitStatus,
  ParsedSpec,
  TaskMeta,
  ProjectRelation,
} from '@qcqx/lattice-core';
import { getAdapter } from '../../adapters';
import { getViewPath } from '../../store';
import { formatDate, getProjectId, truncate } from '../../lib';
import { ProjectPathBar } from './FilePathBar';
import { SearchFilterBar, RelatedTasksTab, ProjectRelationsTab } from './shared';

export function ProjectDetailView({
  project,
  gitStatus,
  specs,
  tasks,
  relations,
}: {
  project: ProjectMeta | null;
  gitStatus: GitStatus | null;
  specs: ParsedSpec[];
  tasks: TaskMeta[];
  relations: ProjectRelation[];
}) {
  const navigate = useNavigate();
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => getAdapter().getProjects(),
    staleTime: 60_000,
  });
  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsQuery.data || []) {
      map.set(getProjectId(p), p.name);
    }
    return map;
  }, [projectsQuery.data]);
  if (!project) {
    return <Empty description='项目不存在' image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div className='detail-component'>
      <h3 className='detail-component__title'>{project.name}</h3>

      {project.description && (
        <p className='detail-component__meta' style={{ marginBottom: 8 }}>
          {project.description}
        </p>
      )}

      <ProjectPathBar projectId={getProjectId(project)} />

      <div className='detail-component__meta'>
        <div className='mono detail-component__meta-id'>ID: {getProjectId(project)}</div>
        <div>创建: {formatDate(project.created)}</div>
        {project.groups && project.groups.length > 0 && (
          <div>分组: {project.groups.join(', ')}</div>
        )}
        {project.tags && project.tags.length > 0 && <div>标签: {project.tags.join(', ')}</div>}
      </div>

      <div className='detail-component__scroll'>
        <Tabs
          size='small'
          className='detail-component__tabs'
          items={[
            ...(gitStatus
              ? [
                  {
                    key: 'git',
                    label: 'Git 状态',
                    children: (
                      <div className='git-status'>
                        <div>
                          <span className='git-status__label'>分支: </span>
                          <span className='mono'>{gitStatus.branch || '-'}</span>
                          {gitStatus.dirty ? (
                            <Tag color='orange' style={{ marginLeft: 8, fontSize: 10 }}>
                              <WarningOutlined /> {gitStatus.uncommittedCount} 未提交
                            </Tag>
                          ) : (
                            <Tag color='green' style={{ marginLeft: 8, fontSize: 10 }}>
                              <CheckCircleOutlined /> 干净
                            </Tag>
                          )}
                        </div>
                        {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                          <div>
                            <span className='git-status__label'>远程: </span>
                            {gitStatus.ahead > 0 && (
                              <Tag color='green' style={{ fontSize: 10 }}>
                                ↑{gitStatus.ahead}
                              </Tag>
                            )}
                            {gitStatus.behind > 0 && (
                              <Tag color='orange' style={{ fontSize: 10 }}>
                                ↓{gitStatus.behind}
                              </Tag>
                            )}
                          </div>
                        )}
                        {gitStatus.lastCommitMessage && (
                          <Tooltip
                            title={
                              gitStatus.lastCommitTime ? formatDate(gitStatus.lastCommitTime) : ''
                            }>
                            <div className='git-status__commit'>
                              <span className='git-status__label'>最近: </span>
                              {gitStatus.lastCommitMessage}
                            </div>
                          </Tooltip>
                        )}
                      </div>
                    ),
                  },
                ]
              : []),
            ...(tasks && tasks.length > 0
              ? [
                  {
                    key: 'tasks',
                    label: `关联任务 (${tasks.length})`,
                    children: (
                      <RelatedTasksTab
                        tasks={tasks}
                        projectId={getProjectId(project)}
                        navigate={navigate}
                      />
                    ),
                  },
                ]
              : []),
            ...(relations && relations.length > 0
              ? [
                  {
                    key: 'relations',
                    label: `项目关系 (${relations.length})`,
                    children: (
                      <ProjectRelationsTab
                        relations={relations}
                        currentProjectId={getProjectId(project)}
                        projectNameMap={projectNameMap}
                        navigate={navigate}
                      />
                    ),
                  },
                ]
              : []),
            ...(specs && specs.length > 0
              ? [
                  {
                    key: 'specs',
                    label: `Spec (${specs.length})`,
                    children: (
                      <SearchFilterBar
                        items={specs}
                        placeholder='搜索 Spec...'
                        getSearchText={(s: ParsedSpec) => s.frontmatter.title || s.fileName}>
                        {(filtered) =>
                          filtered.length > 0 ? (
                            <List
                              size='small'
                              dataSource={filtered}
                              renderItem={(s: ParsedSpec) => (
                                <List.Item
                                  className='detail-list-item'
                                  onClick={() =>
                                    navigate(getViewPath('spec', s.frontmatter.id || s.fileName))
                                  }>
                                  <div>
                                    <span>{truncate(s.frontmatter.title || s.fileName, 30)}</span>
                                    {s.frontmatter.tags && s.frontmatter.tags.length > 0 && (
                                      <div className='spec-tags'>
                                        {s.frontmatter.tags.slice(0, 3).map((tag: string) => (
                                          <Tag key={tag}>{tag}</Tag>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </List.Item>
                              )}
                            />
                          ) : (
                            <Empty description='无匹配 Spec' image={Empty.PRESENTED_IMAGE_SIMPLE} />
                          )
                        }
                      </SearchFilterBar>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </div>
  );
}
