import { test, expect, type Page } from '@playwright/test';
import { siteUrl } from './base';

const tocLink = (page: Page, id: string) => page.locator(`lattice-toc a[href="#${id}"]`);

async function scrollToHeading(page: Page, id: string) {
  await page.evaluate((headingId) => {
    const heading = document.getElementById(headingId);
    if (!heading) throw new Error(`missing heading ${headingId}`);
    const top = heading.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top, behavior: 'instant' });
  }, id);
  await page.waitForTimeout(120);
}

test.describe('docs pages', () => {
  test('repo docs render as site pages with one H1 and the generated sidebar', async ({ page }) => {
    await page.goto(siteUrl('/docs/'));
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText('Lattice Documentation');

    const sidebar = page.locator('.sidebar-content');
    await expect(sidebar.getByRole('link', { name: 'Overview' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Quick start' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Core concepts' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Web workbench' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Architecture' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/qxchuckle/lattice',
    );
  });

  test('the doc being read is highlighted in the sidebar', async ({ page }) => {
    await page.goto(siteUrl('/docs/architecture/'));
    const current = page.locator(
      '.sidebar-content a[aria-current="page"]:not(.ll-nav-select__option)',
    );
    await expect(current).toHaveText('Architecture');

    const styles = await current.evaluate((el) => {
      const { backgroundColor, boxShadow } = getComputedStyle(el);
      return { backgroundColor, boxShadow };
    });
    expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles.boxShadow).not.toBe('none');
  });

  test('internal links keep the base path and language pair', async ({ page }) => {
    await page.goto(siteUrl('/docs/quick-start/'));
    await expect(page.locator('a[href="../architecture/"]').first()).toBeVisible();

    await page.goto(siteUrl('/zh-cn/docs/'));
    await expect(page.locator('a[href="quick-start/"]').first()).toBeVisible();
    await page.goto(siteUrl('/zh-cn/docs/quick-start/'));
    await expect(page.locator('a[href="../architecture/"]').first()).toBeVisible();
  });

  test('the language picker stays on the same doc page', async ({ page }) => {
    await page.goto(siteUrl('/docs/concepts/'));
    const picker = page.locator('[data-language-select]').first();
    await picker.locator('summary').click();
    await picker.getByRole('link', { name: /简体中文/ }).click();
    await expect(page).toHaveURL(siteUrl('/zh-cn/docs/concepts/'));
    await expect(page.locator('h1')).toContainText('核心概念');
  });
});

test.describe('table of contents', () => {
  test('tracks the heading at the top of the viewport, including short sections', async ({
    page,
  }) => {
    await page.goto(siteUrl('/docs/architecture/'));
    await scrollToHeading(page, 'spec-module-spec');
    await expect(tocLink(page, 'spec-module-spec')).toHaveAttribute('aria-current', 'true');

    await scrollToHeading(page, 'task-module-task');
    await expect(tocLink(page, 'task-module-task')).toHaveAttribute('aria-current', 'true');
  });

  test('scrolls back correctly when moving upwards', async ({ page }) => {
    await page.goto(siteUrl('/docs/architecture/'));
    await scrollToHeading(page, 'rag-search-architecture');
    await expect(tocLink(page, 'rag-search-architecture')).toHaveAttribute('aria-current', 'true');

    await scrollToHeading(page, 'cli-layer');
    await expect(tocLink(page, 'cli-layer')).toHaveAttribute('aria-current', 'true');
    await expect(tocLink(page, 'rag-search-architecture')).not.toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('a long TOC keeps the current item inside the visible sidebar', async ({ page }) => {
    await page.goto(siteUrl('/docs/architecture/'));
    await scrollToHeading(page, 'further-reading');
    const link = tocLink(page, 'further-reading');
    await expect(link).toHaveAttribute('aria-current', 'true');

    const [linkBox, sidebarBox] = await Promise.all([
      link.boundingBox(),
      page.locator('.right-sidebar').boundingBox(),
    ]);
    expect(linkBox).not.toBeNull();
    expect(sidebarBox).not.toBeNull();
    expect(linkBox!.y).toBeGreaterThanOrEqual(sidebarBox!.y);
    expect(linkBox!.y + linkBox!.height).toBeLessThanOrEqual(sidebarBox!.y + sidebarBox!.height);
  });

  test('a deep link highlights its heading on entry', async ({ page }) => {
    await page.goto(siteUrl('/docs/architecture/#rag-search-architecture'));
    await expect(tocLink(page, 'rag-search-architecture')).toHaveAttribute('aria-current', 'true');
  });

  test('mobile TOC still opens, closes on click and shows the current section', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(siteUrl('/docs/architecture/#rag-search-architecture'));
    const details = page.locator('#starlight__mobile-toc');
    await expect(details).not.toHaveAttribute('open', '');
    await page.locator('#starlight__on-this-page--mobile').click();
    await expect(details).toHaveAttribute('open', '');
    await page.locator('#starlight__mobile-toc a[href="#cli-layer"]').click();
    await expect(details).not.toHaveAttribute('open', '');
  });
});
