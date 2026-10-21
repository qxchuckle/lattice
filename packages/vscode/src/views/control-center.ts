import * as vscode from 'vscode';
import { t } from '../t';

export const CONTROL_CENTER_VIEW_ID = 'lattice.controlCenter';

interface ActionSpec {
  label: string;
  description: string;
  icon: string;
  command: string;
  args?: unknown[];
}

/**
 * 侧栏「配置与维护」视图：把配置中心的高频入口固定在 Lattice 容器里，
 * 避免用户只能从命令面板或视图标题溢出菜单找入口。
 */
export class ControlCenterProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) return [];
    return ACTIONS.map((action) => this.actionItem(action));
  }

  private actionItem(action: ActionSpec): vscode.TreeItem {
    const item = new vscode.TreeItem(action.label, vscode.TreeItemCollapsibleState.None);
    item.description = action.description;
    item.iconPath = new vscode.ThemeIcon(action.icon);
    item.command = {
      command: action.command,
      title: action.label,
      ...(action.args ? { arguments: action.args } : {}),
    };
    item.tooltip = action.description;
    return item;
  }
}

function open(
  section: 'overview' | 'projects' | 'editor' | 'core' | 'users' | 'diagnostics',
): unknown[] {
  return [{ section }];
}

const ACTIONS: ActionSpec[] = [
  {
    label: t('Open Configuration Center'),
    description: t('Overview, projects, config, diagnostics'),
    icon: 'settings-gear',
    command: 'lattice.config.open',
    args: open('overview'),
  },
  {
    label: t('Scan & Register Projects'),
    description: t('Pick directories and scan Git projects'),
    icon: 'telescope',
    command: 'lattice.config.open',
    args: [{ section: 'projects', anchor: 'scan' }],
  },
  {
    label: t('Register This Project'),
    description: t('Register the active project root'),
    icon: 'link',
    command: 'lattice.workspace.link',
  },
  {
    label: t('Switch Active Project'),
    description: t('Choose a project in this workspace'),
    icon: 'arrow-swap',
    command: 'lattice.project.switchActive',
  },
  {
    label: t('Users & Sync'),
    description: t('Users, knowledge-pack domains, data-repo Git'),
    icon: 'cloud',
    command: 'lattice.config.open',
    args: open('users'),
  },
  {
    label: t('Diagnostics & Maintenance'),
    description: t('RAG, Doctor, logs, paths'),
    icon: 'tools',
    command: 'lattice.config.open',
    args: open('diagnostics'),
  },
  {
    label: t('Editor Settings'),
    description: t('Lattice settings and the native settings page'),
    icon: 'settings',
    command: 'lattice.config.open',
    args: open('editor'),
  },
  {
    label: t('Lattice Config'),
    description: t('Core global/local configuration'),
    icon: 'database',
    command: 'lattice.config.open',
    args: open('core'),
  },
];
