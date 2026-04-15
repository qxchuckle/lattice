import { Command } from 'commander';
import { basename } from 'node:path';
import { runStartupSelfCheck } from '@qcqx/lattice-core';
import { registerInitCommand } from './commands/init';
import { registerLinkCommand } from './commands/link';
import { registerUnlinkCommand } from './commands/unlink';
import { registerScanCommand } from './commands/scan';
import { registerProjectCommand } from './commands/project';
import { registerTaskCommand } from './commands/task';
import { registerSpecCommand } from './commands/spec';
import { registerStatusCommand } from './commands/status';
import { registerContextCommand } from './commands/context';
import { registerConfigCommand } from './commands/config';
import { registerSearchCommand } from './commands/search';
import { registerDoctorCommand } from './commands/doctor';
import { registerSyncCommand } from './commands/sync';
import { registerUserCommand } from './commands/user';
import { registerRagCommand } from './commands/rag';

const program = new Command();
const invokedAs = process.argv[1] ? basename(process.argv[1]) : 'lattice';
const cliName = invokedAs === 'index.js' ? 'lattice' : invokedAs;

program.name(cliName).description('Lattice — 跨项目 AI 上下文管理工具').version('0.1.0');

registerInitCommand(program);
registerLinkCommand(program);
registerUnlinkCommand(program);
registerScanCommand(program);
registerProjectCommand(program);
registerTaskCommand(program);
registerSpecCommand(program);
registerStatusCommand(program);
registerContextCommand(program);
registerConfigCommand(program);
registerSearchCommand(program);
registerDoctorCommand(program);
registerSyncCommand(program);
registerUserCommand(program);
registerRagCommand(program);

async function main(): Promise<void> {
  try {
    await runStartupSelfCheck();
  } catch {
    // 启动自检失败不阻断主命令执行
  }

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
