import { expect, test } from '@playwright/test';

test('全局搜索面板（Ctrl/⌘+P）：打开、输入、点击结果进入项目视图', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+p');

  const input = page.getByPlaceholder(/搜索任务、项目、Spec/);
  await expect(input).toBeVisible();
  await input.fill('E2E 演示项目');

  const firstResult = page.locator('[data-result-index="0"]');
  await expect(firstResult).toBeVisible({ timeout: 15_000 });
  await expect(firstResult).toContainText('E2E 演示项目');

  await firstResult.click();
  await expect(page).toHaveURL(/\/project\//);
});
