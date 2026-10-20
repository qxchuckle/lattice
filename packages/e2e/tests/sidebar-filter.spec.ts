import { expect, test } from '@playwright/test';

test('侧栏本地过滤：命中保留、未命中隐藏', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('#sidebar-search-input');

  await input.fill('演示');
  await expect(page.getByText('E2E 演示项目', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('E2E 演示任务', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('其他项目', { exact: true })).toHaveCount(0);

  await input.fill('其他');
  await expect(page.getByText('其他项目', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('E2E 演示项目', { exact: true })).toHaveCount(0);
});
