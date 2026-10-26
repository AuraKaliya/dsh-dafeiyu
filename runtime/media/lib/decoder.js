import { realpath } from 'node:fs/promises';
import { z } from 'zod';
import { BoundedProcess, contained } from './process.js';
import { MediaRangeBroker } from './range-broker.js';
const formats = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,wav,mp3,ogg,flac,image2,png_pipe,jpeg_pipe,webp_pipe,gif';
const numberText = z.union([z.string(), z.number()]).transform(v => Number(v)).refine(Number.isFinite);
const probeSchema = z.object({ streams: z.array(z.object({ codec_type: z.string(), codec_name: z.string().optional(), width: z.number().optional(), height: z.number().optional(), duration: numberText.optional(), start_time: numberText.optional(), sample_rate: numberText.optional(), channels: z.number().optional() })).max(64),
    format: z.object({ format_name: z.string(), duration: numberText.optional(), start_time: numberText.optional(), size: numberText.optional() }) });
export class MediaDecoder {
    process;
    allowedRoot;
    tools;
    limits;
    constructor(process, allowedRoot, tools, limits = { maxPixels: 16000000, maxDimension: 1024, maxAudioMs: 120000, memoryBytes: 512 * 1024 ** 2, timeoutMs: 120000 }) {
        this.process = process;
        this.allowedRoot = allowedRoot;
        this.tools = tools;
        this.limits = limits;
    }
    async input(value) {
        if ('broker' in value)
            return { uri: value.broker.url(), protocols: 'http,tcp,pipe' };
        return { uri: await contained(this.allowedRoot, await realpath(value.file)), protocols: 'file,pipe' };
    }
    async run(executable, args, signal, max = 16 * 1024 ** 2) { return this.process.run({ executable, arguments: args, signal, timeoutMs: this.limits.timeoutMs, memoryBytes: this.limits.memoryBytes, maxStdoutBytes: max, maxStderrBytes: 65536 }); }
    async inspect(input, signal) {
        const source = await this.input(input), result = await this.run(this.tools.ffprobe, ['-hide_banner', '-v', 'error', '-protocol_whitelist', source.protocols, '-format_whitelist', formats, '-enable_drefs', '0', '-use_absolute_path', '0', '-show_streams', '-show_format', '-of', 'json', source.uri], signal, 65536);
        let value;
        try {
            value = probeSchema.parse(JSON.parse(result.stdout.toString('utf8')));
        }
        catch {
            throw new Error('MEDIA_PROBE_INVALID');
        }
        const video = value.streams.find(s => s.codec_type === 'video'), audio = value.streams.find(s => s.codec_type === 'audio');
        if (video && (video.width === undefined || video.height === undefined || video.width < 1 || video.height < 1 || video.width * video.height > this.limits.maxPixels))
            throw new Error('MEDIA_PIXEL_LIMIT');
        const duration = value.format.duration ?? video?.duration ?? audio?.duration;
        const still = ['image2', 'png_pipe', 'jpeg_pipe', 'webp_pipe', 'gif'].some(format => value.format.format_name.split(',').includes(format));
        return { kind: video ? still ? 'image' : 'video' : audio ? 'audio' : 'unknown', width: video?.width ?? null, height: video?.height ?? null, durationMs: duration === undefined ? null : Math.round(duration * 1000),
            startMs: Math.round((value.format.start_time ?? 0) * 1000), videoCodec: video?.codec_name ?? null, audioCodec: audio?.codec_name ?? null, sampleRate: audio?.sample_rate ?? null, channels: audio?.channels ?? null, format: value.format.format_name, peakCommitBytes: result.peakCommitBytes };
    }
    png(data) {
        if (data.length < 33 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
            throw new Error('MEDIA_IMAGE_DECODE_FAILED');
        const width = data.readUInt32BE(16), height = data.readUInt32BE(20), type = data[25];
        if (width < 1 || height < 1 || width > this.limits.maxDimension || height > this.limits.maxDimension || width * height > this.limits.maxPixels)
            throw new Error('MEDIA_PIXEL_LIMIT');
        return { width, height, hasAlpha: type === 4 || type === 6 };
    }
    inputOptions(format) { return format.split(',').includes('mov') ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : []; }
    async image(input, signal, pointMs) {
        if (pointMs !== undefined && (!Number.isSafeInteger(pointMs) || pointMs < 0))
            throw new Error('MEDIA_INTERVAL_INVALID');
        const metadata = await this.inspect(input, signal);
        if (metadata.videoCodec === null)
            throw new Error('MEDIA_IMAGE_UNAVAILABLE');
        if (pointMs !== undefined && metadata.durationMs !== null && pointMs >= metadata.durationMs)
            throw new Error('MEDIA_INTERVAL_INVALID');
        const source = await this.input(input), size = this.limits.maxDimension;
        const result = await this.run(this.tools.ffmpeg, ['-nostdin', '-hide_banner', '-v', pointMs === undefined ? 'error' : 'info', '-threads', '2', '-protocol_whitelist', source.protocols, '-format_whitelist', formats, ...this.inputOptions(metadata.format),
            ...(pointMs === undefined ? [] : ['-copyts', '-ss', String(pointMs / 1000)]), '-i', source.uri, '-map', '0:v:0', '-frames:v', '1', '-vf', `scale=w=min(${size}\\,iw):h=min(${size}\\,ih):force_original_aspect_ratio=decrease:reset_sar=1${pointMs === undefined ? '' : ',showinfo'}`,
            '-pix_fmt', 'rgba', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], signal, 16 * 1024 ** 2);
        const info = this.png(result.stdout), match = pointMs === undefined ? null : /\bn:\s*0\s+pts:\s*-?\d+\s+pts_time:([-\d.]+)/.exec(result.stderr.toString('utf8'));
        if (pointMs !== undefined && !match)
            throw new Error('MEDIA_FRAME_TIMESTAMP_MISSING');
        const pts = match ? Math.round(Number(match[1]) * 1000) - metadata.startMs : null;
        if (pts !== null && (!Number.isSafeInteger(pts) || pts < 0))
            throw new Error('MEDIA_FRAME_TIMESTAMP_INVALID');
        return { data: result.stdout, mime: 'image/png', ...info, requestedMs: pointMs ?? null, ptsMs: pts };
    }
    async audio(input, startMs, endMs, signal) {
        if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs || endMs - startMs > this.limits.maxAudioMs)
            throw new Error('MEDIA_INTERVAL_INVALID');
        const metadata = await this.inspect(input, signal);
        if (metadata.audioCodec === null)
            throw new Error('MEDIA_AUDIO_UNAVAILABLE');
        if (metadata.durationMs !== null && startMs >= metadata.durationMs)
            throw new Error('MEDIA_INTERVAL_INVALID');
        const source = await this.input(input);
        const result = await this.run(this.tools.ffmpeg, ['-nostdin', '-hide_banner', '-v', 'error', '-threads', '2', '-protocol_whitelist', source.protocols, '-format_whitelist', formats, ...this.inputOptions(metadata.format), '-ss', String(startMs / 1000), '-i', source.uri, '-t', String((endMs - startMs) / 1000), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'], signal, this.limits.maxAudioMs * 32 + 4096);
        if (!result.stdout.length || result.stdout.length % 2)
            throw new Error('MEDIA_AUDIO_DECODE_FAILED');
        const samples = result.stdout.length / 2, durationMs = samples / 16, header = Buffer.alloc(44);
        header.write('RIFF');
        header.writeUInt32LE(result.stdout.length + 36, 4);
        header.write('WAVEfmt ', 8);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(1, 22);
        header.writeUInt32LE(16000, 24);
        header.writeUInt32LE(32000, 28);
        header.writeUInt16LE(2, 32);
        header.writeUInt16LE(16, 34);
        header.write('data', 36);
        header.writeUInt32LE(result.stdout.length, 40);
        return { data: Buffer.concat([header, result.stdout]), mime: 'audio/wav', sampleRate: 16000, channels: 1, samples, startMs, endMs: startMs + durationMs, requestedEndMs: endMs, sourceDurationMs: metadata.durationMs,
            completeness: Math.abs(startMs + durationMs - endMs) < 2 ? 'complete' : 'partial', peakCommitBytes: result.peakCommitBytes };
    }
}
