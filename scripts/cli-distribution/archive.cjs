// Deterministic portable ustar + gzip. npm retry integrity must not depend on build timestamps.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
function pack(directory, topName, destination) {
  const chunks = [];
  function add(relative) {
    const source = path.join(directory, relative);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() && !stat.isDirectory())
      throw new Error('Archive contains unsupported link/asset: ' + relative);
    const name = relative.split(path.sep).join('/') + (stat.isDirectory() ? '/' : '');
    let leaf = name,
      prefix = '';
    if (Buffer.byteLength(name) > 100) {
      const split = [...name]
        .map((c, i) => (c === '/' ? i : -1))
        .find(
          (i) =>
            i > 0 &&
            Buffer.byteLength(name.slice(0, i)) <= 155 &&
            Buffer.byteLength(name.slice(i + 1)) <= 100,
        );
      if (split === undefined) throw new Error('Archive path exceeds ustar limits: ' + name);
      prefix = name.slice(0, split);
      leaf = name.slice(split + 1);
    }
    const header = Buffer.alloc(512);
    const octal = (value, offset, width) =>
      header.write(value.toString(8).padStart(width - 1, '0') + '\0', offset, width, 'ascii');
    header.write(leaf, 0, 100, 'utf8');
    octal(stat.isDirectory() || stat.mode & 0o111 ? 0o755 : 0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(stat.isFile() ? stat.size : 0, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    header.write(stat.isDirectory() ? '5' : '0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(prefix, 345, 155, 'utf8');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    chunks.push(header);
    if (stat.isFile()) {
      chunks.push(fs.readFileSync(source));
      if (stat.size % 512) chunks.push(Buffer.alloc(512 - (stat.size % 512)));
    } else for (const child of fs.readdirSync(source).sort()) add(path.join(relative, child));
  }
  add(topName);
  chunks.push(Buffer.alloc(1024));
  fs.writeFileSync(destination, zlib.gzipSync(Buffer.concat(chunks), { level: 9 }));
}
module.exports = { pack };
