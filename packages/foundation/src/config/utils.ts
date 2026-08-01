/** 通过点路径读取对象中的嵌套值 */
export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** 通过点路径设置对象中的嵌套值 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (const key of keys.slice(0, -1)) {
    const next = current[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys.at(-1)!] = value;
}

/** 通过点路径删除对象中的嵌套值 */
export function deleteByPath(obj: Record<string, unknown>, path: string): boolean {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (const key of keys.slice(0, -1)) {
    const next = current[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      return false;
    }
    current = next as Record<string, unknown>;
  }

  const finalKey = keys.at(-1)!;
  if (!(finalKey in current)) return false;
  delete current[finalKey];
  return true;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (!deepEqual(left[key], right[key])) return false;
    }
    return true;
  }

  return false;
}

/** 比较两个配置对象，返回与默认值不同的部分 */
export function diffConfig(
  current: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(current), ...Object.keys(defaults)]);

  for (const key of keys) {
    const currentValue = current[key];
    const defaultValue = defaults[key];

    if (isPlainObject(currentValue) && isPlainObject(defaultValue)) {
      const nested = diffConfig(currentValue, defaultValue);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
      continue;
    }

    if (!deepEqual(currentValue, defaultValue) && currentValue !== undefined) {
      result[key] = currentValue;
    }
  }

  return result;
}
