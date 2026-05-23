import type { ParsedSpec } from '../types';
import { parseSpec } from './io';
import { getGlobalSpecs, getUserSpecs, getProjectSpecs } from './cascade';

export interface SpecMatch {
  scope: 'project' | 'user' | 'global' | 'direct';
  spec: ParsedSpec;
}

export interface FindSpecOptions {
  /** 限定查找的层级 */
  scope?: 'project' | 'user' | 'global';
}

/**
 * 按文件名或相对路径在多层级中查找 spec。
 * 返回所有匹配（可能同名存在于多个层级），按优先级排列：project > user > global。
 * 如果 input 是绝对路径且可解析，直接返回 scope='direct'。
 */
export async function findSpecByName(
  username: string,
  projectId: string | null,
  input: string,
  opts?: FindSpecOptions,
): Promise<SpecMatch[]> {
  const matches: SpecMatch[] = [];

  // 尝试作为完整路径直接解析
  const directSpec = await parseSpec(input);
  if (directSpec) {
    matches.push({ scope: 'direct', spec: directSpec });
    return matches;
  }

  // 在各层级中查找
  const levels: { scope: 'project' | 'user' | 'global'; specs: ParsedSpec[] }[] = [];

  if ((!opts?.scope || opts.scope === 'project') && projectId) {
    levels.push({ scope: 'project', specs: await getProjectSpecs(username, projectId) });
  }
  if (!opts?.scope || opts.scope === 'user') {
    levels.push({ scope: 'user', specs: await getUserSpecs(username) });
  }
  if (!opts?.scope || opts.scope === 'global') {
    levels.push({ scope: 'global', specs: await getGlobalSpecs() });
  }

  for (const level of levels) {
    const match = level.specs.find((s) => s.relativePath === input || s.fileName === input);
    if (match) {
      matches.push({ scope: level.scope, spec: match });
    }
  }

  return matches;
}
