/** 维护域：RAG 状态/索引、doctor（调用方负责 initDb）。 */
import {
  CORE_VERSION,
  forceRebuildIndex,
  getRAGStatus,
  runDoctorCheck,
  updateRagIndex,
} from '@qcqx/lattice-core';
import type { DoctorReport, IndexProgressCallback, RAGStatus } from '@qcqx/lattice-core';

export async function getRagStatus(): Promise<RAGStatus> {
  return getRAGStatus();
}

export async function runDoctor(
  opts: { fix?: boolean; cliVersion?: string } = {},
): Promise<DoctorReport> {
  return runDoctorCheck({ fix: opts.fix, cliVersion: opts.cliVersion ?? CORE_VERSION });
}

/** RAG 增量更新 / 全量重建；返回处理的文档总数。 */
export async function updateRag(
  action: 'update' | 'rebuild',
  onProgress?: IndexProgressCallback,
): Promise<number> {
  if (action === 'rebuild') return forceRebuildIndex(onProgress);
  const result = await updateRagIndex(onProgress);
  return result.total;
}
