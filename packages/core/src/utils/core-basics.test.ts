/**
 * 时间/路径/任务 ID 纯逻辑单测（L1）
 *
 * 覆盖统一时间格式约定（nowISO/todayDateForId）、kebab-case 转换、
 * LATTICE_HOME 覆盖、fast-start 日志文件名、任务 ID 格式。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { nowISO, todayDateForId } from './time';
import {
  toKebabCase,
  getLatticeRoot,
  getAgentCommandsDir,
  getFastStartLogFileName,
} from '../paths';
import { generateTaskId } from '../task';

describe('nowISO / todayDateForId（统一时间格式约定）', () => {
  it('nowISO：ISO 8601 完整时间戳', () => {
    expect(nowISO()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('todayDateForId：date-only，且与 nowISO 日期部分一致', () => {
    const date = todayDateForId();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nowISO().startsWith(date)).toBe(true);
  });
});

describe('toKebabCase', () => {
  it('camelCase / snake_case / 空格 → kebab-case', () => {
    expect(toKebabCase('camelCaseName')).toBe('camel-case-name');
    expect(toKebabCase('snake_case_name')).toBe('snake-case-name');
    expect(toKebabCase('Hello World')).toBe('hello-world');
  });

  it('保留中文与数字，移除其他特殊字符', () => {
    expect(toKebabCase('测试Task 2.0！')).toBe('测试task-20');
  });
});

describe('getLatticeRoot（LATTICE_HOME 覆盖）', () => {
  const original = process.env.LATTICE_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.LATTICE_HOME;
    else process.env.LATTICE_HOME = original;
  });

  it('LATTICE_HOME 设置时优先使用（测试/CI 隔离机制）', () => {
    process.env.LATTICE_HOME = '/tmp/lattice-test-home';
    expect(getLatticeRoot()).toBe('/tmp/lattice-test-home');
  });

  it('未设置时回退 ~/.lattice', () => {
    delete process.env.LATTICE_HOME;
    expect(getLatticeRoot()).toBe(join(homedir(), '.lattice'));
  });
});

describe('getAgentCommandsDir（agent 命令目录单一真相）', () => {
  const original = process.env.LATTICE_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.LATTICE_HOME;
    else process.env.LATTICE_HOME = original;
  });

  it('默认回退到 ~/.lattice/agent/commands（与 getLatticeRoot 同源）', () => {
    delete process.env.LATTICE_HOME;
    expect(getAgentCommandsDir()).toBe(join(homedir(), '.lattice', 'agent', 'commands'));
  });

  it('LATTICE_HOME 覆盖时落在自定义根下（测试/CI 隔离）', () => {
    process.env.LATTICE_HOME = '/tmp/lattice-test-home';
    expect(getAgentCommandsDir()).toBe('/tmp/lattice-test-home/agent/commands');
  });

  it('始终是 getLatticeRoot() 的子路径（不内联 ~/.lattice，单一真相）', () => {
    delete process.env.LATTICE_HOME;
    expect(getAgentCommandsDir().startsWith(getLatticeRoot())).toBe(true);
  });
});

describe('getFastStartLogFileName', () => {
  it('冒号替换为 -，保证文件系统安全', () => {
    expect(getFastStartLogFileName('2026-01-01T10:20:30.000Z')).toBe(
      'log-2026-01-01T10-20-30.000Z.yaml',
    );
  });
});

describe('generateTaskId', () => {
  it('格式：YYYY-MM-DD-<4位hex>-<slug>', () => {
    const id = generateTaskId('测试 Task 标题');
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{4}-/);
    expect(id.startsWith(todayDateForId()), '日期前缀为今天').toBe(true);
  });

  it('slug 为 kebab-case 且截断到 40 字符', () => {
    const longTitle = 'A'.repeat(100);
    const id = generateTaskId(longTitle);
    const slug = id.split('-').slice(4).join('-');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toBe(toKebabCase(longTitle).slice(0, 40));
  });

  it('随机段使多次生成不同', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateTaskId('同名任务')));
    expect(ids.size).toBe(20);
  });
});
