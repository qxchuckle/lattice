import { Command } from 'commander';
import chalk from 'chalk';
import {
  getUsername,
  initDb,
  closeDb,
  getRAGStatus,
  rebuildIndex,
  deleteSearchDocumentsByPrefixes,
  listProjects,
  listTasks,
  getTaskPrd,
  getProjectSpecs,
  getUserSpecs,
  getGlobalSpecs,
  getUsersDir,
  listDir,
} from '@qcqx/lattice-core';
import { formatRagTimestamp, logger } from '../utils';

export function registerRagCommand(program: Command): void {
  const cmd = program.command('rag').description('管理 RAG 索引');

  // status
  cmd
    .command('status')
    .description('查看索引状态')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        await getUsername();
        await initDb();

        const status = await getRAGStatus();
        closeDb();

        if (opts.json) {
          logger.raw(JSON.stringify(status, null, 2));
          return;
        }

        logger.raw(chalk.bold('\nRAG 索引状态\n'));
        logger.raw(`  数据库：${status.dbPath}`);
        logger.raw(`  Embedding 模型：${status.modelId}`);
        logger.raw(`  模型源：${status.remoteHost ?? '仅本地模型'}`);
        logger.raw(`  下载代理：${status.proxy ?? '未配置'}`);
        logger.raw(`  已索引文档：${status.indexedDocuments}`);
        logger.raw(`  已生成向量：${status.totalEmbeddings}`);
        logger.raw(`  向量存储可用：${status.vectorStoreReady ? '是' : '否'}`);
        logger.raw(`  模型已安装：${status.modelInstalled ? '是' : '否'}`);
        logger.raw(`  模型已加载：${status.modelLoaded ? '是' : '否'}`);
        logger.raw(`  最后更新：${formatRagTimestamp(status.lastUpdated)}`);
        logger.raw('');
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });

  // rebuild
  cmd
    .command('rebuild')
    .description('重建全部 embedding 索引')
    .action(async () => {
      try {
        await getUsername();
        await initDb();

        logger.raw(chalk.blue('正在收集搜索文档...'));

        deleteSearchDocumentsByPrefixes(['task/', 'project/', 'user/']);

        const allDocs: {
          filePath: string;
          content: string;
          title: string;
          tags?: string[];
          username: string;
          sourceType?: 'spec' | 'task' | 'project';
          projectId?: string;
          projectIds?: string[];
        }[] = [];

        // 全局 spec
        const globalSpecs = await getGlobalSpecs();
        for (const s of globalSpecs) {
          allDocs.push({
            filePath: s.filePath,
            content: s.content,
            title: s.frontmatter.title ?? s.fileName,
            tags: s.frontmatter.tags,
            username: '',
            sourceType: 'spec',
          });
        }

        const usernames = await listDir(getUsersDir());
        for (const username of usernames) {
          const userSpecs = await getUserSpecs(username);
          for (const s of userSpecs) {
            allDocs.push({
              filePath: s.filePath,
              content: s.content,
              title: s.frontmatter.title ?? s.fileName,
              tags: s.frontmatter.tags,
              username,
              sourceType: 'spec',
            });
          }

          const projects = listProjects(username);
          for (const project of projects) {
            const specs = await getProjectSpecs(username, project.id);
            for (const s of specs) {
              allDocs.push({
                filePath: s.filePath,
                content: s.content,
                title: s.frontmatter.title ?? s.fileName,
                tags: s.frontmatter.tags,
                username,
                sourceType: 'spec',
                projectId: project.id,
                projectIds: [project.id],
              });
            }
          }

          const tasks = await listTasks(username);
          for (const task of tasks) {
            const prd = (await getTaskPrd(username, task.id)) ?? '';
            const taskContent = [
              `任务标题：${task.title}`,
              `任务状态：${task.status}`,
              task.projects?.length ? `关联项目：${task.projects.join(', ')}` : '',
              prd,
            ]
              .filter(Boolean)
              .join('\n\n');
            allDocs.push({
              filePath: `user/${username}/task/${task.id}/prd.md`,
              content: taskContent,
              title: task.title,
              tags: ['task', task.status],
              username,
              sourceType: 'task',
              projectIds: task.projects,
            });
          }

          for (const project of projects) {
            const tags = project.tags ? (JSON.parse(project.tags) as string[]) : [];
            const groups = project.groups ? (JSON.parse(project.groups) as string[]) : [];
            const projectContent = [
              `项目名称：${project.name}`,
              `项目 ID：${project.id}`,
              project.description ? `项目描述：${project.description}` : '',
              project.git_remote ? `Git 仓库：${project.git_remote}` : '',
              groups.length > 0 ? `分组：${groups.join(', ')}` : '',
              tags.length > 0 ? `标签：${tags.join(', ')}` : '',
              `本地路径：${project.local_path}`,
            ]
              .filter(Boolean)
              .join('\n\n');
            allDocs.push({
              filePath: `user/${username}/project/${project.id}/project.md`,
              content: projectContent,
              title: project.name,
              tags: ['project', ...tags, ...groups],
              username,
              sourceType: 'project',
              projectId: project.id,
              projectIds: [project.id],
            });
          }
        }

        logger.raw(chalk.blue(`找到 ${allDocs.length} 个搜索文档，正在建立索引...`));

        const indexed = await rebuildIndex(allDocs);
        closeDb();

        logger.raw(chalk.green(`✓ 索引重建完成，共 ${indexed} 个文档`));
      } catch (err) {
        console.error(chalk.red('错误：'), (err as Error).message);
        process.exitCode = 1;
      }
    });
}
