import * as vscode from 'vscode';
import { LatticeDataService } from '../data/service';
import { ReportStore } from '../state/report-store';
import { truncate } from '../cli/parsers';
import { formatDate } from '../views/items';
import { t } from '../t';

function commandLink(label: string, command: string, args: unknown[]): string {
  const encoded = encodeURIComponent(JSON.stringify(args));
  return `[${label}](command:${command}?${encoded})`;
}

/** 只读虚拟文档（scheme: lattice）：checkpoint / progress / report / context。 */
export class LatticeContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly data: LatticeDataService,
    private readonly reports: ReportStore,
  ) {}

  fire(uri: vscode.Uri): void {
    this.emitter.fire(uri);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // 兼容两种形态：lattice://checkpoint/... （authority=kind）与 lattice:/checkpoint/... （path 携带 kind）
    const segments = uri.authority
      ? [uri.authority, ...uri.path.split('/').filter(Boolean)]
      : uri.path.split('/').filter(Boolean);
    try {
      switch (segments[0]) {
        case 'checkpoint':
          return await this.renderCheckpoint(segments[1], segments[2]);
        case 'progress':
          return await this.renderProgress(segments[1]);
        case 'report':
          return (
            this.reports.get(segments[1]) ?? `# ${segments[1]}\n\n${t('Report not available.')}`
          );
        case 'context':
          return await this.renderContext(uri);
        default:
          return t('Unknown Lattice document.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `# ${t('Failed to render')}\n\n\`\`\`\n${message}\n\`\`\``;
    }
  }

  private async renderCheckpoint(taskId: string, checkpointId: string): Promise<string> {
    const checkpoint = await this.data.taskCheckpointDetail(taskId, checkpointId);
    if (!checkpoint) return `# ${t('Checkpoint not found')}\n\n${checkpointId}`;
    const lines = [
      `# ${checkpoint.title ?? checkpoint.id}`,
      '',
      `- type: ${checkpoint.type ?? ''}`,
      `- time: ${checkpoint.time ?? ''}`,
      `- task: ${taskId}`,
      `- id: ${checkpoint.id}`,
      '',
      checkpoint.message?.trim() ?? '',
      '',
      '---',
      '',
      commandLink(t('Open task PRD'), 'lattice.task.openDoc', [{ taskId, doc: 'prd' }]) +
        ' · ' +
        commandLink(t('Open full progress log'), 'lattice.task.openProgress', [{ taskId }]),
    ];
    return lines.join('\n');
  }

  private async renderProgress(taskId: string): Promise<string> {
    const checkpoints = await this.data.taskProgress(taskId);
    const lines = [`# ${t('Progress Log')} — ${taskId}`, ''];
    if (checkpoints.length === 0) {
      lines.push(t('No checkpoints recorded.'));
    }
    for (const checkpoint of checkpoints) {
      lines.push(
        `## [${checkpoint.type ?? ''}] ${checkpoint.title ?? checkpoint.id}`,
        '',
        `${formatDate(checkpoint.time)} · \`${checkpoint.id}\``,
        '',
        checkpoint.message ? truncate(checkpoint.message, 2000) : '',
        '',
      );
    }
    lines.push(
      '---',
      '',
      commandLink(t('Open task PRD'), 'lattice.task.openDoc', [{ taskId, doc: 'prd' }]),
    );
    return lines.join('\n');
  }

  private async renderContext(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const taskId = params.get('task') ?? undefined;
    const projectId = params.get('project') ?? undefined;
    const query = params.get('query') ?? undefined;
    const payload = taskId
      ? await this.data.contextForTask(taskId, query)
      : await this.data.contextForProject(projectId ?? undefined, query);
    const lines = [
      `# ${t('Lattice Context')}`,
      '',
      '```json',
      JSON.stringify(payload, null, 2),
      '```',
    ];
    return lines.join('\n');
  }
}

export function registerVirtualDocuments(
  context: vscode.ExtensionContext,
  provider: LatticeContentProvider,
): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('lattice', provider),
  );
}
