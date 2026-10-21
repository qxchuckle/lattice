import * as vscode from 'vscode';
import { CommandServices, RegisterFn, extractArgObject } from './shared';
import type { ConfigSectionId } from '@qcqx/lattice-protocol';

interface OpenConfigArgs {
  section?: ConfigSectionId;
  anchor?: string;
}

export function registerConfigCommands(services: CommandServices, register: RegisterFn): void {
  register('lattice.config.open', (arg) => {
    const args = extractArgObject<OpenConfigArgs>(arg);
    return services.config?.open({
      ...(args?.section ? { section: args.section } : {}),
      ...(args?.anchor ? { anchor: args.anchor } : {}),
    });
  });

  register('lattice.config.openSettings', (arg) => {
    const key = typeof arg === 'string' ? arg : undefined;
    return vscode.commands.executeCommand(
      'workbench.action.openSettings',
      key ? `@id:${key}` : 'lattice',
    );
  });
}
