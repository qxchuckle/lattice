const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');
const { privateNodeEnv } = require('../../packages/cli/scripts/runtime.cjs');

const PTY = '@homebridge/node-pty-prebuilt-multiarch';

const RULE_VERSIONS = {
  '@huggingface/transformers': '3.8.1',
  'onnxruntime-node': '1.21.0',
  'better-sqlite3': '11.10.0',
  [PTY]: '0.11.14',
};

function resolvePackage(from, name) {
  const requireFrom = createRequire(path.join(from, 'package.json'));
  // Explicit dependencies may share a name with a builtin, e.g. string_decoder.
  for (const directory of requireFrom.resolve.paths(name + '/package.json') || []) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
  }
  throw new Error('Unresolved production dependency ' + name + ' from ' + from);
}

function compatible(pkg, target) {
  function accepts(values, value) {
    if (!values) return true;
    values = Array.isArray(values) ? values : [values];
    return (
      !values.includes('!' + value) &&
      (values.every((v) => v.startsWith('!')) || values.includes(value))
    );
  }
  return (
    accepts(pkg.os, target.os) && accepts(pkg.cpu, target.arch) && accepts(pkg.libc, target.libc)
  );
}

function runtimeDependencies(pkg) {
  if (pkg.name === '@huggingface/transformers') {
    // Official node builds inline jinja and replace onnxruntime-web with an ignored module.
    return {
      'onnxruntime-common': '*',
      'onnxruntime-node': pkg.dependencies['onnxruntime-node'],
      sharp: pkg.dependencies.sharp,
    };
  }
  if (pkg.name === 'onnxruntime-node')
    return { 'onnxruntime-common': pkg.dependencies['onnxruntime-common'] };
  if (pkg.name === 'better-sqlite3') return { bindings: pkg.dependencies.bindings };
  if (pkg.name === PTY) return {}; // nan and prebuild-install are only needed to build/install it.
  return pkg.dependencies || {};
}

function keepFile(pkg, relative, target, workspace) {
  const parts = relative.split('/');
  if (parts.includes('node_modules') || parts.includes('.git')) return false;
  if (/(^|\/)([^/]*licen[sc]e[^/]*|[^/]*notice[^/]*|copying[^/]*)$/i.test(relative)) return true;
  if (relative === 'package.json') return true;
  if (workspace) return relative.startsWith('dist/') && !/\.(map|d\.[cm]?ts)$/.test(relative);
  if (pkg.name === '@huggingface/transformers')
    return /^dist\/transformers\.node\.(mjs|cjs)$/.test(relative);
  if (pkg.name === 'onnxruntime-node') {
    return (
      (relative.startsWith('dist/') && /\.js$/.test(relative)) ||
      relative.startsWith('bin/napi-v3/' + target.os + '/' + target.arch + '/')
    );
  }
  if (pkg.name === 'better-sqlite3')
    return relative.startsWith('lib/') || relative === 'build/Release/better_sqlite3.node';
  if (pkg.name === PTY) {
    return (
      (relative.startsWith('lib/') && relative.endsWith('.js')) ||
      /^build\/(Release|Debug)\/(?:[^/]+\.(?:node|dll|exe)|spawn-helper)$/.test(relative) ||
      relative === `prebuilds/${target.os}-${target.arch}/node.abi${target.abi}.node`
    );
  }
  if (/\.(map|d\.[cm]?ts|tsbuildinfo)$/.test(relative)) return false;
  if (
    parts.some((p) => ['test', 'tests', '__tests__', 'examples', 'coverage', '.github'].includes(p))
  )
    return false;
  return true;
}

function copyPackageFiles(source, destination, pkg, target, workspace, stats) {
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (!['node_modules', '.git'].includes(entry.name))
          visit(path.join(directory, entry.name), name);
      } else if (keepFile(pkg, name, target, workspace)) {
        const file = path.join(directory, entry.name);
        const output = path.join(destination, name);
        // Materialize links: an extracted package must not depend on the build machine's store.
        const real = fs.realpathSync(file);
        const stat = fs.statSync(real);
        if (!stat.isFile()) throw new Error('Unsupported package asset ' + file);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.copyFileSync(real, output);
        fs.chmodSync(output, stat.mode & 0o777);
        stats.files++;
        stats.bytes += stat.size;
      }
    }
  }
  fs.mkdirSync(destination, { recursive: true });
  visit(source);
}

function materialize(cliRoot, appRoot, target, executable) {
  const installed = new Map();
  const completed = new Set();
  const components = [];
  const rootPkg = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json')));
  const rootModules = path.join(appRoot, 'node_modules');
  const workspaceRoot = path.resolve(cliRoot, '../..');

  function nearest(parent, name) {
    let cursor = parent;
    while (cursor.startsWith(appRoot)) {
      const destination = path.join(cursor, 'node_modules', name);
      if (installed.has(destination)) return destination;
      if (cursor === appRoot) break;
      cursor = path.dirname(cursor);
    }
    return null;
  }

  function add(source, destination) {
    if (completed.has(destination)) return;
    completed.add(destination);
    installed.set(destination, source);
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
    if (RULE_VERSIONS[pkg.name] && pkg.version !== RULE_VERSIONS[pkg.name]) {
      throw new Error(
        'Review the runtime pruning policy before packaging ' + pkg.name + '@' + pkg.version,
      );
    }
    if (!compatible(pkg, target))
      throw new Error('Incompatible dependency ' + pkg.name + ' for ' + target.id);
    const stats = {
      name: pkg.name,
      version: pkg.version,
      path: path.relative(appRoot, destination).split(path.sep).join('/'),
      bytes: 0,
      files: 0,
    };
    copyPackageFiles(
      source,
      destination,
      pkg,
      target,
      source.startsWith(path.join(workspaceRoot, 'packages') + path.sep),
      stats,
    );
    components.push(stats);
    const dependencies = runtimeDependencies(pkg);
    const optional = pkg.optionalDependencies || {};
    for (const name of new Set([...Object.keys(dependencies), ...Object.keys(optional)])) {
      let dependency;
      try {
        dependency = resolvePackage(source, name);
      } catch (error) {
        if (name in optional && !(name in dependencies)) continue;
        throw error;
      }
      const dependencyPkg = JSON.parse(fs.readFileSync(path.join(dependency, 'package.json')));
      if (!compatible(dependencyPkg, target)) {
        if (name in optional && !(name in dependencies)) continue;
        throw new Error('Incompatible required dependency ' + name);
      }
      if (name === PTY) {
        const probe = spawnSync(executable, ['-e', 'require(process.argv[1])', dependency], {
          env: privateNodeEnv(),
          stdio: 'ignore',
          timeout: 10000,
        });
        if (probe.status !== 0) {
          console.warn(
            'No compatible PTY binding for this build; Web will use its subprocess terminal.',
          );
          continue;
        }
      }
      const existing = nearest(destination, name);
      if (existing && installed.get(existing) === dependency) continue;
      add(dependency, path.join(destination, 'node_modules', name));
    }
  }

  // Reserve all direct packages before recursion, so a shared root dependency is never copied twice.
  for (const name of Object.keys(rootPkg.dependencies))
    installed.set(path.join(rootModules, name), resolvePackage(cliRoot, name));
  for (const name of Object.keys(rootPkg.dependencies))
    add(installed.get(path.join(rootModules, name)), path.join(rootModules, name));
  return components;
}

module.exports = { materialize, resolvePackage, compatible, keepFile, runtimeDependencies };
