import { Command } from 'commander';
import { basename, dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { registerTrashCommand } from './commands/trash';

const program = new Command();
const invokedAs = process.argv[1] ? basename(process.argv[1]) : 'lattice';
const cliName = invokedAs === 'index.js' ? 'lattice' : invokedAs;

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

program.name(cliName).description('Lattice — 跨项目 AI 上下文管理工具').version(pkg.version);

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
registerTrashCommand(program);

// 确保所有可执行命令都接受 --force 选项，避免 AI 调用时因 unknown option 报错
function ensureForceOption(cmd: Command): void {
  // 叶子命令：直接添加
  if (cmd.commands.length === 0) {
    const hasForce = cmd.options.some((opt) => opt.long === '--force');
    if (!hasForce) {
      cmd.option('-f, --force', '跳过确认');
    }
  } else {
    // 父命令：不给父级加 --force（避免拦截子命令的 --force），仅递归子命令
    for (const sub of cmd.commands) {
      ensureForceOption(sub);
    }
  }
}
ensureForceOption(program);

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
