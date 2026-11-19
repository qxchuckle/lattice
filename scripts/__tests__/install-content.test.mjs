import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  installation,
  methods,
  renderInstallTabs,
  renderInstallMarkdown,
  replaceInstallBlock,
  startMarker,
  endMarker,
  installDocuments,
  validateChannels,
} from '../install-content.mjs';
import { syncInstallDocs } from '../sync-install-docs.mjs';
function unpublishedCatalog() {
  const config = structuredClone(installation);
  config.channels = [
    { id: 'brew', available: false },
    { id: 'npm', available: true },
    { id: 'curl', available: false },
  ];
  return config;
}

test('pending Homebrew and curl channels keep npm installation available', () => {
  const config = unpublishedCatalog();
  for (const locale of ['en', 'zh']) {
    const entries = methods(locale, config);
    assert.deepEqual(
      entries.map((m) => m.id),
      ['brew', 'npm', 'curl'],
    );
    for (const entry of entries) assert.equal(!!entry.command, entry.available);
    const html = renderInstallTabs('installation-test', locale, config);
    assert.match(html, /data-default-method="ai"/);
    assert.match(html, /id="installation-test-tab-ai"[^>]*aria-selected="true"/);
    assert.match(
      html,
      /data-install-command><span class="ll-install-token">npm<\/span> install -g @qcqx\/lattice-cli/,
    );
    assert.doesNotMatch(html, /ll-install-token">brew<|latest\/download\/install\.sh/);
    assert.match(html, /Node.js 14\.14\+/);
    const markdown = renderInstallMarkdown(locale, config);
    assert.match(markdown, /^<details open>\n<summary>Homebrew/);
    assert.match(markdown, /npm install -g @qcqx\/lattice-cli/);
  }
});
test('published platform commands use channel defaults', () => {
  const config = unpublishedCatalog();
  config.channels[0] = { id: 'brew', available: true, tap: 'qxchuckle/tap' };
  config.channels[2].available = true;
  const entries = methods('en', config);
  assert.equal(entries[0].command, 'brew install qxchuckle/tap/lattice');
  assert.match(entries[1].note, /14.14/);
  assert.match(entries[2].command, /\/latest\/download\/install\.sh/);
  assert.doesNotMatch(entries[2].command, /--version/);
  assert.match(
    renderInstallTabs('future-install', 'en', config),
    /data-install-command><span class="ll-install-token">brew<\/span> install/,
  );
});

test(
  'curl installer runs only after a successful download and removes the temporary file',
  { skip: process.platform === 'win32' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'lattice-curl-command-'));
    try {
      const command = methods('en').find((method) => method.id === 'curl').command;
      writeFileSync(
        join(root, 'curl'),
        `#!/bin/sh\nprintf 'printf "installer: %%s\\\\n" "$*"\\n' > "$4"\nexit "$CURL_STATUS"\n`,
        { mode: 0o700 },
      );
      for (const status of [6, 0]) {
        const result = spawnSync('/bin/sh', ['-c', command], {
          env: {
            ...process.env,
            PATH: root + ':/usr/bin:/bin',
            TMPDIR: root,
            CURL_STATUS: String(status),
          },
          encoding: 'utf8',
        });
        assert.equal(result.status, status, result.stderr);
        assert.equal(result.stdout.trim(), status ? '' : 'installer:');
        assert.deepEqual(readdirSync(root), ['curl']);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test('catalog gate rejects every invalid class and restores the clean configuration', () => {
  const cases = [
    [
      'I1',
      (c) => {
        c.defaultMethod = 'npm';
      },
    ],
    [
      'I3',
      (c) => {
        c.channels[1].id = 'brew';
      },
    ],
    [
      'I3',
      (c) => {
        c.channels[1].id = 'unknown';
      },
    ],
    [
      'I3',
      (c) => {
        c.channels[1].available = 'yes';
      },
    ],
    [
      'I3',
      (c) => {
        c.channels[1].available = false;
      },
    ],
    [
      'I4',
      (c) => {
        c.channels[0].available = true;
      },
    ],
  ];
  for (const [code, mutate] of cases) {
    const config = unpublishedCatalog();
    mutate(config);
    assert.throws(() => validateChannels(config), new RegExp(code));
    validateChannels(unpublishedCatalog());
  }
  assert.throws(() => renderInstallTabs('bad"id'), /I6/);
});
test('controlled documentation blocks reject missing/reversed/duplicate markers', () => {
  for (const text of [
    '',
    endMarker + startMarker,
    startMarker + endMarker + startMarker,
    startMarker,
  ])
    assert.throws(() => replaceInstallBlock(text, 'en'), /I7/);
  const source = '# Doc\n\n' + startMarker + '\nold\n' + endMarker + '\nTail';
  const updated = replaceInstallBlock(source, 'en');
  assert.match(updated, /^# Doc/);
  assert.match(updated, /Tail$/);
  assert.equal(replaceInstallBlock(updated, 'en'), updated);
  assert.match(replaceInstallBlock(updated, 'en', { html: true }), /<lattice-install-tabs/);
});
test('I8 stale-document injection fails, generator restores all copies and leaves no stale text', () => {
  const root = mkdtempSync(join(tmpdir(), 'lattice-install-docs-'));
  try {
    for (const file of installDocuments) {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '# Doc\n\n' + startMarker + '\nselftest-stale\n' + endMarker);
    }
    assert.throws(() => syncInstallDocs({ repo: root, check: true }), /I8/);
    syncInstallDocs({ repo: root });
    syncInstallDocs({ repo: root, check: true });
    for (const file of installDocuments)
      assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /selftest-stale/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
