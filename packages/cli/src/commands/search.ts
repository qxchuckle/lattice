import { Command } from 'commander';
import chalk from 'chalk';
import os from 'node:os';
import {
  getUsername,
  initDb,
  closeDb,
  unifiedSearch,
  isModelLoaded,
  isModelLoadNetworkError,
  formatModelNetworkHint,
} from '@qcqx/lattice-core';
import { logger, outputJson } from '../utils';
import type { SearchResult } from '@qcqx/lattice-core';

/** 精简 JSON 输出：只保留对调用方有用的字段 */
const META_FIELDS_KEEP = new Set([
  'filePath',
  'username',
  'projectIds',
  'semanticRank',
  'semanticDistance',
  'matchedSections',
  'normalizedScore',
  'weakMatch',
  'duplicates',
  'taskId',
  'matchedVia',
]);

function cleanResultsForJson(results: SearchResult[]): unknown[] {
  return results.map((r) => {
    const meta = r.meta as Record<string, unknown>;
    const cleanMeta: Record<string, unknown> = {};
    for (const key of Object.keys(meta)) {
      if (META_FIELDS_KEEP.has(key) && meta[key] !== null && meta[key] !== undefined) {
        const val = meta[key];
        cleanMeta[key] = typeof val === 'number' ? Math.round(val * 10000) / 10000 : val;
      }
    }
    return {
      type: r.type,
      title: r.title,
      snippet: r.snippet,
      score: Math.round((r.score ?? 0) * 10000) / 10000,
      meta: cleanMeta,
    };
  });
}

function parseUsersOption(input?: string): string[] {
  return Array.from(
    new Set(
      (input ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

// snippet 里的 **xxx** 是 FTS5 highlight 标记，换成终端高亮，
// 同时压准多余空白与换行，避免输出多行塑恶。
function prettifySnippet(snippet: string): string {
  if (!snippet) return '';
  return snippet
    .replace(/\s+/g, ' ')
    .replace(/\*\*(.+?)\*\*/g, (_match, inner: string) => chalk.cyan.bold(inner))
    .trim();
}

// 将路径中的 $HOME 替换为 ~，并里路径裁叠到合理长度，保留首尾。
function shortenPath(filePath: string, maxLength = 96): string {
  if (!filePath) return '';
  const home = os.homedir();
  let p = filePath;
  if (home && p.startsWith(home)) {
    p = '~' + p.slice(home.length);
  }
  if (p.length <= maxLength) return p;
  const head = Math.floor(maxLength * 0.4);
  const tail = maxLength - head - 3;
  return `${p.slice(0, head)}...${p.slice(p.length - tail)}`;
}

function inferScopeLabel(filePath: string, type: string): string {
  const norm = (filePath ?? '').replace(/\\/g, '/');
  if (type === 'spec') {
    if (norm.includes('/projects/') && norm.includes('/spec/')) return 'project';
    if (norm.includes('/users/') && norm.includes('/spec/')) return 'user';
    return 'global';
  }
  if (type === 'project') return 'project';
  if (type === 'task' || type === 'design') return 'task';
  if (type === 'checkpoint') return 'task';
  if (type === 'relation') return 'relation';
  return type || '';
}

function formatScorePercent(score: number | undefined, normalized: number | undefined): string {
  if (typeof normalized === 'number' && Number.isFinite(normalized)) {
    return `${Math.round(normalized * 100)}%`;
  }
  if (typeof score === 'number' && Number.isFinite(score)) {
    return score.toFixed(3);
  }
  return '';
}

const TYPE_ICON: Record<string, string> = {
  spec: '📄',
  task: '📋',
  design: '📐',
  project: '📁',
  checkpoint: '🏷️ ',
  relation: '🔗',
};

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('搜索 spec、任务、项目、检查点和关联关系')
    .option('--type <type>', '限制搜索类型（spec / task / project / checkpoint / relation）')
    .option('--project <id>', '限制在指定项目范围内')
    .option('--users <names>', '只搜索指定用户内容，逗号分隔')
    .option('--current-user', '只搜索当前用户内容')
    .option('--limit <n>', '每类别返回结果数量', '10')
    .option('--spec-limit <n>', 'Spec 结果数量（覆盖 --limit）')
    .option('--task-limit <n>', '任务结果数量（覆盖 --limit）')
    .option('--project-limit <n>', '项目结果数量（覆盖 --limit）')
    .option('--no-rerank', '关闭轻量 rerank，对比 first-stage 排序')
    .option('--show-duplicates', '展开同名重复项的详细信息')
    .option('--json', 'JSON 格式输出')
    .option('--json-full', 'JSON 输出完整 meta（含内部调试字段）')
    .option('--json-format', 'JSON 输出时使用格式化（默认压缩）')
    .action(async (query: string, opts) => {
      let spinnerActive = false;
      try {
        const currentUser = await getUsername();
        await initDb();

        if (opts.currentUser && opts.users) {
          throw new Error('--users 与 --current-user 不能同时使用');
        }

        const specifiedUsers = parseUsersOption(opts.users as string | undefined);
        const usernames = opts.currentUser
          ? [currentUser]
          : specifiedUsers.length > 0
            ? specifiedUsers
            : undefined; // 默认搜索所有用户

        const modelLoaded = isModelLoaded();
        logger.spin(
          modelLoaded
            ? `正在搜索 “${query}”...`
            : `首次搜索需要加载或下载 embedding 模型，正在准备 “${query}”...`,
        );
        spinnerActive = true;

        const results: SearchResult[] = await unifiedSearch(query, {
          type: opts.type,
          projectId: opts.project,
          usernames,
          limit: parseInt(opts.limit, 10),
          specLimit: opts.specLimit ? parseInt(opts.specLimit, 10) : undefined,
          taskLimit: opts.taskLimit ? parseInt(opts.taskLimit, 10) : undefined,
          projectLimit: opts.projectLimit ? parseInt(opts.projectLimit, 10) : undefined,
          useLightweightRerank: opts.rerank,
        });
        const showDuplicates = Boolean(opts.showDuplicates);

        if (isModelLoaded()) {
          logger.spinSuccess(modelLoaded ? '搜索完成' : '模型加载完成，搜索完成');
        } else {
          logger.spinFail('模型加载失败，搜索结果可能不完整');
          if (isModelLoadNetworkError()) {
            logger.raw(chalk.yellow(formatModelNetworkHint()));
          }
        }
        spinnerActive = false;

        if (opts.json) {
          outputJson(opts.jsonFull ? results : cleanResultsForJson(results), opts.jsonFormat);
          return;
        }

        if (results.length === 0) {
          logger.raw(chalk.dim('未找到相关结果。'));
          return;
        }

        const totalDuplicates = results.reduce((sum, r) => {
          const dc = (r.meta as Record<string, unknown>).duplicateCount;
          return sum + (typeof dc === 'number' ? dc : 0);
        }, 0);
        const weakCount = results.reduce(
          (sum, r) => sum + ((r.meta as Record<string, unknown>).weakMatch === true ? 1 : 0),
          0,
        );
        const headerParts: string[] = [];
        if (totalDuplicates > 0) headerParts.push(`已折叠 ${totalDuplicates} 项同名`);
        if (weakCount > 0) headerParts.push(`${weakCount} 项弱命中`);
        const headerExtra =
          headerParts.length > 0 ? chalk.dim(`（${headerParts.join('、')}）`) : '';
        logger.raw(chalk.blue(`\n找到 ${results.length} 个结果${headerExtra}\n`));

        // 无 --type 时按类型分组输出；有 --type 时平铺
        const grouped = !opts.type;
        if (grouped) {
          const groups: { label: string; types: string[]; items: SearchResult[] }[] = [
            { label: '项目', types: ['project'], items: [] },
            { label: 'Spec', types: ['spec'], items: [] },
            { label: '任务', types: ['task', 'design', 'checkpoint'], items: [] },
            { label: '关联关系', types: ['relation'], items: [] },
          ];
          for (const r of results) {
            const g = groups.find((g) => g.types.includes(r.type));
            if (g) g.items.push(r);
            else groups[groups.length - 1].items.push(r); // fallback
          }
          for (const g of groups) {
            if (g.items.length === 0) continue;
            logger.raw(chalk.bold.underline(`${g.label}（${g.items.length}）`));
            logger.raw('');
            for (const r of g.items) {
              outputSingleResult(r, showDuplicates);
            }
          }
        } else {
          for (const r of results) {
            outputSingleResult(r, showDuplicates);
          }
        }
      } catch (err) {
        if (spinnerActive) {
          logger.spinFail('搜索失败');
        }
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      } finally {
        closeDb();
      }
    });
}

function outputSingleResult(r: SearchResult, showDuplicates: boolean): void {
  const meta = r.meta as Record<string, unknown>;
  const icon = TYPE_ICON[r.type] ?? '•';
  const filePath = (meta.filePath as string) ?? '';
  const username = (meta.username as string) || '';
  const taskId = (meta.taskId as string) || '';
  const scope = inferScopeLabel(filePath, r.type);
  const isWeak = meta.weakMatch === true;
  const scoreLabel = formatScorePercent(r.score, meta.normalizedScore as number | undefined);
  const tagParts: string[] = [r.type];
  if (scope && scope !== r.type) tagParts.push(scope);
  if (scoreLabel) tagParts.push(scoreLabel);
  if (isWeak) tagParts.push('弱命中');
  const tag = isWeak
    ? chalk.yellow.dim(`[${tagParts.join(' · ')}]`)
    : chalk.dim(`[${tagParts.join(' · ')}]`);

  const titlePart = isWeak ? chalk.dim(r.title) : chalk.bold(r.title);
  let header = `  ${icon} ${titlePart} ${tag}`;
  const dupCount = (meta.duplicateCount as number) ?? 0;
  if (dupCount > 0) {
    header += ' ' + chalk.yellow(`· 还有 ${dupCount} 项同名`);
  }
  logger.raw(header);

  const snippet = prettifySnippet(r.snippet);
  if (snippet) {
    const truncated = snippet.length > 140 ? snippet.slice(0, 140) + '...' : snippet;
    logger.raw(`    ${truncated}`);
  }

  if (username) {
    logger.raw(`    ${chalk.dim(`用户：${username}`)}`);
  }
  if (taskId) {
    logger.raw(`    ${chalk.dim(`任务：${taskId}`)}`);
  }
  const matchedVia = meta.matchedVia as
    | { docType: string; docTitle: string; taskId?: string }
    | undefined;
  if (matchedVia && meta.source !== 'task-ref') {
    logger.raw(`    ${chalk.green(`↳ 经由任务「${matchedVia.docTitle}」关联发现`)}`);
  }
  if (filePath) {
    logger.raw(`    ${chalk.dim(shortenPath(filePath))}`);
  }

  if (showDuplicates && dupCount > 0) {
    const dups = (meta.duplicates as Array<Record<string, unknown>>) ?? [];
    for (const d of dups) {
      const dPath = (d.filePath as string) || '';
      const dScore = formatScorePercent(d.score as number | undefined, undefined);
      logger.raw(
        `      ${chalk.dim('↳')} ${chalk.dim(shortenPath(dPath))}` +
          (dScore ? chalk.dim(` (${dScore})`) : ''),
      );
    }
  }
  logger.raw('');
}
