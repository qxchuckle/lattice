const assert = require('node:assert/strict');
const { access, readFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const vscode = require('vscode');

async function verifyInstalledExtension() {
  const extension = vscode.extensions.getExtension('qcqx.lattice-context');
  assert.ok(extension, 'the installed VSIX must contain the extension');
  assert.equal(extension.packageJSON.version, process.env.LATTICE_VSIX_VERSION);
  assert.equal(
    path.relative(process.env.LATTICE_VSIX_EXTENSIONS_DIR, path.dirname(extension.extensionPath)),
    '',
    'the host must load the installed copy of the extension',
  );
  await extension.activate();

  await vscode.commands.executeCommand('lattice.spec.openById', 'spec-vsix-fixture');
  const openedFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  assert.ok(openedFile, 'the extension must open a spec');
  assert.equal(
    path.relative(path.join(process.env.LATTICE_HOME, 'spec', 'vsix-fixture.md'), openedFile),
    '',
    'the installed extension reads files from the isolated data home',
  );

  if (process.getBuiltinModule?.('node:sqlite')) {
    await vscode.commands.executeCommand('lattice.rag.status');
    const report = vscode.window.activeTextEditor?.document.getText();
    assert.match(report, /Total embeddings: 1/);
    assert.match(report, /Vector store ready: false/);
  }

  await vscode.commands.executeCommand('lattice.rag.update');
  await vscode.commands.executeCommand('lattice.rag.rebuild');
  assert.ok((await vscode.commands.getCommands(true)).includes('lattice.cli.checkTerminal'));

  const webview = path.join(extension.extensionPath, 'media', 'webview');
  const html = await readFile(path.join(webview, 'webview.html'), 'utf8');
  const script = html.match(/src="(?:\.\/|\/)?(assets\/[^"]+\.js)"/)?.[1];
  assert.ok(script, 'the VSIX must include a workbench entry script');
  await access(path.join(webview, script));
  await vscode.commands.executeCommand('lattice.web.open');
  const workbenchIsOpen = () =>
    vscode.window.tabGroups.all.some((group) =>
      group.tabs.some(
        (tab) => tab.label === 'Lattice Workbench' && tab.input instanceof vscode.TabInputWebview,
      ),
    );
  // The tab model is delivered asynchronously by the renderer on older VS Code hosts.
  const deadline = Date.now() + 5_000;
  while (!workbenchIsOpen() && Date.now() < deadline) await sleep(50);
  assert.ok(workbenchIsOpen(), 'the installed extension opens an in-editor workbench');
  console.log(
    `Installed VSIX ${extension.packageJSON.version} passed on VS Code ${vscode.version}`,
  );
}

exports.run = async function run() {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Installed VSIX verification timed out')), 30_000);
  });
  try {
    await Promise.race([verifyInstalledExtension(), timeout]);
  } finally {
    clearTimeout(timer);
  }
};
