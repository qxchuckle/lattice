import * as vscode from 'vscode';
import {
  dirExists,
  ensureDir,
  getUsername,
  getUserDir,
  getUserProjectsDir,
  getUserSpecDir,
  getUserTasksDir,
  readLocalConfig,
  renameUser,
  writeLocalConfig,
} from '@qcqx/lattice-core';
import { listUsers } from '@qcqx/lattice-services';
import {
  CommandServices,
  RegisterFn,
  extractArgObject,
  handleCliError,
  showDeduped,
  withNotificationProgress,
} from './shared';
import { t } from '../t';

/** 用户名合法字符（目录名安全，防路径穿越）。 */
const USERNAME_PATTERN = /^[\w-]+$/;

function usernameArg(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  const obj = extractArgObject<{ username?: string; name?: string }>(arg);
  return obj?.username ?? obj?.name;
}

/** 新建 / 重命名共用的名称校验。 */
async function validateNewName(value: string): Promise<string | undefined> {
  const name = value.trim();
  if (!name) return t('Required');
  if (!USERNAME_PATTERN.test(name)) return t('Only letters, digits, "-" or "_" are allowed');
  if (await dirExists(getUserDir(name))) return t('User already exists: {0}', name);
  return undefined;
}

/** 用户切换 / 浏览切换后的统一重置：清活动任务、全量刷新、重算项目锚点与体检。 */
async function resetSession(services: CommandServices): Promise<void> {
  await services.activeTask.set(undefined);
  await services.snapshot.invalidate(['user', 'projects', 'tasks', 'specs', 'conflicts'], {
    reload: true,
  });
  await services.activeProject.refresh();
  services.searchState.clear();
  await services.specDiagnostics?.refresh().catch(() => undefined);
}

/** 新建用户：目录脚手架 + 可选一键切换。 */
async function createUser(arg: unknown): Promise<string | undefined> {
  let name = usernameArg(arg);
  if (name === undefined) {
    name = await vscode.window.showInputBox({
      title: t('Create User'),
      prompt: t('New user name (letters, digits, "-" or "_")'),
      validateInput: (value) => validateNewName(value),
    });
    if (name === undefined) return undefined;
  } else {
    const error = await validateNewName(name);
    if (error) {
      void showDeduped('warn', error);
      return undefined;
    }
  }

  const user = name.trim();
  await ensureDir(getUserDir(user));
  await ensureDir(getUserSpecDir(user));
  await ensureDir(getUserProjectsDir(user));
  await ensureDir(getUserTasksDir(user));

  const switchNow = t('Switch to It');
  void showDeduped('info', t('User created: {0}', user), switchNow).then((action) => {
    if (action === switchNow) void vscode.commands.executeCommand('lattice.user.switch', user);
  });
  return user;
}

/** 切换当前用户（config-local.json）；退出只读浏览并全量刷新。 */
async function switchUser(services: CommandServices, arg: unknown): Promise<string | undefined> {
  const config = await readLocalConfig().catch(() => null);
  if (!config) {
    void showDeduped('warn', t('Lattice is not initialized yet.'));
    return undefined;
  }

  let target = usernameArg(arg)?.trim();
  if (!target) {
    const users = await listUsers().catch(() => [] as string[]);
    if (users.length === 0) {
      void showDeduped('warn', t('No users found.'));
      return undefined;
    }
    interface UserPickItem extends vscode.QuickPickItem {
      username: string;
    }
    const items: UserPickItem[] = users.map((user) => ({
      label: `$(account) ${user}`,
      description: user === config.username ? t('current user') : undefined,
      username: user,
    }));
    const picked = await vscode.window.showQuickPick(items, { title: t('Switch User') });
    if (!picked) return undefined;
    target = picked.username;
  }

  if (!USERNAME_PATTERN.test(target) || !(await dirExists(getUserDir(target)))) {
    void showDeduped('warn', t('User not found: {0}', target));
    return undefined;
  }
  if (target === config.username) {
    void showDeduped('info', t('Already the current user: {0}', target));
    return target;
  }

  await writeLocalConfig({ ...config, username: target });
  services.userScope?.exit();
  await resetSession(services);
  void showDeduped('info', t('Switched to user: {0}', target));
  return target;
}

/** 重命名当前用户（目录 + DB 索引；core renameUser）。 */
async function renameCurrentUser(
  services: CommandServices,
  arg: unknown,
): Promise<string | undefined> {
  const current = await getUsername().catch(() => undefined);
  if (!current) {
    void showDeduped('warn', t('Lattice is not initialized yet.'));
    return undefined;
  }

  let nextName = usernameArg(arg);
  if (nextName === undefined) {
    nextName = await vscode.window.showInputBox({
      title: t('Rename User'),
      prompt: t('New name for "{0}"', current),
      value: current,
      validateInput: (value) => validateNewName(value),
    });
    if (nextName === undefined) return undefined;
  } else {
    const error = await validateNewName(nextName);
    if (error) {
      void showDeduped('warn', error);
      return undefined;
    }
  }
  const next = nextName.trim();
  if (next === current) return undefined;

  const force = extractArgObject<{ force?: boolean }>(arg)?.force === true;
  if (!force) {
    const rename = t('Rename');
    const confirmed = await vscode.window.showWarningMessage(
      t(
        'Rename user "{0}" to "{1}"? Directories and the database index will be updated.',
        current,
        next,
      ),
      { modal: true },
      rename,
    );
    if (confirmed !== rename) return undefined;
  }

  try {
    await withNotificationProgress(t('Renaming user…'), async () => {
      await services.data.warmDb(); // renameUser 需要打开的 DB
      await renameUser(current, next);
    });
    await resetSession(services);
    void showDeduped('info', t('User renamed: {0} → {1}', current, next));
    return next;
  } catch (error) {
    await handleCliError(error, t('Failed to rename the user'));
    return undefined;
  }
}

/** 只读浏览其他用户（视图切到对方数据；写入统一被数据面拦截）。 */
async function browseUser(services: CommandServices, arg: unknown): Promise<string | undefined> {
  const current = await getUsername().catch(() => undefined);
  const users = await listUsers().catch(() => [] as string[]);
  let target = usernameArg(arg)?.trim();

  if (!target) {
    const others = users.filter((user) => user !== current);
    if (others.length === 0) {
      void showDeduped('warn', t('No other users to browse.'));
      return undefined;
    }
    interface UserPickItem extends vscode.QuickPickItem {
      username: string;
    }
    const picked = await vscode.window.showQuickPick<UserPickItem>(
      others.map((user) => ({ label: `$(account) ${user}`, username: user })),
      { title: t('Browse Another User (Read-only)') },
    );
    if (!picked) return undefined;
    target = picked.username;
  }

  if (!USERNAME_PATTERN.test(target) || !(await dirExists(getUserDir(target)))) {
    void showDeduped('warn', t('User not found: {0}', target));
    return undefined;
  }
  if (target === current) {
    void showDeduped('warn', t('Already viewing your own data.'));
    return undefined;
  }

  services.userScope?.enter(target);
  await resetSession(services);
  void showDeduped('info', t('Browsing "{0}" (read-only). Click the status bar to exit.', target));
  return target;
}

/** 退出只读浏览，回到当前配置用户。 */
async function exitBrowse(services: CommandServices): Promise<void> {
  const previous = services.userScope?.browseUser;
  if (!previous) return;
  services.userScope?.exit();
  await resetSession(services);
  void showDeduped('info', t('Exited read-only browsing ({0}).', previous));
}

/** 用户管理入口：切换 / 新建 / 重命名 / 退出只读浏览（状态栏点击直达）。 */
async function userManager(services: CommandServices): Promise<void> {
  const current = await getUsername().catch(() => undefined);
  const users = await listUsers().catch(() => [] as string[]);
  const browsing = services.userScope?.browseUser;

  interface ManagerItem extends vscode.QuickPickItem {
    action?: 'switch' | 'create' | 'rename' | 'exit';
    username?: string;
  }
  const items: ManagerItem[] = users.map((user) => {
    const tags = [
      user === current ? t('current user') : '',
      user === browsing ? t('browsing (read-only)') : '',
    ].filter(Boolean);
    return {
      label: `$(account) ${user}`,
      description: tags.join(' · ') || undefined,
      action: 'switch' as const,
      username: user,
    };
  });
  items.push({ label: t('Manage'), kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: `$(add) ${t('New User…')}`, action: 'create' });
  items.push({ label: `$(edit) ${t('Rename Current User…')}`, action: 'rename' });
  if (browsing) {
    items.push({ label: `$(close) ${t('Exit Read-only Browsing')}`, action: 'exit' });
  }

  const picked = await vscode.window.showQuickPick(items, { title: t('Manage Users…') });
  if (!picked?.action) return;
  switch (picked.action) {
    case 'switch':
      if (picked.username) await switchUser(services, picked.username);
      break;
    case 'create':
      await createUser(undefined);
      break;
    case 'rename':
      await renameCurrentUser(services, undefined);
      break;
    case 'exit':
      await exitBrowse(services);
      break;
  }
}

/** 多用户命令族：切换 / 新建 / 重命名 / 只读浏览 / 管理面板。 */
export function registerUserCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.user.manager', () => userManager(services));
  register('lattice.user.switch', (arg) => switchUser(services, arg));
  register('lattice.user.create', (arg) => createUser(arg));
  register('lattice.user.rename', (arg) => renameCurrentUser(services, arg));
  register('lattice.user.browse', (arg) => browseUser(services, arg));
  register('lattice.user.browse.exit', () => exitBrowse(services));
}
