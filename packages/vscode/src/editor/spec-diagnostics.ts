import * as vscode from 'vscode';
import * as path from 'node:path';
import { lintSpecs } from '@qcqx/lattice-core';
import * as lattice from '@qcqx/lattice-services';
import { getConfig, getLatticeRoot } from '../config';
import { errorLog } from '../logging';
import { t } from '../t';

export interface SpecDiagnosticsSummary {
  /** lint 问题数（含 warning） */
  lint: number;
  /** 冲突诊断数（每个涉事文件各一条） */
  conflicts: number;
  /** 涉及的文件数 */
  files: number;
}

/**
 * Spec 体检原生化：lint + 多层级冲突 → Problems 面板（DiagnosticCollection）。
 *
 * - 触发：激活后首轮 + 快照 specs/conflicts 变更（防抖）+ spec 文件保存（防抖）
 * - 点击诊断自动跳转文件（文件级诊断，行号统一落在 frontmatter 起点）
 * - 可通过 `lattice.specDiagnostics.enabled` 关闭
 */
export class SpecDiagnosticsService implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('lattice-specs');
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Promise<SpecDiagnosticsSummary> | null = null;
  private lastSummary: SpecDiagnosticsSummary = { lint: 0, conflicts: 0, files: 0 };

  constructor() {
    this.disposables.push(
      this.collection,
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.isSpecFile(document.uri)) this.schedule();
      }),
    );
  }

  get summary(): SpecDiagnosticsSummary {
    return this.lastSummary;
  }

  /** 防抖刷新（快照变更 / 文件保存共用）。 */
  schedule(delayMs = 1200): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delayMs);
  }

  async refresh(): Promise<SpecDiagnosticsSummary> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<SpecDiagnosticsSummary> {
    if (!getConfig().specDiagnosticsEnabled) {
      this.collection.clear();
      this.lastSummary = { lint: 0, conflicts: 0, files: 0 };
      return this.lastSummary;
    }
    try {
      const username = await lattice.currentUsername();
      const [entries, conflicts] = await Promise.all([
        lattice.listSpecs(username),
        lattice.detectAllConflicts(username).catch(() => []),
      ]);

      const byFile = new Map<string, vscode.Diagnostic[]>();
      const add = (filePath: string, diagnostic: vscode.Diagnostic) => {
        const list = byFile.get(filePath) ?? [];
        list.push(diagnostic);
        byFile.set(filePath, list);
      };

      let lintCount = 0;
      for (const report of lintSpecs(entries.map((entry) => entry.spec))) {
        for (const issue of report.issues) {
          lintCount += 1;
          add(
            report.filePath,
            new vscode.Diagnostic(
              new vscode.Range(0, 0, 0, 0),
              `${t('Spec lint', 'Spec lint')} · ${issue.field}: ${issue.message}`,
              issue.severity === 'error'
                ? vscode.DiagnosticSeverity.Error
                : vscode.DiagnosticSeverity.Warning,
            ),
          );
        }
      }

      let conflictCount = 0;
      for (const conflict of conflicts) {
        for (const level of conflict.levels) {
          const peer = conflict.levels.find((other) => other.filePath !== level.filePath);
          conflictCount += 1;
          const diagnostic = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 0),
            t(
              'Spec conflict "{0}": same relative path as {1} layer ({2}).',
              conflict.fileName,
              peer?.scope ?? '?',
              peer?.filePath ?? '?',
            ),
            vscode.DiagnosticSeverity.Warning,
          );
          diagnostic.code = 'spec-conflict';
          add(level.filePath, diagnostic);
        }
      }

      this.collection.clear();
      for (const [filePath, diagnostics] of byFile) {
        this.collection.set(vscode.Uri.file(filePath), diagnostics);
      }
      this.lastSummary = { lint: lintCount, conflicts: conflictCount, files: byFile.size };
      return this.lastSummary;
    } catch (error) {
      errorLog('spec diagnostics refresh failed', error);
      return this.lastSummary;
    }
  }

  private isSpecFile(uri: vscode.Uri): boolean {
    if (uri.scheme !== 'file') return false;
    const filePath = uri.fsPath;
    const root = getLatticeRoot();
    return (
      filePath.startsWith(root) &&
      filePath.includes(`${path.sep}spec${path.sep}`) &&
      filePath.endsWith('.md')
    );
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const disposable of this.disposables) disposable.dispose();
  }
}
