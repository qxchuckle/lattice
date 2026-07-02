import { Type, type Static } from '@sinclair/typebox';

// ── 查询参数 schema ──

export const TaskQuerySchema = Type.Object({
  status: Type.Optional(Type.String()),
  projectId: Type.Optional(Type.String()),
  allUser: Type.Optional(Type.Boolean()),
});

export const SearchQuerySchema = Type.Object({
  q: Type.String(),
  type: Type.Optional(Type.String()),
  projectId: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
});

export const OpenQuerySchema = Type.Object({
  path: Type.String(),
  app: Type.Union([
    Type.Literal('vscode'),
    Type.Literal('cursor'),
    Type.Literal('qoder'),
    Type.Literal('finder'),
  ]),
});

// ── 路径参数 schema ──

export const IdParamSchema = Type.Object({
  id: Type.String(),
});

export const TaskIdParamSchema = Type.Object({
  taskId: Type.String(),
});

// ── 响应 schema ──

export const ErrorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
});

// ── 类型导出 ──

export type TaskQuery = Static<typeof TaskQuerySchema>;
export type SearchQuery = Static<typeof SearchQuerySchema>;
export type OpenQuery = Static<typeof OpenQuerySchema>;
