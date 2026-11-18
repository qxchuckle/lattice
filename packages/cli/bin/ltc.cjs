#!/usr/bin/env node
// Keep this entry free of business imports: the invoking Node may be Node 14.
const path = require('path');
try {
  Promise.resolve(
    require('../scripts/runtime.cjs').launch(path.resolve(__dirname, '..'), process.argv.slice(2)),
  ).catch(function (error) {
    process.stderr.write('Lattice 启动失败：' + error.message + '\n');
    process.exitCode = 1;
  });
} catch (error) {
  process.stderr.write('Lattice 启动失败：' + error.message + '\n');
  process.exitCode = 1;
}
