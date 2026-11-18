const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');

const { integrity } = require('../../packages/cli/scripts/payload.cjs');
const { privateNodeEnv } = require('../../packages/cli/scripts/runtime.cjs');

function verify(payload) {
  const manifest = integrity(payload);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lattice-payload-verify-'));
  const env = {
    ...privateNodeEnv(),
    HOME: temporary,
    USERPROFILE: temporary,
    LATTICE_HOME: path.join(temporary, 'data'),
    LATTICE_DISABLE_SEMANTIC: '1',
  };
  const node = path.join(payload, 'runtime', manifest.platform === 'win32' ? 'node.exe' : 'node');
  try {
    function run(args) {
      const result = childProcess.spawnSync(node, args, {
        env,
        cwd: temporary,
        encoding: 'utf8',
        timeout: 30000,
      });
      if (result.error || result.status !== 0)
        throw new Error(
          'Payload verification failed: ' + (result.error ? result.error.message : result.stderr),
        );
      return result.stdout;
    }
    const actual = run([path.join(payload, 'bin/ltc.cjs'), '--version']).trim();
    if (actual !== manifest.version) throw new Error('CLI version does not match payload');
    run([path.join(payload, 'scripts/payload.cjs'), manifest.version]);
    return manifest;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { verify, integrity };
