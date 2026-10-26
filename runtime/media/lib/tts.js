import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { BoundedProcess, contained } from './process.js';
import { pcmInfo } from './audio.js';
/** Program-only backend. Delivery authority must bind the approved final text before calling it. */
export class SystemSpeech {
    root;
    settings;
    worker;
    constructor(root, settings, worker = new BoundedProcess(root)) {
        this.root = root;
        this.settings = settings;
        this.worker = worker;
    }
    async synthesize(approved, signal) {
        approved.guard();
        signal.throwIfAborted();
        const text = approved.text;
        if (!text || Array.from(text).length > 2000 || createHash('sha256').update(text).digest('hex') !== approved.textHash)
            throw new Error('MEDIA_TTS_TEXT_UNAPPROVED');
        const directory = await mkdtemp(join(this.root, 'job-'));
        await contained(this.root, directory);
        try {
            const request = join(directory, 'tts.json');
            await writeFile(request, JSON.stringify({ text, voice: this.settings.voice }), { flag: 'wx' });
            const result = await this.worker.run({ executable: this.settings.powershell, arguments: ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('../workers/system-speech.ps1', import.meta.url)), request], memoryBytes: 512 * 1024 ** 2, timeoutMs: 120000, maxStdoutBytes: 16000 * 120 * 2, maxStderrBytes: 4096, signal });
            signal.throwIfAborted();
            approved.guard();
            const pcm = result.stdout;
            if (!pcm.length || pcm.length % 2)
                throw new Error('MEDIA_TTS_INVALID');
            const header = Buffer.alloc(44);
            header.write('RIFF');
            header.writeUInt32LE(pcm.length + 36, 4);
            header.write('WAVEfmt ', 8);
            header.writeUInt32LE(16, 16);
            header.writeUInt16LE(1, 20);
            header.writeUInt16LE(1, 22);
            header.writeUInt32LE(16000, 24);
            header.writeUInt32LE(32000, 28);
            header.writeUInt16LE(2, 32);
            header.writeUInt16LE(16, 34);
            header.write('data', 36);
            header.writeUInt32LE(pcm.length, 40);
            const data = Buffer.concat([header, pcm]);
            return { data, mime: 'audio/wav', textHash: approved.textHash, voice: this.settings.voice, ...pcmInfo(data) };
        }
        finally {
            await contained(this.root, directory);
            await rm(directory, { recursive: true, force: true });
        }
    }
}
