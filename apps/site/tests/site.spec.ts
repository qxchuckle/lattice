import { test, expect } from '@playwright/test';

test.use({ locale: 'en-US' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('lattice-language-choice')) {
      localStorage.setItem('lattice-language-choice', 'en');
    }
  });
});

test('landing page renders the memory story and eager workbench shots', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4321/')) external.push(request.url());
  });

  await page.goto('/lattice/');
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
  await page.goto('/lattice/');

  const sizes = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0;
    };

    return {
      proof: read('.ll-proof'),
      lede: read('.ll-lede'),
      sectionLede: read('.ll-section-lede'),
      cardBody: read('.ll-gap-card p'),
      workflowBody: read('.ll-flow-bubble p'),
      workflowCommand: read('.ll-flow-command'),
      workflowStep: read('.ll-flow-step'),
      workflowFootnote: read('.ll-flow-footnote'),
    };
  });

  expect(Math.min(...Object.values(sizes))).toBeGreaterThanOrEqual(12);
  expect(sizes.lede).toBeGreaterThanOrEqual(18);
  expect(sizes.sectionLede).toBeGreaterThanOrEqual(18);
  expect(sizes.cardBody).toBeGreaterThanOrEqual(15);
  expect(sizes.workflowBody).toBeGreaterThanOrEqual(15);
  expect(sizes.workflowCommand).toBeGreaterThanOrEqual(13);
  expect(sizes.workflowStep).toBeGreaterThanOrEqual(13);
});

test('workflow demo can jump through all seven steps', async ({ page }) => {
  await page.goto('/lattice/');
  await page.locator('#workflow').scrollIntoViewIfNeeded();

  await expect(page.locator('[data-flow-play]')).toHaveText('Pause');
  await page.locator('[data-flow-jump="6"]').click();
  await expect(page.locator('[data-flow-scene]:not([hidden])')).toHaveAttribute(
    'data-flow-scene',
    '6',
  );
  await expect(page.locator('[data-flow-play]')).toHaveText('Replay');
  await expect(page.locator('.ll-flow-distilled')).toBeVisible();
  await expect(page.locator('[data-flow-counter]')).toHaveText('07 / 07');
});

test('theme picker is a custom menu and switches the whole landing page', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('starlight-theme')) {
      localStorage.setItem('starlight-theme', 'dark');
    }
  });

  await page.goto('/lattice/');
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const picker = page.locator('[data-theme-select]').first();
  await picker.locator('summary').click();
  await picker.getByRole('button', { name: 'Light' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 248, 251)');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.goto('/lattice/docs/');
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('language picker is a custom menu and remembers the selected locale', async ({ page }) => {
  await page.goto('/lattice/');
  await expect(page.locator('select')).toHaveCount(0);

  const picker = page.locator('[data-language-select]').first();
  await picker.locator('summary').click();
  await picker.getByRole('link', { name: /简体中文/ }).click();

  await expect(page).toHaveURL(/\/lattice\/zh-cn\/$/);
  await expect(page.locator('h1')).toContainText('代码库之上');
  expect(await page.evaluate(() => localStorage.getItem('lattice-language-choice'))).toBe('zh');
});

test('demo navigation, search and layout controls work', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/lattice/demo/?lang=en');
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
  await page.goto('/lattice/demo/?lang=en');

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

  await page.goto('/lattice/demo/?lang=en');
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
