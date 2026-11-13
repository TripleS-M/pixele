import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MAX_GUESSES, PROCESSED_DIR, THUMBS_DIR, getConfig, type StageConfig } from './config';

export const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

// 4x4 Bayer matrix for the optional ordered-dither effect.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The effective per-stage settings for an asset (global config + optional per-image resolution override). */
export function effectiveStages(blocksOverride: number[] | null): StageConfig[] {
  const { stages } = getConfig().pixelation;
  return stages.map((s, i) => ({
    ...s,
    blocks: blocksOverride && Number.isFinite(blocksOverride[i]) ? blocksOverride[i] : s.blocks,
  }));
}

/** Changes whenever the pixelation settings that apply to an asset change -> triggers reprocessing. */
export function stageSignature(blocksOverride: number[] | null): string {
  const payload = JSON.stringify(['v2', getConfig().pixelation.outputSize, effectiveStages(blocksOverride)]);
  return crypto.createHash('sha1').update(payload).digest('hex').slice(0, 12);
}

/** Throws if the file is not a readable JPG / PNG / WEBP image. */
export async function validateImage(input: string | Buffer): Promise<void> {
  const meta = await sharp(input).metadata();
  if (!meta.format || !SUPPORTED_FORMATS.has(meta.format) || !meta.width || !meta.height) {
    throw new Error('Not a valid JPG, PNG or WEBP image');
  }
}

/** Optional effect (off by default): quantises raw RGB pixels in place with ordered dithering. */
function dither(data: Buffer, width: number, height: number, stage: StageConfig) {
  const steps = Math.max(1, stage.levels - 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const t = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
      if (stage.mono) {
        const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
        const v = lum + t * 0.9 >= 0.5 ? 255 : 0;
        data[i] = data[i + 1] = data[i + 2] = v;
      } else {
        for (let c = 0; c < 3; c++) {
          const q = Math.round(Math.min(1, Math.max(0, data[i + c] / 255 + t / steps)) * steps);
          data[i + c] = Math.round((q * 255) / steps);
        }
      }
    }
  }
}

/** Stages 1..5 are the low-resolution versions; anything above is the original. */
export const stagePath = (id: string, stage: number) =>
  path.join(PROCESSED_DIR, id, stage > MAX_GUESSES ? 'original.webp' : `stage-${stage}.png`);
export const thumbPath = (id: string) => path.join(THUMBS_DIR, `${id}.webp`);

/**
 * Generates everything the game needs from one original image:
 *   stage-1..5.png  the image shrunk to a low resolution (each stage a little higher).
 *                   They are stored at that tiny size; the browser scales them back
 *                   up with nearest-neighbour, which is what makes the pixels visible.
 *   original.webp   the full image, only ever served once a game is over
 *   thumbnail       for the admin dashboard
 * The original file in the library is never modified.
 */
export async function processImage(id: string, sourcePath: string, blocksOverride: number[] | null) {
  const { outputSize } = getConfig().pixelation;
  const dir = path.join(PROCESSED_DIR, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(THUMBS_DIR, { recursive: true });

  const base = await sharp(sourcePath, { failOn: 'none' })
    .rotate() // respect EXIF orientation
    .flatten({ background: '#ffffff' })
    .resize(outputSize, outputSize, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  const longSide = Math.max(width, height);

  const stages = effectiveStages(blocksOverride);
  for (let n = 0; n < stages.length; n++) {
    const stage = stages[n];
    const blocks = Math.min(stage.blocks, longSide);
    // Shrink, keeping the aspect ratio.
    const bw = Math.max(1, Math.round((width * blocks) / longSide));
    const bh = Math.max(1, Math.round((height * blocks) / longSide));
    const small = await sharp(base.data).resize(bw, bh, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    if (stage.mono || stage.levels < 256) dither(small, bw, bh, stage);
    await sharp(small, { raw: { width: bw, height: bh, channels: 3 } })
      .png({ compressionLevel: 9 })
      .toFile(stagePath(id, n + 1));
  }

  await sharp(base.data).webp({ quality: 90 }).toFile(stagePath(id, MAX_GUESSES + 1));
  await sharp(base.data)
    .resize(360, 360, { fit: 'inside' })
    .webp({ quality: 78 })
    .toFile(thumbPath(id));

  return { width, height, signature: stageSignature(blocksOverride) };
}

export function removeProcessed(id: string) {
  fs.rmSync(path.join(PROCESSED_DIR, id), { recursive: true, force: true });
  fs.rmSync(thumbPath(id), { force: true });
}
