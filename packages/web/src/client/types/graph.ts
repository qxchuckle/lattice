import type { Node, Edge } from '@xyflow/react';

export type EntityType = 'task' | 'project' | 'spec';

export interface TaskNodeData {
  entityType: 'task';
  taskId: string;
  title: string;
  status: string;
  projectId?: string;
  projectIds?: string[];
  username?: string;
  [key: string]: unknown;
}

export interface ProjectNodeData {
  entityType: 'project';
  projectId: string;
  name: string;
  hasGit?: boolean;
  username?: string;
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
  [key: string]: unknown;
}

export type LatticeNodeData = TaskNodeData | ProjectNodeData | SpecNodeData;

export type LatticeNode = Node<LatticeNodeData>;
export type LatticeEdge = Edge<{ relationType?: string; label?: string }>;
