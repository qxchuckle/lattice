import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));
const PRD_FILE = resolve(here, '../.tmp-e2e-home/users/e2e/tasks/e2e-task-1/prd.md');

function readPrd(): string {
  return readFileSync(PRD_FILE, 'utf8');
}

test('文档编辑器：编辑保存后真实写入 prd.md', async ({ page }) => {
  test.setTimeout(45_000);
  const original = readPrd();

  try {
    await page.goto('/task/e2e-task-1');
    await expect(page.locator('.detail-component__title')).toHaveText('E2E 演示任务');

    await page.getByRole('tab', { name: '文档预览' }).click();
    await expect(page.getByText('这是浏览器 E2E 的演示 PRD 正文。')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: '编辑' }).click();
    await expect(page.getByText('编辑 - PRD')).toBeVisible();
    const editor = page.locator('.cm-content');
    await expect(editor).toBeVisible({ timeout: 15_000 });

    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('# E2E save verification');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Persisted by browser E2E.');
    await page.getByRole('button', { name: /保\s*存/ }).click();

    await expect(page.getByText('编辑 - PRD')).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(readPrd).toContain('Persisted by browser E2E.');
    expect(readPrd()).toContain('# E2E save verification');
  } finally {
    writeFileSync(PRD_FILE, original);
  }
});
