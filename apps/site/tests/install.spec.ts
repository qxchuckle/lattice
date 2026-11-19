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
  test(`installation tabs copy the selected command or prompt: ${route}`, async ({ page }) => {
    await page.goto(siteUrl(route));
    const widget = page.locator('lattice-install-tabs').first();
    const feedback = page.locator('.ll-install-feedback');
    const command = widget.locator('[data-install-command]:visible');
    const copy = widget.locator('[data-install-copy]:visible');
    const zh = route.includes('zh-cn');
    const pendingLabel = zh ? '即将提供' : 'Coming soon';
    const aiLabel = zh ? 'AI 安装' : 'AI setup';
    const ai = widget.getByRole('tab', { name: aiLabel, exact: true });
    await expect(widget.getByRole('tab')).toHaveText([aiLabel, 'Homebrew', 'npm', 'curl']);
    await expect(widget).toHaveAttribute('data-active-method', 'ai');
    await expect(ai).toHaveAttribute('aria-selected', 'true');
    await expect(widget.getByRole('tabpanel')).toHaveCount(1);
    await ai.focus();
    await expect(ai).toHaveCSS('outline-style', 'solid');
    const prompt = widget.getByRole('tabpanel').locator('[data-install-text]');
    await expect(prompt).toContainText('ltc --version');
    await expect(prompt).toContainText(
      `https://raw.githubusercontent.com/qxchuckle/lattice/master/docs/quick-start${zh ? '.zh-CN' : ''}.md`,
    );
    await expect(command).toHaveCount(0);
    const heightBeforeCopy = (await widget.boundingBox())?.height;
    await widget.getByRole('button', { name: zh ? '复制提示词' : 'Copy prompt' }).click();
    expect(await page.evaluate(() => (window as any).__installClipboard)).toBe(
      await prompt.textContent(),
    );
    await expect(feedback).toHaveText(zh ? '提示词已复制' : 'Prompt copied');
    await expect(feedback).toHaveAttribute('role', 'status');
    await expect(feedback).toHaveCSS('position', 'fixed');
    await expect(feedback).toHaveCSS('opacity', '1');
    expect((await widget.boundingBox())?.height).toBe(heightBeforeCopy);
    await ai.focus();
    await page.keyboard.press('ArrowRight');
    const brew = widget.getByRole('tab', { name: 'Homebrew', exact: true });
    await expect(brew).toBeFocused();
    await expect(brew).toHaveAttribute('aria-selected', 'true');
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
    await expect(feedback).toHaveText(zh ? '命令已复制' : 'Command copied');
    await npm.focus();
    await page.keyboard.press('End');
    const curl = widget.getByRole('tab', { name: 'curl', exact: true });
    await expect(curl).toBeFocused();
    if (curlChannel.available) {
      await expect(command).toContainText('/latest/download/install.sh');
      await expect(command).not.toContainText('--version');
      await expect(copy).toHaveCount(1);
    } else {
      await expect(widget.getByRole('tabpanel')).toContainText(pendingLabel);
      await expect(copy).toHaveCount(0);
    }
    await page.keyboard.press('Home');
    await expect(ai).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(curl).toBeFocused();
  });
}
test('landing has one installer and uses the localized quick-start links', async ({ page }) => {
  await page.goto(siteUrl('/zh-cn/'));
  await expect(page.locator('lattice-install-tabs')).toHaveCount(1);
  await expect(page.locator('.ll-actions a').nth(1)).toHaveAttribute(
    'href',
    siteUrl('/zh-cn/docs/quick-start/'),
  );
  await expect(page.locator('.ll-flow-footnote a')).toHaveAttribute(
    'href',
    siteUrl('/zh-cn/docs/quick-start/'),
  );
  await expect(page.locator('#get-started a').first()).toHaveAttribute(
    'href',
    siteUrl('/zh-cn/docs/quick-start/'),
  );
  const duplicates = await page
    .locator('[id]')
    .evaluateAll((nodes) => nodes.map((n) => n.id).filter((id, i, all) => all.indexOf(id) !== i));
  expect(duplicates).toEqual([]);
});
test('copy failure is reported without claiming success', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.clock.install();
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
  const feedback = page.locator('.ll-install-feedback');
  await expect(feedback).toHaveAttribute('data-result', 'error');
  await expect(feedback).toHaveText('Copy failed. Select the text to copy it manually.');
  const bounds = (await feedback.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(16);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(344);
  await page.clock.fastForward(4500);
  await expect(feedback).toBeEmpty();
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
      const aiPanel = page.locator('[data-install-panel="ai"]');
      await expect(aiPanel).toBeVisible();
      await expect(aiPanel.locator('[data-install-text]')).toContainText('ltc --version');
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
      for (const name of ['npm', route.includes('zh-cn') ? 'AI 安装' : 'AI setup']) {
        await widget.getByRole('tab', { name, exact: true }).click();
        for (const theme of ['dark', 'light']) {
          await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
          const metrics = await widget.evaluate((el) => {
            const text = el.querySelector<HTMLElement>(
              '[data-install-panel]:not([hidden]) [data-install-text]',
            )!;
            return {
              right: el.getBoundingClientRect().right,
              font: parseFloat(getComputedStyle(text).fontSize),
              page: document.documentElement.scrollWidth,
              viewport: innerWidth,
              textWidth: text.scrollWidth,
              textBox: text.clientWidth,
            };
          });
          expect(metrics.page).toBeLessThanOrEqual(metrics.viewport + 1);
          expect(metrics.right).toBeLessThanOrEqual(width + 1);
          expect(metrics.font).toBeGreaterThanOrEqual(width <= 640 ? 13.5 : 15);
          if (name !== 'npm') expect(metrics.textWidth).toBeLessThanOrEqual(metrics.textBox + 1);
        }
      }
    }
  });
}
