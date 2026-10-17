import { FSWatcher, watch } from 'node:fs';
import * as path from 'node:path';
import type { SnapshotSection } from './snapshot';

export interface LatticeWatcherOptions {
  root: string;
  debounceMs?: number;
  onChanges: (sections: Set<SnapshotSection>) => void;
  onError?: (error: Error) => void;
}

/**
 * 路径 → 快照分区映射（导出供单测）。
 * 排除 .cache（db 高频写）与 .sync-domains（git 镜像 churn）。
 */
export function classifyLatticePath(root: string, changedPath: string): SnapshotSection[] {
  const rel = path.relative(root, changedPath).split(path.sep).join('/');
  if (rel === '' || rel.startsWith('..')) return [];
  if (rel.startsWith('.cache')) return [];
  if (rel.startsWith('.sync-domains')) return [];
  if (rel.startsWith('users/') || rel === 'users') {
    const rest = rel.slice('users/'.length);
    const parts = rest.split('/');
    if (parts.length < 2) return ['tasks', 'specs', 'projects'];
    const afterUser = parts.slice(1).join('/');
    if (afterUser.startsWith('tasks/')) return ['tasks'];
    if (afterUser.startsWith('fast-tasks/')) return [];
    if (afterUser.startsWith('spec/')) return ['specs'];
    if (afterUser.startsWith('projects/')) {
      if (afterUser.includes('/spec/') || afterUser.endsWith('/spec')) return ['specs', 'projects'];
      return ['projects'];
    }
    return [];
  }
  if (rel === 'spec' || rel.startsWith('spec/')) return ['specs'];
  if (rel.startsWith('.trash')) return ['tasks', 'projects', 'specs'];
  if (rel.startsWith('config')) return ['user', 'projects', 'tasks', 'specs'];
  return [];
}

/** ~/.lattice 文件监听：node fs.watch（recursive）+ 去抖合并；不可用时由调用方降级轮询。 */
export class LatticeWatcher {
  private watchers: FSWatcher[] = [];
  private pending = new Set<SnapshotSection>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;

  constructor(private readonly options: LatticeWatcherOptions) {}

  get healthy(): boolean {
    return this.watchers.length > 0;
  }

  start(): void {
    if (this.started) return;
    const { root } = this.options;
    const failures: Error[] = [];
    const targets: Array<[string, { recursive: boolean }]> = [
      [root, { recursive: false }],
      [path.join(root, 'users'), { recursive: true }],
      [path.join(root, 'spec'), { recursive: true }],
      [path.join(root, '.trash'), { recursive: true }],
    ];
    for (const [target, watchOptions] of targets) {
      try {
        const watcher = watch(target, watchOptions, (_event, filename) => {
          const changed = filename ? path.join(target, filename.toString()) : target;
          this.handleChange(changed);
        });
        watcher.on('error', (error) => {
          this.options.onError?.(error as Error);
        });
        this.watchers.push(watcher);
      } catch (error) {
        failures.push(error as Error);
      }
    }
    // 全部目标失败才算启动失败（允许后续重试）；部分失败（如 .trash 不存在）不算。
    const allFailed = this.watchers.length === 0 && failures.length > 0;
    this.started = !allFailed;
    if (failures.length > 0) {
      this.options.onError?.(failures[0]);
    }
  }

  private handleChange(changedPath: string): void {
    const sections = classifyLatticePath(this.options.root, changedPath);
    if (sections.length === 0) return;
    for (const section of sections) this.pending.add(section);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), Math.max(50, this.options.debounceMs ?? 400));
  }

  private flush(): void {
    this.timer = undefined;
    if (this.pending.size === 0) return;
    const batch = new Set(this.pending);
    this.pending.clear();
    this.options.onChanges(batch);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
    this.started = false;
  }
}
