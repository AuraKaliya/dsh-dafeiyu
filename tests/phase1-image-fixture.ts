import { AttachmentStore, AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment';
import type { ImageAttachmentRef, ImageAttachmentLimits, SaveImageAttachment, ImageRequestTarget, RequestImageAttachment } from '@deepseek-ai/dsh-attachment';
import type { Context } from '@deepseek-ai/cordis';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Color = 'red' | 'green' | 'blue' | 'yellow';
type Shape = 'circle' | 'square' | 'triangle';
export interface ImageFixture { data: Buffer; width: number; height: number; expected: { color: Color; shape: Shape }[] }
const colors: Record<Color, readonly [number, number, number]> = {
  red: [230, 35, 35], green: [20, 170, 60], blue: [30, 70, 230], yellow: [245, 205, 20],
};
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]);
}

/** Synthetic fixture, generated locally. The answer is absent from filename, prompt and image metadata. */
export function createImageFixture(seed: number): ImageFixture {
  const width = 480, height = 320, rowSize = 1 + width * 3, pixels = Buffer.alloc(height * rowSize, 255);
  for (let y = 0; y < height; y++) pixels[y * rowSize] = 0;
  let state = seed >>> 0;
  const next = (n: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
  const palette: Color[] = ['red', 'green', 'blue', 'yellow'], shapes: Shape[] = ['circle', 'square', 'triangle'];
  const expected: ImageFixture['expected'] = [];
  for (let cell = 0; cell < 6; cell++) {
    const color = palette[next(palette.length)], shape = shapes[next(shapes.length)];
    if (!color || !shape) throw new Error('FIXTURE_INDEX');
    expected.push({ color, shape });
    const cx = (cell % 3) * 160 + 80, cy = Math.floor(cell / 3) * 160 + 80, radius = 43;
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx, dy = y - cy;
      const inside = shape === 'square' || (shape === 'circle' ? dx * dx + dy * dy <= radius * radius : Math.abs(dx) <= (dy + radius) / 2);
      if (!inside) continue;
      const offset = y * rowSize + 1 + x * 3; colors[color].forEach((channel, index) => { pixels[offset + index] = channel; });
    }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x % 160 === 0 || y % 160 === 0 || x === width - 1 || y === height - 1) {
      const offset = y * rowSize + 1 + x * 3; pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 100;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return { width, height, expected, data: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]) };
}

/** A single known PNG fixture backend, not a production image decoder or arbitrary-file service. */
export class ProbeAttachments extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = { maxImageBytes: 1000000, maxImagesPerMessage: 1,
    maxMessageImageBytes: 1000000, maxImagePixels: 1000000, maxImageDimension: 1000, mediaTypes: ['image/png'] };
  readonly reference: ImageAttachmentRef;
  requestReads = 0;
  private readonly file: string;
  constructor(ctx: Context, directory: string, private readonly fixture: ImageFixture) {
    super(ctx);
    const hash = createHash('sha256').update(fixture.data).digest('hex');
    this.reference = { attachmentId: AttachmentId(hash), mediaType: 'image/png', bytes: fixture.data.length,
      width: fixture.width, height: fixture.height, name: 'probe.png' };
    this.file = join(directory, `${hash}.png`);
  }
  override async validateImage(input: SaveImageAttachment): Promise<void> {
    if (input.mediaType !== 'image/png' || !Buffer.from(input.data).equals(this.fixture.data)) throw new Error('PROBE_UNKNOWN_IMAGE');
  }
  override async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    await this.validateImage(input); const { dirname } = await import('node:path');
    await mkdir(dirname(this.file), { recursive: true }); await writeFile(this.file, input.data); return { ...this.reference };
  }
  override async readImage(ref: ImageAttachmentRef, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (JSON.stringify(ref) !== JSON.stringify(this.reference)) throw new Error('PROBE_IMAGE_REFERENCE_CHANGED');
    const data = await readFile(this.file); await this.validateImage({ data, mediaType: ref.mediaType });
    return { data, ref: { ...this.reference } };
  }
  override imageHostPath(ref: ImageAttachmentRef): string | undefined {
    return ref.attachmentId === this.reference.attachmentId ? this.file : undefined;
  }
  override async readImageRequest(ref: ImageAttachmentRef, target: ImageRequestTarget, signal?: AbortSignal): Promise<RequestImageAttachment> {
    const stored = await this.readImage(ref, signal);
    if (target.width < ref.width || target.height < ref.height || target.maxBytes < ref.bytes) throw new Error('PROBE_RESIZE_REQUIRED');
    this.requestReads++;
    return { variantId: ImageVariantId(createHash('sha256').update(JSON.stringify([ref, target])).digest('hex')),
      attachment: stored.ref, data: stored.data, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height,
      depth: 'uchar', space: 'srgb', hasAlpha: false };
  }
}
