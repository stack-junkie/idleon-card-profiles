import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { readInstalledBundle } from './steam.js';
import { SUPPORTED_BUNDLE_HASH } from './injector.js';

// Read native font assets into memory for the offline preview only. No game
// files or copied game assets are modified or included with this add-on.
export async function readPreviewFont(install) {
  const bundle = await readInstalledBundle(install);
  if (bundle.hash !== SUPPORTED_BUNDLE_HASH) throw new Error('Native font preview requires the supported game build.');
  const file = await fs.open(install.asarPath, 'r');
  try {
    const header = Buffer.alloc(16); await file.read(header, 0, 16, 0);
    const json = Buffer.alloc(header.readUInt32LE(12)); await file.read(json, 0, json.length, 16);
    const tree = JSON.parse(json.toString('utf8'));
    const entry = tree.files.distBuild.files.static.files.game.files.lib.files['default.pak'];
    const start = 8 + header.readUInt32LE(4) + Number(entry.offset);
    const unpack = async (offset, size) => {
      const packed = Buffer.alloc(size); const result = await file.read(packed, 0, size, start + offset);
      if (result.bytesRead !== size) throw new Error('Native font data was truncated.');
      return gunzipSync(packed);
    };
    return { metrics: await unpack(3784107, 2576), image: await unpack(3786683, 11628) };
  } finally { await file.close(); }
}
