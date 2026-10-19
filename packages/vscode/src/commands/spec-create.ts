import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  applySpecTemplate,
  getGlobalSpecDir,
  getProjectSpecDir,
  getUserSpecDir,
  listSpecTemplates,
  specExists,
  writeSpec,
  type SpecTemplate,
} from '@qcqx/lattice-core';
import { resolveProjectDirName } from '@qcqx/lattice-services';
import { CommandServices, RegisterFn, showDeduped } from './shared';
import { showEnhancedPicker } from '../pickers/enhanced';
import { sortProjectsForSpecPick, specCreateArgsFromTreeArg } from './spec-create-logic';
import { t } from '../t';

/** 程序化参数（测试/自动化可全量传入以跳过所有交互）。 */
export interface CreateSpecArgs {
  /** 模板名；缺省或空 = 空白创建（交互模式下会询问） */
  template?: string;
  scope?: 'global' | 'user' | 'project';
  /** 目标项目（scope = project；缺省时弹出可搜索的项目选择器） */
  projectId?: string;
  relativePath?: string;
  title?: string;
  description?: string;
  tags?: string;
  /** 跳过「已存在」确认（程序化路径；交互路径默认弹模态确认） */
  overwrite?: boolean;
  /** 是否创建后在编辑器打开（默认 true） */
  open?: boolean;
}

interface TemplatePick extends vscode.QuickPickItem {
  template: SpecTemplate | null;
}

interface ScopePick extends vscode.QuickPickItem {
  scope: 'global' | 'user' | 'project';
}

/** 文件名 → 默认标题（去扩展名、[-_] 转空格、首字母大写）。 */
export function defaultTitleFromPath(relativePath: string): string {
  const base = path.basename(relativePath).replace(/\.md$/i, '');
  const spaced = base.replace(/[-_]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : base;
}

/** 相对路径校验（返回错误文案或 undefined）。 */
export function validateRelativePath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return t('Required');
  if (trimmed.includes('..')) return t('Path must not contain ".."');
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return t('Path must be relative');
  return undefined;
}

async function pickTemplate(templates: SpecTemplate[]): Promise<SpecTemplate | null | undefined> {
  const blank: TemplatePick = {
    label: `$(new-file) ${t('Blank (no template)')}`,
    description: t('Start from an empty spec'),
    template: null,
  };
  const items: TemplatePick[] = [
    blank,
    ...templates.map((template) => ({
      label: `$(file-code) ${template.name}`,
      description: template.description,
      detail: `${template.defaultScope} · ${template.source}`,
      template,
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: t('Pick a template for the new spec'),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked === undefined ? undefined : picked.template;
}

async function pickScope(): Promise<'global' | 'user' | 'project' | undefined> {
  const items: ScopePick[] = [
    {
      scope: 'user',
      label: `$(account) ${t('User (all my projects)')}`,
      description: t('Shared across projects'),
    },
    {
      scope: 'project',
      label: `$(project) ${t('Project (pick one)')}`,
      description: t('Pick the target project (type to search)'),
    },
    {
      scope: 'global',
      label: `$(globe) ${t('Global (all users)')}`,
      description: t('Shared across users and projects'),
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: t('Pick a scope for the new spec'),
  });
  return picked?.scope;
}

/** 目标项目选择：输入即过滤（名称 / 包名 / 路径），当前项目置顶并标注。 */
async function pickProjectForSpec(
  services: CommandServices,
  preset?: string,
): Promise<string | undefined> {
  await services.snapshot.ensure(['projects']);
  const all = services.snapshot.data.projects;
  if (all.length === 0) {
    void showDeduped('warn', t('No projects registered yet.'));
    return undefined;
  }
  const currentId = services.snapshot.canonicalProjectId(preset);
  const items = sortProjectsForSpecPick(all, currentId).map((project) => ({
    label: `$(project) ${project.name || project.id}`,
    description:
      project.id === currentId
        ? `${project.packageNames[0] ?? project.id} · ${t('Current project')}`
        : (project.packageNames[0] ?? project.id),
    detail: project.localPaths[0],
    projectId: project.id,
  }));
  const picked = await showEnhancedPicker(items, {
    title: t('Pick the target project (type to search)'),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.projectId;
}

async function applyTemplate(
  services: CommandServices,
  username: string,
  template: SpecTemplate,
  open: boolean,
): Promise<string | undefined> {
  const projectId = services.activeProject.currentProjectId ?? '';
  const filePath = await applySpecTemplate(username, projectId, template.name);
  if (!filePath) {
    void showDeduped(
      'warn',
      t('Could not apply template "{0}" (missing active project or template).', template.name),
    );
    return undefined;
  }
  await services.snapshot.invalidate(['specs']);
  if (open) await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
  void showDeduped(
    'info',
    t('Template "{0}" applied: {1}', template.name, path.basename(filePath)),
  );
  return filePath;
}

async function createBlankSpec(
  services: CommandServices,
  args: CreateSpecArgs,
): Promise<string | undefined> {
  const username = services.snapshot.data.username;
  if (!username) {
    void showDeduped('warn', t('Lattice is not initialized yet.'));
    return undefined;
  }

  // 1) scope（项目级 → 可搜索选择目标项目，当前项目置顶）
  let scope = args.scope;
  if (!scope) scope = await pickScope();
  if (!scope) return undefined;

  let dir: string;
  if (scope === 'global') {
    dir = getGlobalSpecDir();
  } else if (scope === 'project') {
    const projectId =
      args.projectId ??
      (await pickProjectForSpec(services, services.activeProject.currentProjectId));
    if (!projectId) return undefined;
    const dirName = await resolveProjectDirName(username, projectId);
    if (!dirName) {
      void showDeduped('warn', t('Project scope requires an active project.'));
      return undefined;
    }
    dir = getProjectSpecDir(username, dirName);
  } else {
    dir = getUserSpecDir(username);
  }

  // 2) 文件名
  let relativePath = args.relativePath;
  if (relativePath === undefined) {
    relativePath = await vscode.window.showInputBox({
      title: t('New Spec'),
      prompt: t('Spec file name (relative, e.g. my-topic.md)'),
      placeHolder: 'my-topic.md',
      validateInput: (value) => validateRelativePath(value),
    });
    if (relativePath === undefined) return undefined;
  } else {
    const error = validateRelativePath(relativePath);
    if (error) {
      void showDeduped('warn', t('Invalid spec file name: {0}', error));
      return undefined;
    }
  }
  let rel = relativePath.trim();
  if (!rel.toLowerCase().endsWith('.md')) rel = `${rel}.md`;

  // 3) 标题
  let title = args.title;
  if (title === undefined) {
    title = await vscode.window.showInputBox({
      title: t('New Spec'),
      prompt: t('Spec title'),
      value: defaultTitleFromPath(rel),
      validateInput: (value) => (value.trim() ? undefined : t('Required')),
    });
    if (title === undefined) return undefined;
  }
  if (!title.trim()) {
    void showDeduped('warn', t('Spec title is required.'));
    return undefined;
  }

  // 4) 摘要 / 标签（可选）
  let description = args.description;
  if (description === undefined) {
    description = await vscode.window.showInputBox({
      title: t('New Spec'),
      prompt: t('Spec description (optional; 30–500 chars recommended)'),
      placeHolder: t('Scope + constraints + purpose'),
    });
    if (description === undefined) return undefined;
  }
  let tagsRaw = args.tags;
  if (tagsRaw === undefined) {
    tagsRaw = await vscode.window.showInputBox({
      title: t('New Spec'),
      prompt: t('Tags (comma separated, optional)'),
    });
    if (tagsRaw === undefined) return undefined;
  }
  const tags = tagsRaw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  // 5) 落盘（存在性确认）
  const filePath = path.join(dir, rel);
  if (!args.overwrite && (await specExists(filePath))) {
    const overwrite = t('Overwrite');
    const picked = await vscode.window.showWarningMessage(
      t('Spec already exists: {0}. Overwrite?', rel),
      { modal: true },
      overwrite,
    );
    if (picked !== overwrite) return undefined;
  }
  await writeSpec(
    filePath,
    {
      title: title.trim(),
      description: description.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
    },
    `# ${title.trim()}\n\n`,
  );
  await services.snapshot.invalidate(['specs']);
  if (args.open !== false) {
    await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
  }
  void showDeduped('info', t('Spec created: {0}', rel));
  return filePath;
}

/**
 * Spec 创建向导：模板（可选）→ scope（项目级 → 可搜索选择项目）→ 文件名/标题/描述/标签 → 落盘并打开。
 * 规范树节点右键入口会预置 scope（及 projectId），跳过模板/作用域交互。
 */
export function registerSpecCreateCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.spec.create', async (arg?: unknown) => {
    const browsing = services.userScope?.browseUser;
    if (browsing) {
      void showDeduped(
        'warn',
        t(
          'Read-only while browsing user "{0}". Exit read-only browsing to make changes.',
          browsing,
        ),
      );
      return undefined;
    }
    const fromTree = specCreateArgsFromTreeArg(arg);
    const args = (fromTree ?? (arg && typeof arg === 'object' ? arg : {})) as CreateSpecArgs;

    // 指定模板：直接套用（对齐 web `/api/spec-templates/apply` 语义）
    if (args.template) {
      const templates = await listSpecTemplates().catch(() => []);
      const template = templates.find((item) => item.name === args.template);
      if (!template) {
        void showDeduped('warn', t('Template "{0}" not found.', args.template));
        return undefined;
      }
      const username = services.snapshot.data.username;
      if (!username) {
        void showDeduped('warn', t('Lattice is not initialized yet.'));
        return undefined;
      }
      return applyTemplate(services, username, template, args.open !== false);
    }

    // 交互模式：先询问模板（有模板时；树节点右键入口已预置 scope，直接进入创建）
    if (args.scope === undefined && args.relativePath === undefined) {
      const templates = await listSpecTemplates().catch(() => []);
      if (templates.length > 0) {
        const choice = await pickTemplate(templates);
        if (choice === undefined) return undefined; // 取消
        if (choice) {
          const username = services.snapshot.data.username;
          if (!username) {
            void showDeduped('warn', t('Lattice is not initialized yet.'));
            return undefined;
          }
          return applyTemplate(services, username, choice, args.open !== false);
        }
      }
    }

    return createBlankSpec(services, args);
  });
}
