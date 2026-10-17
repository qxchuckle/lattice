import * as vscode from 'vscode';
import * as path from 'node:path';
import { LatticeDataService } from '../data/service';
import { SnapshotStore } from '../state/snapshot';
import { readLatticeId } from '../util/paths';
import { t } from '../t';

interface LensCacheEntry {
  at: number;
  commands: vscode.Command[];
}

/** lattice.json 顶部 CodeLens：项目身份 / 未注册引导 ltc link。 */
export class LatticeJsonCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  private readonly cache = new Map<string, LensCacheEntry>();
  private readonly inflight = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly data: LatticeDataService,
    private readonly snapshot: SnapshotStore,
  ) {
    this.disposables.push(
      snapshot.onDidChange(() => {
        this.cache.clear();
        this.emitter.fire();
      }),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== 'file' || path.basename(document.uri.fsPath) !== 'lattice.json') {
      return [];
    }
    const dir = path.dirname(document.uri.fsPath);
    const cached = this.cache.get(dir);
    if (cached && Date.now() - cached.at < 60_000) {
      return this.toLenses(cached.commands);
    }
    if (!this.inflight.has(dir)) {
      this.inflight.add(dir);
      void this.resolve(dir).finally(() => this.inflight.delete(dir));
    }
    return [];
  }

  private toLenses(commands: vscode.Command[]): vscode.CodeLens[] {
    const range = new vscode.Range(0, 0, 0, 0);
    return commands.map((command) => new vscode.CodeLens(range, command));
  }

  private async resolve(dir: string): Promise<void> {
    try {
      const declaredId = await readLatticeId(dir);
      let project = declaredId ? this.snapshot.findProject(declaredId) : undefined;
      if (!project) {
        try {
          const where = await this.data.projectWhere(dir);
          project = where.exact ?? where.prefixMatches[0] ?? undefined;
        } catch {
          /* 未注册或 CLI 不可用 → 显示注册引导 */
        }
      }
      const commands: vscode.Command[] = project
        ? [
            {
              title: `Lattice: ${project.name || project.id}`,
              command: 'lattice.project.open',
              arguments: [{ projectId: project.id }],
            },
          ]
        : [
            {
              title: t('Lattice: run "ltc link" to register this project'),
              command: 'lattice.workspace.link',
            },
          ];
      this.cache.set(dir, { at: Date.now(), commands });
      this.emitter.fire();
    } catch {
      /* 静默：文件可能刚创建/被删除 */
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.emitter.dispose();
  }
}
