import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));
const TASK_FILE = resolve(here, '../.tmp-e2e-home/users/e2e/tasks/e2e-task-1/task.json');

function readStatus(): string {
  return JSON.parse(readFileSync(TASK_FILE, 'utf8')).status as string;
}

test('任务详情：PRD 渲染 + 状态下拉写入 task.json（UI → 文件真值）', async ({ page }) => {
  await page.goto('/task/e2e-task-1');
  await expect(page.locator('.detail-component__title')).toHaveText('E2E 演示任务');

  // 文档内容在「文档预览」标签页下（默认选中「关联项目」）
  await page.getByRole('tab', { name: '文档预览' }).click();
  await expect(page.getByText('这是浏览器 E2E 的演示 PRD 正文。')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.detail-component__tags .ant-tag')).toHaveText('in_progress');

  // in_progress → completed：UI 与文件真值同步
  await page.locator('.detail-component__tags button').click();
  await page.getByRole('menuitem', { name: 'completed' }).click();
  await expect(page.locator('.detail-component__tags .ant-tag')).toHaveText('completed');
  await expect.poll(readStatus).toBe('completed');

  // 复位 completed → in_progress（保持 fixture 可重复运行 + 反向断言）
  await page.locator('.detail-component__tags button').click();
  await page.getByRole('menuitem', { name: 'in_progress' }).click();
  await expect(page.locator('.detail-component__tags .ant-tag')).toHaveText('in_progress');
  await expect.poll(readStatus).toBe('in_progress');
});
