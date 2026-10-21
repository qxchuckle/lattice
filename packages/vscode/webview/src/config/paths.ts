/** Read a dotted path from a nested config object. */
export function readPath(source: Record<string, unknown> | undefined, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Compare config values (arrays / primitives) consistently. */
export function sameConfigValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
