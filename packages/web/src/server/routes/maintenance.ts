import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DoctorOptions } from '@qcqx/lattice-core';
import * as lattice from '@qcqx/lattice-services';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 读取 web 包版本：源码（tsx）与产物（dist/server）两种布局下都向上找到 package.json。 */
function readWebVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, 'utf-8')).version ?? 'dev';
    }
    dir = resolve(dir, '..');
  }
  return 'dev';
}

const pkg = { version: readWebVersion() };

export function registerDoctorRoutes(app: FastifyInstance): void {
  app.post<{ Body: DoctorOptions }>('/api/doctor/run', async (req) => {
    return await lattice.runDoctor({ ...req.body, cliVersion: pkg.version });
  });
}

export function registerTrashRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { type?: string } }>('/api/trash', async (req) => {
    const username = await lattice.currentUsername();
    const items = await lattice.listTrash(username);
    if (req.query.type) {
      return items.filter((i) => i.type === req.query.type);
    }
    return items;
  });

  app.post<{ Params: { id: string } }>('/api/trash/restore/:id', async (req) => {
    const username = await lattice.currentUsername();
    await lattice.restoreTrash(username, req.params.id);
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/api/trash/purge/:id', async (req) => {
    await lattice.purgeTrash(req.params.id);
    return { success: true };
  });

  app.post('/api/trash/empty', async () => {
    const username = await lattice.currentUsername();
    const count = await lattice.emptyTrash(username);
    return { success: true, count };
  });
}
