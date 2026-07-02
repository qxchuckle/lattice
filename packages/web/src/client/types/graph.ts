import type { Node, Edge } from '@xyflow/react';

export type EntityType = 'task' | 'project' | 'spec' | 'checkpoint' | 'document';

export interface TaskNodeData {
  entityType: 'task';
  taskId: string;
  title: string;
  status: string;
  projectId?: string;
  [key: string]: unknown;
}

export interface ProjectNodeData {
  entityType: 'project';
  projectId: string;
  name: string;
  hasGit?: boolean;
  [key: string]: unknown;
}

export interface SpecNodeData {
  entityType: 'spec';
  specId: string;
  title: string;
  scope: string;
  [key: string]: unknown;
}

export interface CheckpointNodeData {
  entityType: 'checkpoint';
  checkpointId: string;
  title: string;
  checkpointType: string;
  taskId: string;
  [key: string]: unknown;
}

export interface DocumentNodeData {
  entityType: 'document';
  /** 文档类型：prd / design / progress */
  docType: string;
  /** 关联的任务 ID */
  taskId: string;
  title: string;
  [key: string]: unknown;
}

export type LatticeNodeData =
  | TaskNodeData
  | ProjectNodeData
  | SpecNodeData
  | CheckpointNodeData
  | DocumentNodeData;

export type LatticeNode = Node<LatticeNodeData>;
export type LatticeEdge = Edge<{ relationType?: string; label?: string }>;
