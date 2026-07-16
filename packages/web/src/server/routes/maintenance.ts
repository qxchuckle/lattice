import type { FastifyInstance } from 'fastify';
import {
  getUsername,
  runDoctorCheck,
  listTrashItems,
  restoreFromTrash,
  purgeTrashItem,
  emptyTrash,
  type DoctorOptions,
} from '@qcqx/lattice-core';

export function registerDoctorRoutes(app: FastifyInstance): void {
  app.post<{ Body: DoctorOptions }>('/api/doctor/run', async (req) => {
    return await runDoctorCheck(req.body ?? {});
  });
}

export function registerTrashRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { type?: string } }>('/api/trash', async (req) => {
    const username = await getUsername();
    const items = await listTrashItems(username);
    if (req.query.type) {
      return items.filter((i) => i.type === req.query.type);
    }
    return items;
  });

  app.post<{ Params: { id: string } }>('/api/trash/restore/:id', async (req) => {
    await restoreFromTrash(req.params.id);
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/api/trash/purge/:id', async (req) => {
    await purgeTrashItem(req.params.id);
    return { success: true };
  });

  app.post('/api/trash/empty', async () => {
    const username = await getUsername();
    const count = await emptyTrash(username);
    return { success: true, count };
  });
}
