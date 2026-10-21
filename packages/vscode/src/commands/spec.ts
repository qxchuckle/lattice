import * as vscode from 'vscode';
import { t } from '../t';
import {
  CommandServices,
  RegisterFn,
  extractArgObject,
  extractPayload,
  handleCliError,
  pickSpecId,
  resolveTask,
  showDeduped,
  withNotificationProgress,
} from './shared';

function specIdFrom(arg: unknown): string | undefined {
  const payload = extractPayload(arg);
  if (payload?.kind === 'spec' || payload?.kind === 'conflict') return payload.specId;
  if (payload?.kind === 'refSpecLeaf') return payload.specId;
  if (payload?.kind === 'searchResult') return payload.row.specId;
  const obj = extractArgObject<{ specId?: string }>(arg);
  return obj?.specId ?? (typeof arg === 'string' ? arg : undefined);
}

async function openSpecById(services: CommandServices, specId: string | undefined): Promise<void> {
  if (!specId) {
    const picked = await pickSpecId(services, { title: t('Open Spec') });
    if (!picked) return;
    specId = picked.specId;
  }
  try {
    const spec = await services.data.specShow(specId);
    if (!spec?.filePath) {
      void showDeduped('warn', t('Spec not found: {0}', specId));
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(spec.filePath), { preview: false });
  } catch (error) {
    await handleCliError(error, t('Open spec failed'));
  }
}

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * 规范元数据快捷编辑（title / description / tags；正文与层级不动）。
 * 程序化参数 `{ specId, title?, description?, tags? }`：任一字段存在即直接写入（供集成测试）。
 * 返回更新结果（程序化路径），供集成测试断言。
 */
async function updateSpecMeta(
  services: CommandServices,
  arg: unknown,
): Promise<{ specId: string; filePath: string } | undefined> {
  const args = extractArgObject<{
    specId?: string;
    title?: string;
    description?: string;
    tags?: string[];
  }>(arg);
  let specId = specIdFrom(arg);
  if (!specId) {
    const picked = await pickSpecId(services, { title: t('Edit Spec Metadata') });
    if (!picked) return;
    specId = picked.specId;
  }
  await services.snapshot.ensure(['specs']);
  const row = services.snapshot.specById(specId) ?? (await services.data.specShow(specId));
  if (!row) {
    void showDeduped('warn', t('Spec not found: {0}', specId));
    return;
  }
  const programmatic =
    args !== undefined &&
    (args.title !== undefined || args.description !== undefined || Array.isArray(args.tags));

  const updates: { title?: string; description?: string; tags?: string[] } = {};
  if (programmatic) {
    if (args?.title !== undefined) updates.title = args.title;
    if (args?.description !== undefined) updates.description = args.description;
    if (Array.isArray(args?.tags)) updates.tags = args.tags;
  } else {
    const title = await vscode.window.showInputBox({
      title: t('Spec title'),
      value: row.title,
    });
    if (title === undefined) return;
    const description = await vscode.window.showInputBox({
      title: t('Spec description'),
      value: row.description ?? '',
    });
    if (description === undefined) return;
    const tagsRaw = await vscode.window.showInputBox({
      title: t('Tags (comma separated)'),
      value: row.tags.join(', '),
    });
    if (tagsRaw === undefined) return;
    updates.title = title.trim();
    updates.description = description.trim();
    updates.tags = splitList(tagsRaw);
  }
  try {
    const result = await withNotificationProgress(t('Updating spec…'), () =>
      services.data.specUpdate(row.id, updates),
    );
    if (!result) return undefined;
    await services.snapshot.invalidate(['specs', 'conflicts']);
    if (!programmatic) {
      const openLabel = t('Open Spec');
      void showDeduped('info', t('Spec updated: {0}', result.specId), openLabel).then(
        async (action) => {
          if (action === openLabel) await openSpecById(services, result.specId);
        },
      );
    }
    return result;
  } catch (error) {
    await handleCliError(error, t('Failed to update the spec'));
    return undefined;
  }
}

async function showConflicts(services: CommandServices): Promise<void> {
  await services.snapshot.ensure(['conflicts']);
  const conflicts = services.snapshot.data.conflicts;
  if (conflicts.length === 0) {
    void showDeduped('info', t('No spec conflicts detected.'));
    return;
  }
  const picked = await vscode.window.showQuickPick(
    conflicts.map((conflict) => ({
      label: conflict.fileName,
      description: conflict.scope,
      detail: `${conflict.specId} · ${conflict.filePath}`,
      conflict,
    })),
    { title: t('Spec conflicts'), matchOnDetail: true },
  );
  if (!picked) return;
  await vscode.window.showTextDocument(vscode.Uri.file(picked.conflict.filePath), {
    preview: false,
  });
}

/** spec migrate + 可选 RAG 更新（保存后引导共用）。 */
export async function runSpecSync(
  services: CommandServices,
  options: { ragUpdate?: boolean } = {},
): Promise<void> {
  try {
    const summary = await withNotificationProgress(
      t('Migrating spec frontmatter…'),
      (_update, signal) =>
        services.data.specMigrate(services.activeProject.currentProjectRoot, signal),
      true,
    );
    const migrated = Array.isArray((summary as { migrated?: unknown })?.migrated)
      ? ((summary as { migrated?: unknown[] }).migrated as unknown[]).length
      : 0;
    const errors = Array.isArray((summary as { errors?: unknown })?.errors)
      ? ((summary as { errors?: unknown[] }).errors as unknown[]).length
      : 0;
    if (options.ragUpdate) {
      await runRagCommand(services, 'update');
      return;
    }
    const updateRag = t('Update RAG Index');
    void showDeduped(
      errors > 0 ? 'warn' : 'info',
      t('Spec migrate finished ({0} migrated, {1} error(s)).', migrated, errors),
      updateRag,
    ).then((action) => {
      if (action === updateRag) void runRagCommand(services, 'update');
    });
  } catch (error) {
    await handleCliError(error, t('Spec migration failed'));
  }
}

export async function runRagCommand(
  services: CommandServices,
  action: 'update' | 'rebuild',
): Promise<void> {
  const title = action === 'update' ? t('Updating RAG index…') : t('Rebuilding RAG index…');
  const execute = async (): Promise<void> => {
    try {
      await withNotificationProgress(
        title,
        (_update, signal) =>
          services.data.ragIndex(action, {
            signal,
            onProgress: (progress) => {
              const file = progress.currentFile ? ` ${progress.currentFile}` : '';
              _update(`${progress.current}/${progress.total}${file}`.slice(0, 120));
            },
          }),
        true,
      );
      void showDeduped('info', t('RAG {0} finished.', action));
    } catch (error) {
      await handleCliError(error, t('RAG {0} failed', action));
    }
  };
  // 长操作互斥：重复触发只提示不重跑
  if (services.busy) {
    await services.busy.runIfIdle('rag', title, execute);
  } else {
    await execute();
  }
}

export function registerSpecCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.spec.open', async () => {
    await openSpecById(services, undefined);
  });
  register('lattice.spec.openById', async (arg?: unknown) => {
    await openSpecById(services, specIdFrom(arg));
  });
  register('lattice.spec.conflicts', () => showConflicts(services));

  register('lattice.spec.lint', async () => {
    const summary = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t('Checking specs…') },
      () => services.specDiagnostics?.refresh() ?? Promise.resolve(null),
    );
    if (!summary) return;
    const total = summary.lint + summary.conflicts;
    if (total === 0) {
      void showDeduped('info', t('Spec check passed ({0} file(s)).', summary.files));
      return;
    }
    const showProblems = t('Show Problems');
    // 非模态通知：不阻塞命令返回（按钮动作异步处理）
    void showDeduped(
      'warn',
      t('Spec check found {0} issue(s) in {1} file(s).', total, summary.files),
      showProblems,
    ).then((picked) => {
      if (picked === showProblems) {
        void vscode.commands.executeCommand('workbench.actions.view.problems');
      }
    });
  });

  register('lattice.spec.copyId', async (arg?: unknown) => {
    let specId = specIdFrom(arg);
    if (!specId) {
      const picked = await pickSpecId(services);
      specId = picked?.specId;
    }
    if (!specId) return;
    await vscode.env.clipboard.writeText(specId);
    void showDeduped('info', t('Copied: {0}', specId));
  });
  register('lattice.spec.copyPath', async (arg?: unknown) => {
    const payload = extractPayload(arg);
    let filePath =
      payload?.kind === 'spec' || payload?.kind === 'conflict' ? payload.filePath : undefined;
    if (!filePath) {
      const specId = specIdFrom(arg);
      if (specId) {
        const spec = await services.data.specShow(specId).catch(() => null);
        filePath = spec?.filePath;
      }
    }
    if (!filePath) {
      const picked = await pickSpecId(services);
      filePath = picked?.filePath;
    }
    if (!filePath) return;
    await vscode.env.clipboard.writeText(filePath);
    void showDeduped('info', t('Copied: {0}', filePath));
  });
  register('lattice.spec.update', (arg) => updateSpecMeta(services, arg));
  register('lattice.spec.refToTask', async (arg?: unknown) => {
    const specId = specIdFrom(arg) ?? (await pickSpecId(services))?.specId;
    if (!specId) return;
    const task = await resolveTask(services, undefined, { title: t('Reference to Task') });
    if (!task) return;
    try {
      await services.data.taskRefSpec(task.id, [specId]);
      await services.snapshot.invalidate(['tasks']);
      void showDeduped('info', t('Referenced {0} from "{1}".', specId, task.title));
    } catch (error) {
      await handleCliError(error, t('Failed to reference the spec'));
    }
  });
  register('lattice.spec.migrate', () => runSpecSync(services));
  register('lattice.spec.afterEdit', () => runSpecSync(services, { ragUpdate: true }));
  register('lattice.spec.revealInGraph', async (arg?: unknown) => {
    const specId = specIdFrom(arg) ?? (await pickSpecId(services))?.specId;
    if (!specId) return;
    await services.graph?.open({ view: 'spec', anchorId: specId });
  });
}
