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
  getEmbeddingConfig,
  isModelInstalled,
  applyEmbeddingModelPreset,
  clearEmbeddingModelPresetFields,
  getByPath,
  setByPath,
  deleteByPath,
  diffConfig,
} from '@qcqx/lattice-core';
import { logger, outputJson, reportFailure, reportFailureHint } from '../utils';

type ConfigScope = 'global' | 'local';

/** 修改这些 embedding 参数会影响索引内容或查询向量，需要重建索引 */
const EMBEDDING_REBUILD_KEYS = new Set([
  'rag.embedding.dimension',
  'rag.embedding.dtype',
  'rag.embedding.pooling',
  'rag.embedding.queryPrefix',
  'rag.embedding.documentPrefix',
  'rag.embedding.minChunkSize',
]);

interface ScopeOptions {
  scope?: string;
}

interface ShowOptions extends ScopeOptions {
  json?: boolean;
  jsonFormat?: boolean;
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
    .option('--scope <scope>', '配置范围（global 或 local）')
    .option('--diff-defaults', '仅显示与默认值不同的配置')
    .action(async (...args: unknown[]) => {
      const opts = extractShowOptions(args);
      const command = args.at(-1) instanceof Command ? (args.at(-1) as Command) : undefined;
      await showConfig(
        Boolean(opts.json),
        resolveScope(opts, command),
        Boolean(opts.diffDefaults),
        opts.jsonFormat,
      );
    });

  cmd
    .command('get <key>')
    .description('读取单个配置项，使用点路径')
    .option('--scope <scope>', '配置范围（global 或 local）')
    .action(
      async (
        key: string,
        opts: ScopeOptions & { json?: boolean; jsonFormat?: boolean },
        command: Command,
      ) => {
        try {
          await ensureInitialized();
          const { config } = await loadConfig(resolveScope(opts, command));
          let value = getByPath(config, key);

          // embedding 的完整默认值由 core 统一管理，未显式写入 config 时也能读到实际生效值
          if (
            value === undefined &&
            (key === 'rag.embedding' || key.startsWith('rag.embedding.'))
          ) {
            const embedding = await getEmbeddingConfig();
            const embeddingKey = key.replace(/^rag\.embedding\.?/, '');
            value = embeddingKey
              ? getByPath(embedding as unknown as Record<string, unknown>, embeddingKey)
              : embedding;
          }

          if (value === undefined) {
            reportFailure(`未找到配置项：${key}`);
            process.exitCode = 1;
            return;
          }

          if (opts.json || typeof value === 'object') {
            outputJson(value, opts.jsonFormat);
            return;
          }

          logger.raw(String(value));
        } catch (err) {
          logger.stderr(chalk.red('错误：'), (err as Error).message);
          process.exitCode = 1;
        }
      },
    );

  cmd
    .command('set <key> <value>')
    .description('设置单个配置项，使用点路径')
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

          let rebuildModelId: string | null = null;
          let embeddingParamChanged = false;
          if (key === 'rag.embedding.modelId') {
            if (typeof parsedValue !== 'string' || !parsedValue.trim()) {
              throw new Error('模型 ID 不能为空');
            }
            const modelId = parsedValue.trim();
            const storedModelId = getByPath(config, key);
            const previousModelId =
              typeof storedModelId === 'string' && storedModelId.trim()
                ? storedModelId.trim()
                : (await getEmbeddingConfig()).modelId;
            const result = applyEmbeddingModelPreset(config, modelId, {
              scope,
              previousModelId,
            });

            if (result.preset) {
              if (result.modelChanged) {
                logger.raw(
                  chalk.dim(
                    `已同步模型预设：${result.preset.dimension} 维 / ${result.preset.dtype} / ${result.preset.pooling}`,
                  ),
                );
              } else if (result.appliedFields.length > 0) {
                logger.raw(
                  chalk.dim(`模型未变化，已补齐缺失参数：${result.appliedFields.join(' / ')}`),
                );
              } else {
                logger.raw(chalk.dim('模型未变化，保留现有 dimension / dtype / 前缀设置'));
              }

              if (result.appliedFields.length > 0) {
                rebuildModelId = modelId;
              }
            } else if (result.modelChanged) {
              logger.raw(
                chalk.yellow(
                  '未识别的模型：已更新 modelId 并清空旧模型前后缀；请先设置 rag.embedding.dimension，再运行 ltc rag rebuild',
                ),
              );
              rebuildModelId = modelId;
            }
          } else {
            const before = getByPath(config, key);
            setByPath(config, key, parsedValue);
            if (
              EMBEDDING_REBUILD_KEYS.has(key) &&
              JSON.stringify(before) !== JSON.stringify(parsedValue)
            ) {
              embeddingParamChanged = true;
            }
          }

          await saveConfig(scope, config);
          logger.raw(chalk.green(`✓ 已更新 ${scope} 配置 ${key}`));
          if (rebuildModelId) {
            try {
              const effective = await getEmbeddingConfig();
              if (effective.modelId !== rebuildModelId) {
                logger.raw(
                  chalk.yellow(
                    `本机配置中的 rag.embedding.modelId 覆盖了本次设置（当前生效：${effective.modelId}）`,
                  ),
                );
              }
              await reportModelRebuildHint(effective.modelId);
            } catch {
              await reportModelRebuildHint(rebuildModelId);
            }
          } else if (embeddingParamChanged) {
            logger.raw(chalk.yellow('embedding 参数已变更；请运行 ltc rag rebuild 重建索引'));
          }
        } catch (err) {
          logger.stderr(chalk.red('错误：'), (err as Error).message);
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
          reportFailure(`未找到配置项：${key}`);
          process.exitCode = 1;
          return;
        }

        if (key === 'rag.embedding.modelId') {
          const removedRelated = clearEmbeddingModelPresetFields(config);
          const fallbackLabel = scope === 'global' ? '默认' : '全局/默认';
          logger.raw(
            chalk.yellow(
              `模型已移除，回落到${fallbackLabel}模型参数${removedRelated.length > 0 ? `（同步清理 ${removedRelated.length} 项）` : ''}`,
            ),
          );
        }

        await saveConfig(scope, config);
        logger.raw(chalk.green(`✓ 已移除 ${scope} 配置 ${key}`));
        if (key === 'rag.embedding.modelId') {
          try {
            const effective = await getEmbeddingConfig();
            await reportModelRebuildHint(effective.modelId);
          } catch {
            logger.raw(chalk.yellow('请运行 ltc rag rebuild 重建索引'));
          }
        }
      } catch (err) {
        logger.stderr(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}

async function reportModelRebuildHint(modelId: string): Promise<void> {
  try {
    const installed = await isModelInstalled(modelId);
    logger.raw(
      chalk.yellow(
        installed
          ? `模型 ${modelId} 已安装；请运行 ltc rag rebuild 重建索引`
          : `模型 ${modelId} 尚未安装；请运行 ltc rag rebuild 下载模型并重建索引`,
      ),
    );
  } catch {
    logger.raw(chalk.yellow('请运行 ltc rag rebuild 重建索引（无法读取模型安装状态）'));
  }
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
  jsonFormat?: boolean,
): Promise<void> {
  try {
    await ensureInitialized();
    const { path, config } = await loadConfig(scope);
    let effectiveConfig = config;

    // 默认值由 core 统一解析；普通 show 展示实际生效值，diff-defaults 仍只展示显式差异
    if (scope === 'global' && !diffDefaults) {
      const embedding = await getEmbeddingConfig();
      const rag = (config.rag ?? {}) as Record<string, unknown>;
      const configuredEmbedding = (rag.embedding ?? {}) as Record<string, unknown>;
      effectiveConfig = {
        ...config,
        rag: {
          ...rag,
          embedding: {
            ...embedding,
            ...configuredEmbedding,
          },
        },
      };
    }

    const output = diffDefaults ? diffConfig(config, getDefaultConfig(scope)) : effectiveConfig;

    if (asJson) {
      outputJson(output, jsonFormat);
      return;
    }

    logger.raw(chalk.bold(`\nLattice 配置（${scope}${diffDefaults ? '，仅差异' : ''}）\n`));
    logger.raw(`  路径：${path}`);
    logger.raw('');
    logger.raw(JSON.stringify(output, null, 2));
    logger.raw('');
  } catch (err) {
    logger.stderr(chalk.red('错误：'), (err as Error).message);
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
