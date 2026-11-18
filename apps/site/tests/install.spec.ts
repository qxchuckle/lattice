import { test, expect } from '@playwright/test';
import { siteUrl } from './base';
import catalog from '../../../scripts/installation-channels.json' with { type: 'json' };

const brewChannel = catalog.channels.find(({ id }) => id === 'brew')!;
const curlChannel = catalog.channels.find(({ id }) => id === 'curl')!;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lattice-language-choice', 'en');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__installClipboard = text;
        },
      },
    });
  });
});
for (const route of ['/', '/zh-cn/', '/docs/quick-start/', '/zh-cn/docs/quick-start/']) {
  test(`installation tabs are accessible and copy only the selected command: ${route}`, async ({
    page,
  }) => {
    await page.goto(siteUrl(route));
    const widget = page.locator('lattice-install-tabs').first();
    const command = widget.locator('[data-install-command]:visible');
    const copy = widget.locator('[data-install-copy]:visible');
    const pendingLabel = route.includes('zh-cn') ? '即将提供' : 'Coming soon';
    await expect(widget).toHaveAttribute('data-active-method', 'brew');
    const brew = widget.getByRole('tab', { name: 'Homebrew', exact: true });
    await expect(brew).toHaveAttribute('aria-selected', 'true');
    await expect(widget.getByRole('tabpanel')).toHaveCount(1);
    await brew.focus();
    await expect(brew).toHaveCSS('outline-style', 'solid');
    if (brewChannel.available) {
      await expect(command).toHaveText(`brew install ${brewChannel.tap}/lattice`);
      await copy.click();
      expect(await page.evaluate(() => (window as any).__installClipboard)).toBe(
        `brew install ${brewChannel.tap}/lattice`,
      );
    } else {
      await expect(widget.getByRole('tabpanel')).toContainText(pendingLabel);
      await expect(copy).toHaveCount(0);
    }
    await brew.focus();
    await page.keyboard.press('ArrowRight');
    const npm = widget.getByRole('tab', { name: 'npm', exact: true });
    await expect(npm).toBeFocused();
    await expect(npm).toHaveAttribute('aria-selected', 'true');
    await expect(command).toHaveText('npm install -g @qcqx/lattice-cli');
    await copy.click();
    expect(await page.evaluate(() => (window as any).__installClipboard)).toBe(
      'npm install -g @qcqx/lattice-cli',
    );
    await expect(widget.getByRole('status')).toContainText(
      route.includes('zh-cn') ? '已复制' : 'copied',
    );
    await npm.focus();
    await page.keyboard.press('End');
    await expect(widget.getByRole('tab', { name: 'curl', exact: true })).toBeFocused();
    if (curlChannel.available) {
      await expect(command).toContainText(`/download/v${catalog.publishedVersion}/install.sh`);
      await expect(command).toContainText(`--version ${catalog.publishedVersion}`);
      await expect(copy).toHaveCount(1);
    } else {
      await expect(widget.getByRole('tabpanel')).toContainText(pendingLabel);
      await expect(copy).toHaveCount(0);
    }
    await page.keyboard.press('Home');
    await expect(brew).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(widget.getByRole('tab', { name: 'curl', exact: true })).toBeFocused();
  });
}
test('landing instances remain independent and quick-start link keeps the language/base', async ({
  page,
}) => {
  await page.goto(siteUrl('/zh-cn/'));
  const widgets = page.locator('lattice-install-tabs');
  await expect(widgets).toHaveCount(2);
  await widgets.first().getByRole('tab', { name: 'npm', exact: true }).click();
  await expect(widgets.nth(1)).toHaveAttribute('data-active-method', 'brew');
  await expect(page.locator('.ll-actions a').nth(1)).toHaveAttribute(
    'href',
    siteUrl('/zh-cn/docs/quick-start/'),
  );
  const duplicates = await page
    .locator('[id]')
    .evaluateAll((nodes) => nodes.map((n) => n.id).filter((id, i, all) => all.indexOf(id) !== i));
  expect(duplicates).toEqual([]);
});
test('copy failure is reported without claiming success', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw Error('denied');
        },
      },
    });
    document.execCommand = () => false;
  });
  await page.goto(siteUrl('/docs/quick-start/'));
  const widget = page.locator('lattice-install-tabs');
  await widget.getByRole('tab', { name: 'npm', exact: true }).click();
  await widget.locator('[data-install-copy]:visible').click();
  await expect(widget.getByRole('status')).toContainText('Copy failed');
  await expect(widget.getByRole('status')).not.toContainText('copied');
});
test('no-JavaScript pages keep every method readable in both languages', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const route of ['/', '/zh-cn/', '/docs/quick-start/', '/zh-cn/docs/quick-start/']) {
      await page.goto(siteUrl(route));
      const npmPanel = page.locator('[data-install-panel="npm"]').first();
      await expect(npmPanel).toBeVisible();
      await expect(npmPanel.locator('[data-install-command]')).toHaveText(
        'npm install -g @qcqx/lattice-cli',
      );
    }
  } finally {
    await context.close();
  }
});
for (const width of [1440, 1280, 1024, 768, 390, 360]) {
  test(`installation layout stays readable at ${width}px in both themes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/zh-cn/', '/docs/quick-start/', '/zh-cn/docs/quick-start/']) {
      await page.goto(siteUrl(route));
      const widget = page.locator('lattice-install-tabs').first();
      await widget.getByRole('tab', { name: 'npm', exact: true }).click();
      for (const theme of ['dark', 'light']) {
        await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
        const metrics = await widget.evaluate((el) => ({
          right: el.getBoundingClientRect().right,
          font: parseFloat(getComputedStyle(el.querySelector('[data-install-command]')!).fontSize),
          page: document.documentElement.scrollWidth,
          viewport: innerWidth,
        }));
        expect(metrics.page).toBeLessThanOrEqual(metrics.viewport + 1);
        expect(metrics.right).toBeLessThanOrEqual(width + 1);
        expect(metrics.font).toBeGreaterThanOrEqual(width <= 640 ? 13.5 : 15);
      }
    }
  });
}
