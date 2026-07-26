/**
 * SSE 进度事件（长操作通用：RAG 更新/重建等）
 */

export interface SseProgress {
  current: number;
  total: number;
  added?: number;
  updated?: number;
  removed?: number;
  skipped?: number;
  chunksProcessed?: number;
  currentFile?: string;
}

export interface SseDone {
  done: true;
  result?: Record<string, unknown>;
  error?: string;
}
