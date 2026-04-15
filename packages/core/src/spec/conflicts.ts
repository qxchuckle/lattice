import type { SpecConflict, ParsedSpec } from '../types';
import { getGlobalSpecs, getUserSpecs, getProjectSpecs } from './cascade';

/**
 * 检测三层 spec 中的同相对路径文件冲突
 */
export async function detectSpecConflicts(
  username: string,
  projectId: string,
): Promise<SpecConflict[]> {
  const [globalSpecs, userSpecs, projectSpecs] = await Promise.all([
    getGlobalSpecs(),
    getUserSpecs(username),
    getProjectSpecs(username, projectId),
  ]);

  const relativePathMap = new Map<
    string,
    { scope: 'project' | 'user' | 'global'; spec: ParsedSpec }[]
  >();

  const addSpecs = (specs: ParsedSpec[], scope: 'project' | 'user' | 'global') => {
    for (const spec of specs) {
      const existing = relativePathMap.get(spec.relativePath) ?? [];
      existing.push({ scope, spec });
      relativePathMap.set(spec.relativePath, existing);
    }
  };

  addSpecs(globalSpecs, 'global');
  addSpecs(userSpecs, 'user');
  addSpecs(projectSpecs, 'project');

  const conflicts: SpecConflict[] = [];

  for (const [relativePath, entries] of relativePathMap) {
    if (entries.length > 1) {
      conflicts.push({
        fileName: relativePath,
        levels: entries.map((e) => ({
          scope: e.scope,
          filePath: e.spec.filePath,
          snippet: e.spec.content.slice(0, 100) + (e.spec.content.length > 100 ? '...' : ''),
        })),
      });
    }
  }

  return conflicts;
}
