/**
 * Pi 资源枚举（源层私有：经 SDK DefaultResourceLoader 发现 command/skill/rule）
 *
 * 工厂负责 TTL 缓存与 kinds 过滤，这里只管枚举。
 */
import { basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { SourceResourceInfo, SourceResourceQuery } from '@qcqx/lattice-agent-protocol';

/** SDK 惰性加载（与 driver 主体共用同一模式，避免测试 mock 失效） */
function loadSdk() {
  return import('@earendil-works/pi-coding-agent');
}

/**
 * prompt 模板→command / skills→skill / AGENTS.md→rule。
 * noExtensions：枚举不执行插件代码（extension 命令需运行时注册，不在静态发现范围）。
 */
export async function scanPiResources(query?: SourceResourceQuery): Promise<SourceResourceInfo[]> {
  const cwd = resolve(query?.cwd ?? homedir());
  const { DefaultResourceLoader, getAgentDir } = await loadSdk();
  const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), noExtensions: true });
  await loader.reload();

  const agentDir = resolve(getAgentDir());
  const scopeOf = (p: string): SourceResourceInfo['scope'] =>
    resolve(p).startsWith(agentDir) ? 'user' : 'project';

  const resources: SourceResourceInfo[] = [];
  for (const p of loader.getPrompts().prompts) {
    resources.push({
      kind: 'command',
      name: p.name,
      description: p.description,
      ...(p.argumentHint ? { argumentHint: p.argumentHint } : {}),
      scope: scopeOf(p.filePath),
      path: p.filePath,
    });
  }
  for (const s of loader.getSkills().skills) {
    resources.push({
      kind: 'skill',
      name: s.name,
      description: s.description,
      scope: scopeOf(s.filePath),
      path: s.filePath,
    });
  }
  for (const f of loader.getAgentsFiles().agentsFiles) {
    resources.push({
      kind: 'rule',
      name: basename(f.path),
      scope: scopeOf(f.path),
      path: f.path,
    });
  }
  return resources;
}
