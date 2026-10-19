import { expect, test } from '@playwright/test';

test('首屏加载：侧栏搜索框可用、无错误边界', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#sidebar-search-input')).toBeVisible();
  await expect(page.getByText('页面出错了')).toHaveCount(0);
});

test('项目详情路由：/project/:id 渲染名称与描述', async ({ page }) => {
  await page.goto('/project/legacy:e2e-proj');
  await expect(page.getByText('浏览器 E2E 演示项目').first()).toBeVisible();
});
