import type { SearchResult } from '@qcqx/lattice-core';
import type { SearchOpts } from '@qcqx/lattice-web-ui';
import { allSpecs, progress, projects, relations, tasks } from './data';

function snippet(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) return normalized.slice(0, 140);
  const start = Math.max(0, index - 48);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, start + 180)}${normalized.length > start + 180 ? '…' : ''}`;
}

function score(title: string, body: string, query: string): number {
  const q = query.toLowerCase();
  const inTitle = title.toLowerCase().includes(q);
  const inBody = body.toLowerCase().includes(q);
  if (!inTitle && !inBody) return 0;
  return (inTitle ? 6 : 0) + (body.toLowerCase().split(q).length - 1) * 0.6;
}

export function searchAll(query: string, opts: SearchOpts = {}): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const results: SearchResult[] = [];

  for (const project of projects) {
    const id = project.ids[0];
    const body = `${project.name} ${project.description ?? ''} ${(project.tags ?? []).join(' ')}`;
    const value = score(project.name, body, q);
    if (value > 0) {
      results.push({
        type: 'project',
        score: value,
        title: project.name,
        snippet: snippet(body, q),
        meta: { id, projectIds: project.ids, username: 'demo' },
      });
    }
  }

  for (const task of tasks) {
    const body = `${task.title} ${task.status} ${(task.projects ?? []).join(' ')}`;
    const value = score(task.title, body, q);
    if (value > 0) {
      results.push({
        type: 'task',
        score: value,
        title: task.title,
        snippet: snippet(body, q),
        meta: {
          id: task.id,
          taskId: task.id,
          projectIds: task.projects ?? [],
          username: 'demo',
        },
      });
    }
    for (const entry of progress[task.id] ?? []) {
      const checkpointBody = `${entry.title} ${entry.message}`;
      const checkpointScore = score(entry.title, checkpointBody, q);
      if (checkpointScore > 0) {
        results.push({
          type: 'checkpoint',
          score: checkpointScore,
          title: entry.title,
          snippet: snippet(checkpointBody, q),
          meta: {
            id: task.id,
            checkpointId: entry.id,
            taskId: task.id,
            projectIds: task.projects ?? [],
            username: 'demo',
          },
        });
      }
    }
  }

  for (const spec of allSpecs) {
    const title = spec.frontmatter.title ?? spec.fileName;
    const body = `${title} ${spec.frontmatter.description ?? ''} ${spec.content}`;
    const value = score(title, body, q);
    if (value > 0) {
      results.push({
        type: 'spec',
        score: value,
        title,
        snippet: snippet(body, q),
        meta: {
          id: spec.frontmatter.id,
          specId: spec.frontmatter.id,
          filePath: spec.filePath,
          projectIds: spec.projectId ? [spec.projectId] : [],
          username: 'demo',
        },
      });
    }
  }

  for (const relation of relations) {
    const title = `${relation.projectA} → ${relation.projectB}`;
    const body = `${relation.type} ${relation.description ?? ''}`;
    const value = score(title, body, q);
    if (value > 0) {
      results.push({
        type: 'relation',
        score: value,
        title,
        snippet: snippet(body, q),
        meta: {
          id: relation.id,
          relationId: relation.id,
          projectIds: [relation.projectA, relation.projectB],
          username: 'demo',
        },
      });
    }
  }

  return results
    .filter((result) => !opts.type || result.type === opts.type)
    .filter(
      (result) =>
        !opts.projectId ||
        (result.meta.projectIds ?? []).includes(opts.projectId) ||
        result.meta.projectId === opts.projectId,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 30);
}
