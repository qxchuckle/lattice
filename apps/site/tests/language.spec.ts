import { test, expect } from '@playwright/test';

test.describe('automatic language detection', () => {
  test.use({ locale: 'zh-CN' });

  test('a fresh Chinese browser is sent to the Chinese landing page', async ({ page }) => {
    await page.goto('/lattice/');
    await expect(page).toHaveURL(/\/lattice\/zh-cn\/$/);
    await expect(page.locator('h1')).toContainText('代码库之上');
  });

  test('an explicit Chinese URL is never redirected away', async ({ page }) => {
    await page.goto('/lattice/zh-cn/docs/');
    await expect(page).toHaveURL(/\/lattice\/zh-cn\/docs\/$/);
    await expect(page.locator('h1')).toContainText('文档');
  });

  test('a remembered English choice wins over the browser language', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lattice-language-choice', 'en'));
    await page.goto('/lattice/');
    await expect(page).toHaveURL(/\/lattice\/$/);
    await expect(page.locator('h1')).toContainText('Above the repo.');
  });
});

test.describe('English browser', () => {
  test.use({ locale: 'en-US' });

  test('a fresh English browser stays on the English landing page', async ({ page }) => {
    await page.goto('/lattice/');
    await expect(page).toHaveURL(/\/lattice\/$/);
    await expect(page.locator('h1')).toContainText('Above the repo.');
  });

  test('a remembered Chinese choice is applied to unprefixed URLs', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lattice-language-choice', 'zh'));
    await page.goto('/lattice/');
    await expect(page).toHaveURL(/\/lattice\/zh-cn\/$/);
    await expect(page.locator('h1')).toContainText('代码库之上');
  });

  test('reading the language you are already on does not pin a preference', async ({ page }) => {
    await page.goto('/lattice/');
    await page.locator('[data-language-select] summary').first().click();
    await page.locator('[data-language-choice="en"]').first().click();
    await page.waitForLoadState('load');
    expect(await page.evaluate(() => localStorage.getItem('lattice-language-choice'))).toBeNull();
  });
});

test.describe('demo language selection', () => {
  test.use({ locale: 'zh-CN' });

  test('the demo uses the browser language and remembers a manual choice', async ({ page }) => {
    await page.goto('/lattice/demo/');
    await expect(page.locator('html')).toHaveAttribute('data-demo-lang', 'zh');
    await expect(page.locator('.demo-context')).toContainText('模拟数据');

    await page.locator('[data-set-lang="en"]').click();
    await expect(page).toHaveURL(/lang=en/);
    await expect(page.locator('html')).toHaveAttribute('data-demo-lang', 'en');
    await expect(page.locator('.demo-context')).toContainText('Mock data');
  });
});
