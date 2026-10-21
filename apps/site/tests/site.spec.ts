import { test, expect, type Page } from '@playwright/test';
import { siteUrl } from './base';

test.use({ locale: 'en-US' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('lattice-language-choice')) {
      localStorage.setItem('lattice-language-choice', 'en');
    }
  });
});

async function pauseWorkflow(page: Page): Promise<void> {
  await page.locator('#workflow').scrollIntoViewIfNeeded();
  const play = page.locator('[data-flow-play]');
  await expect(play).toHaveText('Pause', { timeout: 3000 });
  await play.click();
  await expect(play).toHaveText('Play');
}

async function resetWorkflow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const track = document.querySelector<HTMLElement>('[data-flow-progress-track]');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    track.dispatchEvent(
      new MouseEvent('click', {
        clientX: rect.left,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
      }),
    );
  });
  await expect(page.locator('[data-flow-counter]')).toHaveText('01 / 07');
  await expect
    .poll(async () => {
      const value = await page.locator('[data-flow-progress-track]').getAttribute('aria-valuenow');
      return Number(value);
    })
    .toBe(0);
}

test('landing page renders the memory story and eager workbench shots', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4321/')) external.push(request.url());
  });

  await page.goto(siteUrl('/'));
  await expect(page.locator('h1')).toContainText('Above the repo.');
  await expect(page.locator('.ll-shot img')).toHaveCount(4);
  await expect(page.locator('.ll-flow-agent-command--input .ll-flow-command-chip')).toContainText(
    'lattice:task:start',
  );
  await expect(page.locator('.ll-flow-agent-command--input .ll-flow-input-placeholder')).toHaveText(
    'Ask your agent…',
  );
  await expect(page.locator('.ll-flow-bubble .ll-flow-command-chip').first()).toContainText(
    'lattice:task:start',
  );
  await expect(page.locator('.ll-flow-command--agent')).toHaveCount(0);
  const image = page.locator('.ll-shot img').first();
  await expect(image).toHaveJSProperty('complete', true);
  expect(
    await image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  expect(external).toEqual([]);
});

test('landing typography keeps metadata and workflow text readable', async ({ page }) => {
  await page.goto(siteUrl('/'));

  const sizes = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0;
    };

    return {
      proof: read('.ll-proof'),
      install: read('.ll-install'),
      kicker: read('.ll-kicker'),
      lede: read('.ll-lede'),
      sectionLede: read('.ll-section-lede'),
      cardBody: read('.ll-gap-card p'),
      workflowLabel: read('.ll-flow-label'),
      workflowBody: read('.ll-flow-bubble p'),
      workflowCommand: read('.ll-flow-command'),
      workflowStep: read('.ll-flow-step'),
      workflowMemory: read('.ll-flow-specs code'),
      workflowFootnote: read('.ll-flow-footnote'),
    };
  });

  expect(Math.min(...Object.values(sizes))).toBeGreaterThanOrEqual(13);
  expect(sizes.install).toBeGreaterThanOrEqual(15);
  expect(sizes.lede).toBeGreaterThanOrEqual(18);
  expect(sizes.sectionLede).toBeGreaterThanOrEqual(18);
  expect(sizes.cardBody).toBeGreaterThanOrEqual(15);
  expect(sizes.workflowLabel).toBeGreaterThanOrEqual(13);
  expect(sizes.workflowBody).toBeGreaterThanOrEqual(16);
  expect(sizes.workflowCommand).toBeGreaterThanOrEqual(14);
  expect(sizes.workflowStep).toBeGreaterThanOrEqual(14);
  expect(sizes.workflowMemory).toBeGreaterThanOrEqual(14);
});

test('workflow demo starts with only the user start message', async ({ page }) => {
  await page.goto(siteUrl('/'));
  await page.evaluate(() => window.scrollTo(0, 0));

  const visible = page.locator('[data-flow-entry].is-visible');
  await expect(visible).toHaveCount(1);
  await expect(visible.first()).toHaveAttribute('data-flow-kind', 'user');
  await expect(visible.first()).toContainText('lattice:task:start');
  await expect(page.locator('[data-flow-counter]')).toHaveText('01 / 07');
  await expect(page.locator('[data-flow-progress-track]')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('[data-flow-memory-panel]:not([hidden])')).toHaveAttribute(
    'data-flow-memory-panel',
    '0',
  );
  await expect(page.locator('[data-flow-play]')).toHaveText('Play');
  await expect(page.locator('[data-flow-typing]')).toBeHidden();
});

test('workflow demo reveals agent replies one by one during autoplay', async ({ page }) => {
  await page.goto(siteUrl('/'));
  const visible = page.locator('[data-flow-entry].is-visible');
  await expect(visible).toHaveCount(1);

  await page.locator('#workflow').scrollIntoViewIfNeeded();
  const play = page.locator('[data-flow-play]');
  await expect(play).toHaveText('Pause');
  await expect
    .poll(() => page.locator('[data-flow-typing]').isVisible(), { timeout: 3000 })
    .toBe(true);

  await expect.poll(async () => visible.count(), { timeout: 6000 }).toBeGreaterThan(1);
  const progress = Number(
    await page.locator('[data-flow-progress-track]').getAttribute('aria-valuenow'),
  );
  expect(progress).toBeGreaterThan(0);
  expect(progress).toBeLessThan(100);

  await expect(page.locator('[data-flow-counter]')).toHaveText('02 / 07', { timeout: 8000 });
});

test('workflow demo scrubs continuously with the wheel and step tabs follow', async ({ page }) => {
  await page.goto(siteUrl('/'));
  await pauseWorkflow(page);
  await resetWorkflow(page);

  const feed = page.locator('[data-flow-feed]');
  const track = page.locator('[data-flow-progress-track]');
  const visible = page.locator('[data-flow-entry].is-visible');
  const counter = page.locator('[data-flow-counter]');
  const readProgress = async () => Number(await track.getAttribute('aria-valuenow'));

  await feed.hover();
  const pageY = await page.evaluate(() => window.scrollY);

  await page.mouse.wheel(0, 120);
  await expect.poll(readProgress).toBeGreaterThan(0);
  const smallProgress = await readProgress();
  expect(smallProgress).toBeLessThan(14.3);
  await expect(counter).toHaveText('01 / 07');
  await expect.poll(async () => visible.count()).toBeGreaterThan(1);

  await page.mouse.wheel(0, 260);
  await expect(counter).toHaveText('02 / 07');
  expect(await page.evaluate(() => window.scrollY)).toBe(pageY);

  await page.mouse.wheel(0, -420);
  await expect(counter).toHaveText('01 / 07');
  expect(await page.evaluate(() => window.scrollY)).toBe(pageY);

  // At the start of the timeline a new upward gesture releases the page.
  await expect.poll(readProgress).toBe(0);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(pageY);
});

test('workflow demo keeps slow, small wheel input moving', async ({ page }) => {
  await page.goto(siteUrl('/'));
  await pauseWorkflow(page);
  await resetWorkflow(page);

  const feed = page.locator('[data-flow-feed]');
  const result = await feed.evaluate(async (element) => {
    const read = () =>
      Number(document.querySelector('[data-flow-progress-track]')?.getAttribute('aria-valuenow'));
    const start = read();
    for (let index = 0; index < 6; index += 1) {
      element.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 4, bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 240));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    return {
      start,
      end: read(),
      visible: document.querySelectorAll('[data-flow-entry].is-visible').length,
      counter: document.querySelector('[data-flow-counter]')?.textContent ?? '',
    };
  });

  expect(result.start).toBe(0);
  expect(result.end).toBeGreaterThanOrEqual(8);
  expect(result.visible).toBeGreaterThan(1);
  expect(result.counter).toBe('01 / 07');
});

test('workflow demo only scrubs from the conversation', async ({ page }) => {
  await page.goto(siteUrl('/'));
  await pauseWorkflow(page);
  await resetWorkflow(page);

  const readProgress = async () =>
    Number(await page.locator('[data-flow-progress-track]').getAttribute('aria-valuenow'));

  await page.locator('[data-flow-memory-panel]:not([hidden])').hover();
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(250);
  expect(await readProgress()).toBe(0);

  await page.locator('[data-flow-progress-track]').hover();
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(250);
  expect(await readProgress()).toBe(0);
  await expect(page.locator('[data-flow-counter]')).toHaveText('01 / 07');
});

test('workflow demo renders commands and checkpoints as agent messages', async ({ page }) => {
  await page.goto(siteUrl('/'));
  await pauseWorkflow(page);
  await page.locator('[data-flow-jump="6"]').click();

  const commands = page.locator('[data-flow-kind="command"]');
  const checkpoints = page.locator('[data-flow-kind="checkpoint"]');

  await expect(commands.first().locator('.ll-flow-message--agent .ll-flow-who')).toHaveText(
    'Lattice agent',
  );
  await expect(commands.first().locator('.ll-flow-agent-tool .ll-flow-command')).toBeVisible();
  await expect(checkpoints.first().locator('.ll-flow-message--agent .ll-flow-who')).toHaveText(
    'Lattice agent',
  );
  await expect(checkpoints.first().locator('.ll-flow-agent-checkpoint')).toBeVisible();
  await expect(page.locator('.ll-flow-checkpoint')).toHaveCount(0);
});

test('workflow demo keeps the conversation pinned to the bottom', async ({ page }) => {
  await page.goto(siteUrl('/'));
  await pauseWorkflow(page);
  await page.locator('[data-flow-jump="6"]').click();
  await expect(page.locator('[data-flow-play]')).toHaveText('Replay');

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const feed = document.querySelector<HTMLElement>('[data-flow-feed]');
        return feed ? feed.scrollHeight - feed.clientHeight - feed.scrollTop : 999;
      }),
    )
    .toBeLessThanOrEqual(2);
});

test('workflow demo jumps to a step and updates the memory panel', async ({ page }) => {
  await page.goto(siteUrl('/'));
  await pauseWorkflow(page);

  const track = page.locator('[data-flow-progress-track]');
  const counter = page.locator('[data-flow-counter]');
  const visible = page.locator('[data-flow-entry].is-visible');
  const memory = page.locator('[data-flow-memory-panel]:not([hidden])');

  await page.locator('[data-flow-jump="6"]').click();
  await expect(counter).toHaveText('07 / 07');
  await expect(track).toHaveAttribute('aria-valuenow', '100');
  await expect(visible).toHaveCount(26);
  await expect(memory).toHaveAttribute('data-flow-memory-panel', '6');
  await expect(page.locator('.ll-flow-distilled')).toBeVisible();
  await expect(page.locator('[data-flow-play]')).toHaveText('Replay');

  // At the end of the timeline a new downward gesture releases the page.
  const feed = page.locator('[data-flow-feed]');
  await feed.hover();
  const endY = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(endY);

  await page.locator('[data-flow-jump="1"]').click();
  await expect(counter).toHaveText('02 / 07');
  await expect(visible).toHaveCount(6);
  await expect(memory).toHaveAttribute('data-flow-memory-panel', '1');
});

test('workflow demo animates entries as the timeline advances', async ({ page }) => {
  await page.goto(siteUrl('/'));
  await pauseWorkflow(page);
  await resetWorkflow(page);

  const visible = page.locator('[data-flow-entry].is-visible');
  await page.locator('[data-flow-jump="1"]').click();
  await expect.poll(async () => visible.count()).toBeGreaterThan(1);

  const names = await visible.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).animationName),
  );
  expect(names).toContain('ll-flow-entry-in');
});

test('theme picker is a custom menu and switches the whole landing page', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('starlight-theme')) {
      localStorage.setItem('starlight-theme', 'dark');
    }
  });

  await page.goto(siteUrl('/'));
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const picker = page.locator('[data-theme-select]').first();
  await picker.locator('summary').click();
  await picker.getByRole('button', { name: 'Light' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 248, 251)');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.goto(siteUrl('/docs/'));
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('language picker is a custom menu and remembers the selected locale', async ({ page }) => {
  await page.goto(siteUrl('/'));
  await expect(page.locator('select')).toHaveCount(0);

  const picker = page.locator('[data-language-select]').first();
  await picker.locator('summary').click();
  await picker.getByRole('link', { name: /简体中文/ }).click();

  await expect(page).toHaveURL(siteUrl('/zh-cn/'));
  await expect(page.locator('h1')).toContainText('代码库之上');
  expect(await page.evaluate(() => localStorage.getItem('lattice-language-choice'))).toBe('zh');
});

test('docs search returns results in the built site', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(siteUrl('/docs/'));
  await page.locator('button[data-open-modal]').first().click();

  const search = page.locator('#starlight__search');
  const input = search.locator('input');
  await input.fill('workbench');

  await expect(search).toContainText(/results? for workbench/i);
  await expect(search.locator('.pagefind-ui__result')).not.toHaveCount(0);
  await expect(search).not.toContainText('Searching for workbench');
  expect(consoleErrors).toEqual([]);
});

test('demo navigation, search and layout controls work', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(siteUrl('/demo/?lang=en'));
  await expect(page.locator('html')).toHaveAttribute('data-demo-ready', 'true');

  const sidebar = page.locator('.tree-browser-sidebar');
  await sidebar.getByText('Tasks (9)', { exact: true }).click();
  await sidebar.getByText('Unify login state across the portal', { exact: true }).click();

  await expect(page).toHaveURL(/#\/task\/task-auth-guard$/);
  await expect(page.locator('.detail-panel')).toContainText('Unify login state across the portal');
  await expect(page.locator('.detail-panel')).toContainText('task-auth-guard');

  await sidebar.locator('input[type="search"]').fill('portal');
  await expect(sidebar.getByText('Results (14)')).toBeVisible();
  await expect(sidebar.getByText('Project（1）')).toBeVisible();

  await page.getByText('Sequential', { exact: true }).click();
  await expect(page.locator('.ant-segmented-item-selected')).toContainText('Sequential');

  expect(consoleErrors).toEqual([]);
});

test('demo shows a retry state instead of an endless loader when the app fails', async ({
  page,
}) => {
  await page.route('**/DemoRoot*.js*', (route) => route.abort());
  await page.goto(siteUrl('/demo/?lang=en'));

  const error = page.locator('[data-loading-error]');
  await expect(error).toBeVisible({ timeout: 12_000 });
  await expect(error).toContainText('did not load');
  await expect(page.locator('[data-loading-progress]')).toBeHidden();
  await expect(error.getByRole('link', { name: 'Reload demo' })).toBeVisible();
});

test('demo loads mocked workbench, hides host-only controls and blocks network', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const external: string[] = [];
  const apiRequests: string[] = [];
  const websockets: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!request.url().startsWith('http://127.0.0.1:4321/')) external.push(request.url());
    if (url.pathname.includes('/api/')) apiRequests.push(url.pathname);
  });
  page.on('websocket', (socket) => websockets.push(socket.url()));

  await page.goto(siteUrl('/demo/?lang=en'));
  await expect(page.locator('.tree-browser-sidebar')).toContainText('Tasks (9)');
  await expect(page.locator('html')).toHaveAttribute('data-demo-ready', 'true');
  await expect(page.locator('#demo-loading')).toHaveCSS('opacity', '0');
  await expect(page.locator('.anticon-setting')).toHaveCount(0);
  await expect(page.locator('.anticon-code')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('astro-island')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-demo-lang', 'en');
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    /connect-src 'none'/,
  );
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    /frame-src 'none'/,
  );
  expect(websockets).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect(external).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
