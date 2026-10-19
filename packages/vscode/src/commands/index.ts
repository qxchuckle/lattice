import * as vscode from 'vscode';
import { t } from '../t';
import { CommandServices, RegisterFn, handleCliError } from './shared';
import { registerTaskCommands } from './task';
import { registerDocumentCommands } from './document';
import { registerSpecCommands } from './spec';
import { registerProjectCommands } from './project';
import { registerSearchCommands } from './search';
import { registerSystemCommands } from './system';
import { registerRevealCommands } from './reveal';
import { registerTaskBatchCommands } from './task-batch';
import { registerSpecCreateCommands } from './spec-create';
import { registerCheckpointDraftCommands } from './checkpoint';
import { registerPickerShortcutCommands } from './picker-shortcuts';
import { registerUserCommands } from './user';
import { registerTaskFilterCommands } from './task-filter';
import { registerTaskGroupCommands } from './task-group';
import { registerProjectGroupCommands } from './project-groups';
import { registerViewSearchCommands } from './view-search';
import { registerViewFilterCommands } from './view-filter';
import { registerViewClearCommands } from './view-clear';

export function registerAllCommands(services: CommandServices): void {
  const register: RegisterFn = (id, handler) => {
    services.context.subscriptions.push(
      vscode.commands.registerCommand(id, (...args: unknown[]) =>
        Promise.resolve(handler(...args)).catch((error) =>
          handleCliError(error, t('Lattice command failed')),
        ),
      ),
    );
  };

  registerTaskCommands(services, register);
  registerTaskBatchCommands(services, register);
  registerDocumentCommands(services, register);
  registerSpecCommands(services, register);
  registerSpecCreateCommands(services, register);
  registerCheckpointDraftCommands(services, register);
  registerPickerShortcutCommands(register);
  registerUserCommands(services, register);
  registerTaskFilterCommands(services, register);
  registerTaskGroupCommands(services, register);
  registerViewSearchCommands(services, register);
  registerViewFilterCommands(services, register);
  registerViewClearCommands(services, register);
  registerProjectCommands(services, register);
  registerProjectGroupCommands(services, register);
  registerSearchCommands(services, register);
  registerRevealCommands(services, register);
  registerSystemCommands(services, register);
}
