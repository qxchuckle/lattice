import * as vscode from 'vscode';
import { userInfo } from 'node:os';
import {
  ensureDir,
  getUserDir,
  getUserProjectsDir,
  getUserSpecDir,
  getUserTasksDir,
  readLocalConfig,
  scanForProjects,
  writeLocalConfig,
} from '@qcqx/lattice-core';
import { getChannel } from '../logging';
import { TrashRow } from '../cli/types';
import { getConfig, getLatticeRoot } from '../config';
import { t } from '../t';
import {
  CommandServices,
  RegisterFn,
  extractArgObject,
  handleCliError,
  showDeduped,
  withNotificationProgress,
} from './shared';
import { runRagCommand } from './spec';
import { formatDate } from '../views/items';

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 在编辑器内打开 Web 工作台：复用扩展内嵌 webview（与图谱同一应用，无需外部服务/CLI）。 */
async function openWebWorkbench(services: CommandServices): Promise<void> {
  await services.graph?.open({ view: 'global' });
}

function runInTerminal(services: CommandServices, name: string, command: string): void {
  const terminal = vscode.window.createTerminal({
    name,
    cwd:
      services.activeProject.currentAnchorRoot ?? services.activeProject.currentFolder?.uri.fsPath,
  });
  terminal.show();
  terminal.sendText(command);
}

function ragStatusMarkdown(status: Record<string, unknown>): string {
  const lines = [`# RAG Status`, ''];
  const fields: Array<[string, unknown]> = [
    ['Indexed documents', status.indexedDocuments],
    ['Total embeddings', status.totalEmbeddings],
    ['Vector store ready', status.vectorStoreReady],
    ['Vector dimension', status.vectorDimension],
    ['Model', status.modelId],
    ['Model installed', status.modelInstalled],
    ['Distance threshold', status.distanceThreshold],
    ['Last updated', status.lastUpdated],
    ['DB path', status.dbPath],
  ];
  for (const [label, value] of fields) {
    if (value !== undefined && value !== null) lines.push(`- ${label}: ${String(value)}`);
  }
  return lines.join('\n');
}

function doctorMarkdown(report: {
  total: number;
  healthy: number;
  stale: number;
  error: number;
  repaired: number;
  entries: Array<{ item: string; status: string; message?: string; fix?: string }>;
}): string {
  const lines = [
    '# Lattice Health Check',
    '',
    `- total: ${report.total} · healthy: ${report.healthy} · stale: ${report.stale} · error: ${report.error}${
      report.repaired ? ` · repaired: ${report.repaired}` : ''
    }`,
    '',
  ];
  for (const entry of report.entries) {
    const icon =
      entry.status === 'healthy'
        ? '✅'
        : entry.status === 'stale'
          ? '⚠️'
          : entry.status === 'error'
            ? '❌'
            : '🔧';
    lines.push(`- ${icon} **${entry.item}** — ${entry.message ?? entry.status}`);
    if (entry.fix && entry.status !== 'healthy') lines.push(`  - fix: ${entry.fix}`);
  }
  return lines.join('\n');
}

export function registerSystemCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.refresh', async () => {
    services.watcher?.start();
    await services.snapshot.invalidate(['user', 'projects', 'tasks', 'specs', 'conflicts']);
    await services.activeProject.refresh();
  });

  register('lattice.tasks.toggleScope', async () => {
    return services.tasksScope?.toggle();
  });

  register('lattice.graph.open', async (arg?: unknown) => {
    const target =
      arg && typeof arg === 'object' && !('lattice' in arg)
        ? (arg as { view?: 'global' | 'task' | 'project' | 'spec'; anchorId?: string })
        : undefined;
    await services.graph?.open(target);
  });

  register('lattice.displayLanguage', async () => {
    // 扩展语言（contributes + l10n + Webview）单一来源 = 编辑器显示语言；此命令打开编辑器的语言选择器
    await vscode.commands.executeCommand('workbench.action.configureLocale');
  });

  register('lattice.status.project', async () => {
    interface StatusPickItem extends vscode.QuickPickItem {
      action: string;
    }
    const project = services.activeProject.currentProject;
    const items: StatusPickItem[] = [];
    if (project) {
      items.push({ label: `$(folder) ${t('Reveal Folder in OS')}`, action: 'reveal' });
      items.push({ label: `$(clippy) ${t('Copy Project ID')}`, action: 'copyId' });
      if (project.localPaths[0]) {
        items.push({ label: `$(copy) ${t('Copy Project Path')}`, action: 'copyPath' });
      }
      items.push({ label: `$(type-hierarchy) ${t('Show in Graph')}`, action: 'graph' });
    }
    items.push({ label: `$(arrow-swap) ${t('Switch Active Project…')}`, action: 'switch' });
    items.push({ label: `$(book) ${t('Open Specs')}`, action: 'specs' });
    items.push({ label: `$(refresh) ${t('Refresh Data')}`, action: 'refresh' });
    const picked = await vscode.window.showQuickPick(items, { title: t('Lattice') });
    if (!picked) return;
    switch (picked.action) {
      case 'reveal':
        await vscode.commands.executeCommand('lattice.project.open', { projectId: project?.id });
        break;
      case 'copyId':
        if (project) {
          await vscode.env.clipboard.writeText(project.id);
          void showDeduped('info', t('Copied: {0}', project.id));
        }
        break;
      case 'copyPath':
        if (project?.localPaths[0]) {
          await vscode.env.clipboard.writeText(project.localPaths[0]);
          void showDeduped('info', t('Copied: {0}', project.localPaths[0]));
        }
        break;
      case 'graph':
        if (project)
          await vscode.commands.executeCommand('lattice.project.revealInGraph', {
            projectId: project.id,
          });
        break;
      case 'switch':
        await vscode.commands.executeCommand('lattice.project.switchActive');
        break;
      case 'specs':
        await vscode.commands.executeCommand('lattice.specs.focus');
        break;
      case 'refresh':
        await vscode.commands.executeCommand('lattice.refresh');
        break;
    }
  });

  register('lattice.rag.status', async () => {
    try {
      const status = await withNotificationProgress(t('Reading RAG status…'), () =>
        services.data.ragStatus(),
      );
      if (!status) return;
      services.reports.set('rag', ragStatusMarkdown(status));
      await vscode.window.showTextDocument(vscode.Uri.parse('lattice://report/rag'), {
        preview: false,
      });
    } catch (error) {
      await handleCliError(error, t('RAG status failed'));
    }
  });

  register('lattice.rag.update', () => runRagCommand(services, 'update'));
  register('lattice.rag.rebuild', () => runRagCommand(services, 'rebuild'));

  register('lattice.doctor.run', async () => {
    const execute = async (): Promise<void> => {
      try {
        const report = await withNotificationProgress(
          t('Running health check…'),
          (_update, signal) => services.data.doctor({ signal }),
        );
        if (!report) return;
        services.reports.set('doctor', doctorMarkdown(report));
        await vscode.window.showTextDocument(vscode.Uri.parse('lattice://report/doctor'), {
          preview: false,
        });
      } catch (error) {
        await handleCliError(error, t('Health check failed'));
      }
    };
    if (services.busy) await services.busy.runIfIdle('doctor', t('Running health check…'), execute);
    else await execute();
  });

  register('lattice.doctor.fix', async () => {
    const confirmed = await vscode.window.showWarningMessage(
      t('Run health check with --fix? This may modify Lattice metadata.'),
      { modal: true },
      t('Run with fix'),
    );
    if (confirmed !== t('Run with fix')) return;
    try {
      const report = await withNotificationProgress(
        t('Running health check (fix)…'),
        (_update, signal) => services.data.doctor({ fix: true, signal }),
        true,
      );
      if (!report) return;
      services.reports.set('doctor', doctorMarkdown(report));
      await services.snapshot.invalidate(['user', 'projects', 'tasks', 'specs', 'conflicts']);
      await vscode.window.showTextDocument(vscode.Uri.parse('lattice://report/doctor'), {
        preview: false,
      });
    } catch (error) {
      await handleCliError(error, t('Health check (fix) failed'));
    }
  });

  register('lattice.trash.browse', async () => {
    try {
      const entries = await withNotificationProgress(t('Reading recycle bin…'), () =>
        services.data.trashList(),
      );
      if (!entries) return;
      if (entries.length === 0) {
        void showDeduped('info', t('The recycle bin is empty.'));
        return;
      }
      interface TrashPickItem extends vscode.QuickPickItem {
        entry: TrashRow;
      }
      const restoreButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('discard'),
        tooltip: t('Restore'),
      };
      const purgeButton: vscode.QuickInputButton = {
        iconPath: new vscode.ThemeIcon('trash'),
        tooltip: t('Delete Permanently'),
      };
      const quickPick = vscode.window.createQuickPick<TrashPickItem>();
      quickPick.title = t('Recycle Bin');
      quickPick.placeholder = t('Items deleted from Lattice ({0} total)', entries.length);
      quickPick.items = entries.map((entry) => ({
        label: entry.title || entry.id,
        description: `${entry.type} · ${formatDate(entry.trashedAt)}`,
        detail: entry.entityId,
        entry,
        buttons: [restoreButton, purgeButton],
      }));
      quickPick.onDidTriggerItemButton(async (event) => {
        const entry = event.item.entry;
        if (event.button === restoreButton) {
          await services.data.trashRestore(entry.id);
          await services.snapshot.invalidate(['user', 'projects', 'tasks', 'specs']);
          quickPick.hide();
          void showDeduped('info', t('Restored: {0}', entry.title));
        } else if (event.button === purgeButton) {
          const confirmed = await vscode.window.showWarningMessage(
            t('Permanently delete "{0}"?', entry.title),
            { modal: true },
            t('Delete Permanently'),
          );
          if (confirmed !== t('Delete Permanently')) return;
          await services.data.trashPurge(entry.id);
          quickPick.hide();
          void showDeduped('info', t('Deleted permanently: {0}', entry.title));
        }
      });
      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    } catch (error) {
      await handleCliError(error, t('Recycle bin failed'));
    }
  });

  register('lattice.web.open', () => openWebWorkbench(services));

  /** 用户名合法字符（目录名安全）。 */
  const BOOTSTRAP_USERNAME_PATTERN = /^[\w-]+$/;

  interface BootstrapArgs {
    username?: string;
    scanDirs?: string[];
  }

  interface BootstrapResult {
    username: string;
    scanDirs: string[];
    added: number;
    updated: number;
  }

  /**
   * 快速开始：进程内完成**最小可用初始化**（数据根 + 首个用户 + 项目扫描），全程无需 CLI。
   * 完整初始化（AI 客户端注入 / git / 模板）仍引导运行 `ltc init`。
   * 程序化参数：`{ username?, scanDirs? }`（测试/自动化可跳过全部交互）。
   */
  async function bootstrapWorkspace(
    services: CommandServices,
    arg: unknown,
  ): Promise<BootstrapResult | undefined> {
    const args = extractArgObject<BootstrapArgs>(arg) ?? {};
    const existing = await readLocalConfig();

    // 1) 用户名（已有配置则沿用）
    let username = args.username?.trim() || existing?.username;
    if (!username) {
      const suggested = (userInfo().username || 'me').replace(/[^\w-]/g, '') || 'me';
      const input = await vscode.window.showInputBox({
        title: t('Quick Start (No CLI)'),
        prompt: t('Your Lattice username (letters, digits, "-" or "_")'),
        value: suggested,
        validateInput: (value) =>
          BOOTSTRAP_USERNAME_PATTERN.test(value.trim())
            ? undefined
            : t('Only letters, digits, "-" or "_" are allowed'),
      });
      if (input === undefined) return undefined;
      username = input.trim();
    }

    // 2) 扫描目录（逗号分隔；缺省 = 当前工作区；留空跳过）
    let scanDirs = args.scanDirs?.map((dir) => dir.trim()).filter(Boolean);
    if (scanDirs === undefined) {
      const workspaceDir = services.activeProject.currentFolder?.uri.fsPath;
      const suggested = existing?.scanDirs?.join(', ') ?? workspaceDir ?? '';
      const input = await vscode.window.showInputBox({
        title: t('Quick Start (No CLI)'),
        prompt: t('Directories to scan for projects (comma separated; leave empty to skip)'),
        value: suggested,
        placeHolder: '~/Projects, ~/workspace',
      });
      if (input === undefined) return undefined;
      scanDirs = input
        .split(',')
        .map((dir) => dir.trim())
        .filter(Boolean);
    }
    const finalScanDirs = scanDirs;

    try {
      // 3) 数据根骨架 + 配置（持久化 scanDirs，供后续 `ltc init --auto` 复用）
      await ensureDir(getUserDir(username));
      await ensureDir(getUserSpecDir(username));
      await ensureDir(getUserProjectsDir(username));
      await ensureDir(getUserTasksDir(username));
      await writeLocalConfig({ ...(existing ?? {}), username, scanDirs: finalScanDirs });

      // 4) DB + 项目扫描（进程内 core）
      await services.data.warmDb();
      let added = 0;
      let updated = 0;
      if (finalScanDirs.length > 0) {
        const result = await withNotificationProgress(
          t('Scanning projects…'),
          async (update) =>
            scanForProjects(username as string, finalScanDirs, (progress) => {
              update(`${progress.added}+ ${progress.updated}~ · ${progress.currentDir}`);
            }),
          true,
        );
        // 可取消：取消（undefined）时按 0 计（数据根与用户仍已就绪）
        if (result) {
          added = result.added.length;
          updated = result.updated.length;
        }
      }

      // 5) 全量刷新
      await services.snapshot.invalidate(['user', 'projects', 'tasks', 'specs', 'conflicts'], {
        reload: true,
      });
      await services.activeProject.refresh();

      const fullSetup = t('Run "ltc init" for the full setup (AI clients, git, templates).');
      void showDeduped(
        'info',
        t(
          'Lattice is ready. User "{0}" · {1} new / {2} updated project(s).',
          username,
          added,
          updated,
        ),
        fullSetup,
      ).then((action) => {
        if (action === fullSetup)
          void vscode.commands.executeCommand('lattice.workspace.initialize');
      });
      return { username, scanDirs: finalScanDirs, added, updated };
    } catch (error) {
      await handleCliError(error, t('Quick start failed'));
      return undefined;
    }
  }

  register('lattice.workspace.initialize', () => {
    runInTerminal(services, 'Lattice Init', 'ltc init');
  });
  register('lattice.workspace.bootstrap', (arg) => bootstrapWorkspace(services, arg));

  register('lattice.workspace.scan', () => {
    runInTerminal(services, 'Lattice Scan', 'ltc init scan');
  });
  register('lattice.workspace.link', () => {
    if (!services.activeProject.currentFolder) {
      void showDeduped('warn', t('Open a workspace folder first.'));
      return;
    }
    runInTerminal(services, 'Lattice Link', 'ltc link');
  });

  register('lattice.cli.check', async () => {
    try {
      const [version, executable] = await Promise.all([
        services.data.version(),
        services.data.executablePath(),
      ]);
      const minVersion = getConfig().minCliVersion;
      if (compareVersions(version, minVersion) >= 0) {
        void showDeduped('info', t('Lattice runtime v{0} ({1}).', version, executable));
        services.watcher?.start();
        await services.snapshot.invalidate(['user', 'projects', 'tasks', 'specs', 'conflicts']);
        await services.activeProject.refresh();
      } else {
        const openSettings = t('Open Settings');
        void showDeduped(
          'warn',
          t('Lattice runtime v{0} is older than the required version {1}.', version, minVersion),
          openSettings,
        ).then(async (action) => {
          if (action === openSettings) {
            await vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'lattice.minCliVersion',
            );
          }
        });
      }
    } catch (error) {
      await handleCliError(error, t('Runtime check failed'));
    }
  });

  register('lattice.logs.show', async () => {
    getChannel().show();
  });

  register('lattice.openDataDir', async () => {
    void vscode.env.openExternal(vscode.Uri.file(getLatticeRoot()));
  });

  register('lattice.utility.copyDiagnostics', async () => {
    const lines: string[] = [];
    lines.push(
      `extension: lattice@${String(services.context.extension.packageJSON.version ?? 'dev')}`,
    );
    lines.push(`vscode: ${vscode.version}`);
    lines.push(`platform: ${process.platform} ${process.arch} node ${process.version}`);
    try {
      lines.push(
        `core: ${await services.data.version()} (${await services.data.executablePath()})`,
      );
    } catch (error) {
      lines.push(`core: unavailable (${String(error)})`);
    }
    lines.push(`latticeRoot: ${getLatticeRoot()}`);
    const state = services.snapshot.data;
    lines.push(
      `snapshot: gen=${services.snapshot.gen} projects=${state.projects.length} tasks=${state.tasks.length} specs=${
        state.specs.project.length + state.specs.user.length + state.specs.global.length
      } conflicts=${state.conflicts.length}`,
    );
    const errors = Object.entries(state.errors);
    if (errors.length > 0) lines.push(`errors: ${errors.map(([k, v]) => `${k}: ${v}`).join('; ')}`);
    await vscode.env.clipboard.writeText(lines.join('\n'));
    void showDeduped('info', t('Diagnostics copied to clipboard.'));
  });
}
