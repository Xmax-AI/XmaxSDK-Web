import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { modelManifest } from './convert-framegen-model.mjs';

// 构建时嵌入仓库中的自训权重，不读取依赖包自带的模型。
const require = createRequire(import.meta.url);
const root = dirname(require.resolve('framegen'));
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(metadata.version, '1.4.0', 'Revalidate model compatibility before upgrading framegen');
const models = {
  'tfact2-ours': {
    path: 'tfact2-ours/tfact2_ours',
    sha256: 'daa1d46cb7717344ecdd9b8c171bf7c3a67fd4acedf0add436e6ea21689d7a35',
  },
};
const { id } = JSON.parse(await readFile(new URL('../models/active-model.json', import.meta.url), 'utf8'));
assert(Object.hasOwn(models, id), `Unknown interpolation model: ${id}`);
const selected = models[id];
const weights = await readFile(new URL(`../models/${selected.path}.bin`, import.meta.url));
const manifest = JSON.parse(await readFile(new URL(`../models/${selected.path}.json`, import.meta.url), 'utf8'));
const hash = createHash('sha256').update(weights).digest('hex');
assert.equal(hash, selected.sha256, `Model checksum mismatch: ${id}`);
assert.deepEqual(manifest, modelManifest(), `Model manifest mismatch: ${id}`);
const output = `//\n` +
  `//  FramegenWeights.generated.ts\n` +
  `//  XmaxSDK\n` +
  `//\n` +
  `//  Author: 翁跃庭 (Yueting Weng)\n` +
  `//  GitHub: https://github.com/Xmax-AI/XmaxSDK-Web\n` +
  `//\n` +
  `//  Copyright (c) 2026 XMAX.AI PTE. LTD.\n` +
  `//\n\n` +
  `// 由 scripts/embed-framegen.mjs 自动生成，请勿手动修改。\n` +
  `// framegen ${metadata.version}, model ${id}, SHA-256: ${hash}\n` +
  `/**\n * 当前内嵌插帧模型的标识与权重校验值。\n */\n` +
  `export const frameInterpolationModel = ${JSON.stringify({ id, sha256: hash })} as const;\n` +
  `\n/**\n * Base64 编码的插帧模型权重，运行时按需解码并缓存。\n */\n` +
  `export const weightsBase64 = ${JSON.stringify(weights.toString('base64'))};\n` +
  `\n/**\n * 模型张量在权重数据中的偏移和形状。\n */\n` +
  `export const weightsManifest = ${JSON.stringify(manifest)};\n`;
await writeFile(new URL('../src/Foundation/Media/Video/FramegenWeights.generated.ts', import.meta.url), output);
console.log(`Embedded ${id} for framegen ${metadata.version}: ${weights.length} bytes (${hash})`);
