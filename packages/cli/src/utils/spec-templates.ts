import chalk from 'chalk';
import { checkbox } from '@inquirer/prompts';
import {
  listBundledSpecTemplates,
  syncBundledSpecTemplates,
  type DocLanguage,
} from '@qcqx/lattice-core';
import { logger } from './logger';

function normalizeTemplateNames(input: string): string[] {
  return [
    ...new Set(
      input
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export async function resolveBundledSpecTemplateNames(
  input?: string,
  language?: DocLanguage,
): Promise<string[]> {
  const bundledTemplates = await listBundledSpecTemplates(language);
  const availableTemplateNames = bundledTemplates.map((template) => template.name);

  if (!input || input.trim() === '' || input.trim() === 'all') {
    return availableTemplateNames;
  }

  const requestedTemplateNames = normalizeTemplateNames(input);
  if (requestedTemplateNames.length === 1 && requestedTemplateNames[0] === 'all') {
    return availableTemplateNames;
  }

  const invalidTemplateNames = requestedTemplateNames.filter(
    (templateName) => !availableTemplateNames.includes(templateName),
  );
  if (invalidTemplateNames.length > 0) {
    throw new Error(
      `未找到内置模板：${invalidTemplateNames.join(', ')}。可用模板：${availableTemplateNames.join(', ')}`,
    );
  }

  return requestedTemplateNames;
}

export interface BundledSpecSyncSummary {
  synced: string[];
  skipped: string[];
  missing: string[];
}

export interface BundledSpecSyncOptions {
  /** 跳过覆盖选择（`ltc init -f` 等非交互调用），保留已有模板。 */
  skipPrompt?: boolean;
  /** 内置模板语言；缺省使用 languages.json 的 defaultLanguage。 */
  language?: DocLanguage;
}

export async function syncBundledSpecTemplatesWithPrompt(
  templateNames: string[],
  options: BundledSpecSyncOptions = {},
): Promise<BundledSpecSyncSummary> {
  const initialResult = await syncBundledSpecTemplates({
    templateNames,
    language: options.language,
  });
  let overwriteTemplateNames: string[] = [];
  let skippedTemplateNames: string[] = [];

  if (initialResult.conflicts.length > 0) {
    logger.raw(chalk.yellow(`检测到 ${initialResult.conflicts.length} 个已存在的内置模板：`));
    if (options.skipPrompt || !process.stdin.isTTY) {
      // 非交互/显式跳过确认：默认保留现有模板，否则 @inquirer/prompts 会直接抛
      // "User force closed the prompt"，中断整个 init。
      skippedTemplateNames = initialResult.conflicts.map((conflict) => conflict.name);
      logger.raw(
        chalk.dim(
          options.skipPrompt
            ? '  已跳过确认：保留现有模板，全部跳过覆盖'
            : '  非交互环境：保留现有模板，全部跳过覆盖',
        ),
      );
    } else {
      overwriteTemplateNames = await checkbox({
        message: '请选择要覆盖的内置模板（默认全不选，直接回车表示全部跳过）：',
        choices: initialResult.conflicts.map((conflict) => ({
          name: conflict.name,
          value: conflict.name,
        })),
      });
      skippedTemplateNames = initialResult.conflicts
        .map((conflict) => conflict.name)
        .filter((name) => !overwriteTemplateNames.includes(name));
    }
  }

  const syncedTemplateNames = [...initialResult.synced];
  const missingTemplateNames = [...initialResult.missing];

  if (overwriteTemplateNames.length > 0) {
    const overwriteResult = await syncBundledSpecTemplates({
      templateNames: overwriteTemplateNames,
      overwriteExistingNames: overwriteTemplateNames,
      language: options.language,
    });

    if (overwriteResult.conflicts.length > 0) {
      throw new Error(
        `仍有未解决的模板冲突：${overwriteResult.conflicts.map((item) => item.name).join(', ')}`,
      );
    }

    syncedTemplateNames.push(...overwriteResult.synced);
    missingTemplateNames.push(...overwriteResult.missing);
  }

  return {
    synced: [...new Set(syncedTemplateNames)],
    skipped: skippedTemplateNames,
    missing: [...new Set(missingTemplateNames)],
  };
}
