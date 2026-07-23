/**
 * 文件系统 API — 为 Monaco 编辑器提供文件操作
 * 所有路径经过 isPathSafe 校验
 */
import type { FastifyInstance } from 'fastify';
import { readFile, writeFile, readdir, stat, mkdir, rename, rm } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { getUsername } from '@qcqx/lattice-core';
import { isPathSafe } from './shared';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  mtime?: string;
  children?: FileEntry[];
}

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.pnpm-store']);

async function listDir(dirPath: string, depth: number): Promise<FileEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const result: FileEntry[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const item: FileEntry = { name: entry.name, path: fullPath, type: 'directory' };
      if (depth > 0) {
        try {
          item.children = await listDir(fullPath, depth - 1);
        } catch { /* 权限不足等 */ }
      }
      result.push(item);
    } else {
      try {
        const s = await stat(fullPath);
        result.push({ name: entry.name, path: fullPath, type: 'file', size: s.size, mtime: s.mtime.toISOString() });
      } catch {
        result.push({ name: entry.name, path: fullPath, type: 'file' });
      }
    }
  }

  // 目录在前，文件在后，各自按名称排序
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

export function registerFilesystemRoutes(app: FastifyInstance): void {
  // 目录列表
  app.get('/api/fs/list', async (req, reply) => {
    const { path: dirPath, depth = '1' } = req.query as { path?: string; depth?: string };
    if (!dirPath) return reply.code(400).send({ error: 'path required' });

    const username = await getUsername();
    if (!(await isPathSafe(dirPath, username))) {
      return reply.code(403).send({ error: 'path not allowed' });
    }

    try {
      const entries = await listDir(dirPath, Math.min(Number(depth), 3));
      return { entries };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // 多根目录树（任务 workspace）
  app.get('/api/fs/tree', async (req, reply) => {
    const { roots } = req.query as { roots?: string };
    if (!roots) return reply.code(400).send({ error: 'roots required' });

    const username = await getUsername();
    const paths = roots.split(',').filter(Boolean);
    const result: { root: string; entries: FileEntry[] }[] = [];

    for (const p of paths) {
      if (!(await isPathSafe(p, username))) continue;
      try {
        const entries = await listDir(p, 1);
        result.push({ root: p, entries });
      } catch { /* skip */ }
    }
    return { trees: result };
  });

  // 读文件
  app.get('/api/fs/read', async (req, reply) => {
    const { path: filePath } = req.query as { path?: string };
    if (!filePath) return reply.code(400).send({ error: 'path required' });

    const username = await getUsername();
    if (!(await isPathSafe(filePath, username))) {
      return reply.code(403).send({ error: 'path not allowed' });
    }

    try {
      const s = await stat(filePath);
      if (s.size > MAX_FILE_SIZE) {
        return reply.code(413).send({ error: 'file too large', size: s.size });
      }
      const content = await readFile(filePath, 'utf-8');
      return { content, size: s.size, name: basename(filePath), ext: extname(filePath) };
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  // 写文件
  app.post('/api/fs/write', async (req, reply) => {
    const { path: filePath, content } = req.body as { path?: string; content?: string };
    if (!filePath || content === undefined) return reply.code(400).send({ error: 'path and content required' });

    const username = await getUsername();
    if (!(await isPathSafe(filePath, username))) {
      return reply.code(403).send({ error: 'path not allowed' });
    }

    try {
      await writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // 创建目录
  app.post('/api/fs/mkdir', async (req, reply) => {
    const { path: dirPath } = req.body as { path?: string };
    if (!dirPath) return reply.code(400).send({ error: 'path required' });

    const username = await getUsername();
    if (!(await isPathSafe(dirPath, username))) {
      return reply.code(403).send({ error: 'path not allowed' });
    }

    try {
      await mkdir(dirPath, { recursive: true });
      return { success: true };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // 重命名/移动
  app.post('/api/fs/rename', async (req, reply) => {
    const { from, to } = req.body as { from?: string; to?: string };
    if (!from || !to) return reply.code(400).send({ error: 'from and to required' });

    const username = await getUsername();
    if (!(await isPathSafe(from, username)) || !(await isPathSafe(to, username))) {
      return reply.code(403).send({ error: 'path not allowed' });
    }

    try {
      await rename(from, to);
      return { success: true };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // 删除（进回收站概念：直接删除，前端有确认）
  app.post('/api/fs/delete', async (req, reply) => {
    const { path: targetPath } = req.body as { path?: string };
    if (!targetPath) return reply.code(400).send({ error: 'path required' });

    const username = await getUsername();
    if (!(await isPathSafe(targetPath, username))) {
      return reply.code(403).send({ error: 'path not allowed' });
    }

    try {
      await rm(targetPath, { recursive: true });
      return { success: true };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}
