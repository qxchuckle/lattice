#!/usr/bin/env node
const path = require('path');
const { NODE_VERSION, PLATFORMS, hostTarget } = require('./cli-distribution/config.cjs');
async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const options = {};
  const values = {
    '--node': 'node',
    '--output': 'output',
    '--target': 'target',
    '--version': 'version',
    '--sqlite-binding': 'sqliteBinding',
    '--node-license': 'nodeLicense',
    '--model-path': 'modelPath',
    '--runs': 'runs',
    '--caller-node': 'callerNode',
    '--npm': 'npm',
  };
  const flags = {
    '--development-runtime': 'developmentRuntime',
    '--allow-partial': 'allowPartial',
    '--allow-development': 'allowDevelopment',
  };
  while (args.length) {
    const key = args.shift();
    if (flags[key]) options[flags[key]] = true;
    else if (values[key] && args.length) options[values[key]] = args.shift();
    else throw new Error('Unknown/missing distribution option ' + key);
  }
  const output = path.resolve(options.output || 'dist-cli');
  if (command === 'matrix') return { include: PLATFORMS, node: NODE_VERSION };
  if (command === 'build') return require('./cli-distribution/build.cjs').build(options);
  if (command === 'assemble' || command === 'publish')
    return require('./cli-distribution/release.cjs')[command](output, options);
  if (command === 'verify')
    return require('./cli-distribution/verify.cjs').verify(
      require('fs').existsSync(path.join(output, 'manifest.json'))
        ? output
        : path.join(output, 'work', hostTarget().id, 'package/payload'),
    );
  if (command === 'smoke' || command === 'benchmark')
    return require('./cli-distribution/' + command + '.cjs')[command]({ ...options, output });
  if (command === 'refuse-workspace-publish')
    throw new Error(
      'Publish the generated platform and bootstrap tarballs from tag CI, not the workspace CLI dependency tree. See CONTRIBUTING.md.',
    );
  throw new Error(
    'Usage: cli-distribution.cjs matrix|build|assemble|verify|smoke|benchmark|publish',
  );
}
main()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
