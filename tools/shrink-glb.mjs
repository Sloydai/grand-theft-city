// Re-encodes the textures inside GLB files as JPEG at most <size> px (macOS sips): Sloyd car
// bodies come with 4096 px PNGs (~20 MB a car) that look the same at 2048 px. Textures already
// JPEG and that small are left as they are. Geometry is copied unchanged.
// Usage: node tools/shrink-glb.mjs <size> <file.glb>... (rewrites the files in place)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [size, ...files] = process.argv.slice(2);
const work = mkdtempSync(join(tmpdir(), 'shrink-glb-'));
const pad4 = (n) => (n + 3) & ~3;
// The longer side of a JPEG, from its first start-of-frame marker.
const jpegSide = (b) => {
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) return Infinity;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return Math.max(b.readUInt16BE(i + 5), b.readUInt16BE(i + 7));
    i += 2 + b.readUInt16BE(i + 2);
  }
  return Infinity;
};
for (const file of files) {
  const glb = readFileSync(file);
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  const binStart = 20 + jsonLength + 8, bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLength));
  const images = new Map((gltf.images || []).filter((im) => im.bufferView !== undefined).map((im) => [im.bufferView, im]));
  // Rebuild the binary chunk view by view, swapping each image for its JPEG.
  const parts = [];
  let offset = 0;
  gltf.bufferViews.forEach((view, i) => {
    let bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const image = images.get(i);
    if (image && !(image.mimeType === 'image/jpeg' && jpegSide(bytes) <= +size)) {
      const source = join(work, `${i}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`), out = join(work, `${i}-out.jpg`);
      writeFileSync(source, bytes);
      execFileSync('sips', ['-Z', size, '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', source, '--out', out], { stdio: 'ignore' });
      bytes = readFileSync(out);
      image.mimeType = 'image/jpeg';
    }
    view.byteOffset = offset;
    view.byteLength = bytes.length;
    parts.push(bytes, Buffer.alloc(pad4(bytes.length) - bytes.length));
    offset = pad4(offset + bytes.length);
  });
  gltf.buffers[0].byteLength = offset;
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + offset, 8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(offset, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  writeFileSync(file, Buffer.concat([header, jsonHeader, json, binHeader, ...parts]));
  console.log(file.split('/').pop(), `${(glb.length / 1e6).toFixed(1)} MB →`, `${((12 + 16 + json.length + offset) / 1e6).toFixed(1)} MB`);
}
rmSync(work, { recursive: true });
