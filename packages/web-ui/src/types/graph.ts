import type { CSSProperties } from 'react';

export type EntityType = 'task' | 'project' | 'spec';

export interface TaskNodeData {
  entityType: 'task';
  taskId: string;
  title: string;
  status: string;
  projectId?: string;
  projectIds?: string[];
  username?: string;
  /** 来源域 hash（本地数据无此字段） */
  domain?: string;
  /** 来源域备注名（label，显示优先于 hash8） */
  domainLabel?: string;
  [key: string]: unknown;
}

export interface ProjectNodeData {
  entityType: 'project';
  projectId: string;
  name: string;
  hasGit?: boolean;
  username?: string;
  /** 来源域 hash（本地数据无此字段） */
  domain?: string;
  /** 来源域备注名（label，显示优先于 hash8） */
  domainLabel?: string;
  [key: string]: unknown;
}

export interface SpecNodeData {
  entityType: 'spec';
  specId: string;
  title: string;
  scope: string;
  projectId?: string;
  filePath?: string;
  username?: string;
  /** 来源域 hash（本地数据无此字段） */
  domain?: string;
  /** 来源域备注名（label，显示优先于 hash8） */
  domainLabel?: string;
  [key: string]: unknown;
}

export type LatticeNodeData = TaskNodeData | ProjectNodeData | SpecNodeData;

export interface LatticeNode {
  id: string;
  position: { x: number; y: number };
  data: LatticeNodeData;
  type?: string;
}

export interface LatticeEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  style?: CSSProperties;
  animated?: boolean;
  data?: { relationType?: string; label?: string };
}
