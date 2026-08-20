import type { ParsedSpec, TaskMeta, ProjectMeta, SyncDomainConfig } from '../types';

/**
 * 统一数据源 Provider（方案 B：新增层 + 出口替换）。
 *
 * 上层（search/context/rag/spec/task/project 出口）只依赖本层，
 * 不感知下面有几个源；内部管理通道（doctor/migrate/写前读改写）
 * 继续直连既有读函数（LocalSource 的底座），两通道靠模块边界区分。
 *
 * 双视图（use 档位语义）：
 *   knowledgeView  = 全部 use != off 的域 —— 检索出口（search/show/list/rag）
 *   constraintView = 仅 use = trusted 的域 —— 约束注入出口（cascade/context）
 */

/** 数据源标识：'local' 或域 hash */
export type SourceId = 'local' | string;

export interface SpecView {
  spec: ParsedSpec;
  source: SourceId;
  /** spec 层级：project 命名空间含用户名+项目目录 */
  scope: 'global' | 'user' | 'project';
  /** 所属用户（全局级为 undefined） */
  username?: string;
  /** 项目级 spec 的项目契约 ID（目录名解码） */
  contractId?: string;
  /** 镜像内相对路径（跨源身份键） */
  namespace: string;
}

export interface TaskView {
  task: TaskMeta;
  source: SourceId;
  username: string;
}

export interface ProjectView {
  project: ProjectMeta;
  source: SourceId;
  username: string;
  /** 契约 ID（ids 推导；无衍生 ID 为 null） */
  contractId: string | null;
}

/** 数据源适配器接口（按领域隔离的最小面） */
export interface DataSource {
  readonly id: SourceId;
  readonly kind: 'local' | 'domain';
  /** use 档位（local 恒为 trusted 语义） */
  readonly use: 'trusted' | 'reference' | 'off';
  /** 域镜像根目录（仅域源；RAG 文档收集等需要直接读镜像文件时用） */
  readonly mirrorDir?: string;
  listSpecs(): Promise<SpecView[]>;
  listTasks(): Promise<TaskView[]>;
  listProjects(): Promise<ProjectView[]>;
}

/** 域源构造输入 */
export interface DomainSourceInput {
  domain: SyncDomainConfig;
  domainHash: string;
  mirrorDir: string;
}

/** 来源标注（本地无感、域显示 hash8/label） */
export function sourceLabel(source: SourceId, labels?: Map<string, string>): string {
  if (source === 'local') return '';
  const label = labels?.get(source);
  return label ? `${label}(${source.slice(0, 8)})` : `域 ${source.slice(0, 8)}`;
}
