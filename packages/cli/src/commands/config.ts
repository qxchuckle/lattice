import { Command } from 'commander';
import chalk from 'chalk';
import {
  getDefaultGlobalConfig,
  getGlobalConfigPath,
  getDefaultLocalConfig,
  getLocalConfigPath,
  type GlobalConfig,
  isInitialized,
  type LocalConfig,
  readGlobalConfig,
  readLocalConfig,
  writeGlobalConfig,
  writeLocalConfig,
  getByPath,
  setByPath,
  deleteByPath,
  diffConfig,
} from '@qcqx/lattice-core';
import { logger } from '../utils';

type ConfigScope = 'global' | 'local';

interface ScopeOptions {
  scope?: string;
}

interface ShowOptions extends ScopeOptions {
  json?: boolean;
  diffDefaults?: boolean;
}

export function registerConfigCommand(program: Command): void {
  const cmd = program.command('config').description('查看和修改全局配置');

  addScopeOption(cmd)
    .option('--diff-defaults', '仅显示与默认值不同的配置')
    .action(async (...args: unknown[]) => {
      const opts = extractShowOptions(args);
      await showConfig(false, getScope(opts), Boolean(opts.diffDefaults));
    });

  cmd
    .command('show')
    .description('显示完整配置')
    .option('--json', 'JSON 格式输出')
    .option('--scope <scope>', '配置范围（global 或 local）')
    .option('--diff-defaults', '仅显示与默认值不同的配置')
    .action(async (...args: unknown[]) => {
      const opts = extractShowOptions(args);
      const command = args.at(-1) instanceof Command ? (args.at(-1) as Command) : undefined;
      await showConfig(Boolean(opts.json), resolveScope(opts, command), Boolean(opts.diffDefaults));
    });

  cmd
    .command('get <key>')
    .description('读取单个配置项，使用点路径')
    .option('--json', 'JSON 格式输出')
    .option('--scope <scope>', '配置范围（global 或 local）')
    .action(async (key: string, opts: ScopeOptions & { json?: boolean }, command: Command) => {
      try {
        await ensureInitialized();
        const { config } = await loadConfig(resolveScope(opts, command));
        const value = getByPath(config, key);

        if (value === undefined) {
          logger.raw(chalk.yellow(`未找到配置项：${key}`));
          process.exitCode = 1;
          return;
        }

        if (opts.json || typeof value === 'object') {
          logger.raw(JSON.stringify(value, null, 2));
          return;
        }

        logger.raw(String(value));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  cmd
    .command('set <key> <value>')
    .description('设置单个配置项，使用点路径')
    .option('--json', '将 value 按 JSON 解析')
    .option('--scope <scope>', '配置范围（global 或 local）')
    .action(
      async (
        key: string,
        value: string,
        opts: ScopeOptions & { json?: boolean },
        command: Command,
      ) => {
        try {
          await ensureInitialized();
          const scope = resolveScope(opts, command);
          const { config } = await loadConfig(scope);
          const parsedValue = opts.json ? JSON.parse(value) : smartParse(value);
          setByPath(config, key, parsedValue);
          await saveConfig(scope, config);
          logger.raw(chalk.green(`✓ 已更新 ${scope} 配置 ${key}`));
        } catch (err) {
          console.error(chalk.red('错误：'), (err as Error).message);
          process.exitCode = 1;
        }
      },
    );

  cmd
    .command('unset <key>')
    .description('移除单个配置项，使用点路径')
    .option('--scope <scope>', '配置范围（global 或 local）')
    .action(async (key: string, opts: ScopeOptions, command: Command) => {
      try {
        await ensureInitialized();
        const scope = resolveScope(opts, command);
        const { config } = await loadConfig(scope);
        const deleted = deleteByPath(config, key);

        if (!deleted) {
          logger.raw(chalk.yellow(`未找到配置项：${key}`));
          process.exitCode = 1;
          return;
        }

        await saveConfig(scope, config);
        logger.raw(chalk.green(`✓ 已移除 ${scope} 配置 ${key}`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}

function addScopeOption(command: Command): Command {
  return command.option('--scope <scope>', '配置范围（global 或 local）', 'global');
}

function extractShowOptions(args: unknown[]): ShowOptions {
  const maybeCommand = args.at(-1);
  if (maybeCommand instanceof Command) {
    const opts = maybeCommand.opts() as ShowOptions;
    return {
      ...opts,
      json: opts.json ?? process.argv.includes('--json'),
      diffDefaults: opts.diffDefaults ?? process.argv.includes('--diff-defaults'),
    };
  }

  const opts = (args[0] ?? {}) as ShowOptions;
  return {
    ...opts,
    json: opts.json ?? process.argv.includes('--json'),
    diffDefaults: opts.diffDefaults ?? process.argv.includes('--diff-defaults'),
  };
}

function getScope(opts: ScopeOptions): ConfigScope {
  const scope = opts.scope ?? 'global';
  if (scope !== 'global' && scope !== 'local') {
    throw new Error(`无效的 scope：${scope}，仅支持 global 或 local`);
  }
  return scope;
}

function resolveScope(opts: ScopeOptions, command?: Command): ConfigScope {
  if (opts.scope) {
    return getScope(opts);
  }

  const parentOpts = command?.parent?.opts() as ScopeOptions | undefined;
  return getScope(parentOpts ?? {});
}

async function loadConfig(
  scope: ConfigScope,
): Promise<{ path: string; config: Record<string, unknown> }> {
  if (scope === 'local') {
    return {
      path: getLocalConfigPath(),
      config: ((await readLocalConfig()) ?? {}) as Record<string, unknown>,
    };
  }

  return {
    path: getGlobalConfigPath(),
    config: (await readGlobalConfig()) as Record<string, unknown>,
  };
}

async function saveConfig(scope: ConfigScope, config: Record<string, unknown>): Promise<void> {
  if (scope === 'local') {
    await writeLocalConfig(config as LocalConfig);
    return;
  }

  await writeGlobalConfig(config as GlobalConfig);
}

function getDefaultConfig(scope: ConfigScope): Record<string, unknown> {
  return scope === 'local'
    ? (getDefaultLocalConfig() as Record<string, unknown>)
    : (getDefaultGlobalConfig() as Record<string, unknown>);
}

async function showConfig(
  asJson: boolean,
  scope: ConfigScope,
  diffDefaults: boolean,
): Promise<void> {
  try {
    await ensureInitialized();
    const { path, config } = await loadConfig(scope);
    const output = diffDefaults ? diffConfig(config, getDefaultConfig(scope)) : config;

    if (asJson) {
      logger.raw(JSON.stringify(output, null, 2));
      return;
    }

    logger.raw(chalk.bold(`\nLattice 配置（${scope}${diffDefaults ? '，仅差异' : ''}）\n`));
    logger.raw(`  路径：${path}`);
    logger.raw('');
    logger.raw(JSON.stringify(output, null, 2));
    logger.raw('');
  } catch (err) {
    console.error(chalk.red('错误：'), (err as Error).message);
    process.exitCode = 1;
  }
}

async function ensureInitialized(): Promise<void> {
  if (!(await isInitialized())) {
    throw new Error('Lattice 未初始化，请先运行 lattice init');
  }
}

function smartParse(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']')) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}
