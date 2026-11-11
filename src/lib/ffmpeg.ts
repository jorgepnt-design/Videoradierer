import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { buildArgs } from './buildJob';
import type { ExportSettings, MaskSpec, Region } from './types';
import { regionBoxes, regionMaskCanvas } from './masks';

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

/** ffmpeg.wasm erst beim ersten Bedarf laden (ca. 30 MB, wird danach gecacht). */
export function loadFFmpeg(): Promise<FFmpeg> {
  if (instance) return Promise.resolve(instance);
  if (!loading) {
    loading = (async () => {
      const ff = new FFmpeg();
      await ff.load({ coreURL, wasmURL });
      instance = ff;
      return ff;
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

export function cancelFFmpeg() {
  instance?.terminate();
  instance = null;
  loading = null;
}

function canvasToPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((res, rej) =>
    c.toBlob(async (b) => {
      if (!b) return rej(new Error('Maske konnte nicht erstellt werden.'));
      res(new Uint8Array(await b.arrayBuffer()));
    }, 'image/png'),
  );
}

export interface ExportInput {
  file: File;
  width: number;
  height: number;
  duration: number;
  regions: Region[];
  settings: ExportSettings;
  onProgress: (p: number) => void;
  onLog?: (line: string) => void;
}

export async function exportVideo(inp: ExportInput): Promise<Blob> {
  try {
    return await attempt(inp, true);
  } catch (e) {
    // Engine nach einem Fehler neu starten und mit neu kodiertem Ton noch einmal versuchen
    cancelFFmpeg();
    try {
      return await attempt(inp, false);
    } catch (e2) {
      cancelFFmpeg();
      throw e2 ?? e;
    }
  }
}

async function attempt(inp: ExportInput, copyAudio: boolean): Promise<Blob> {
  const ff = await loadFFmpeg();
  const output = 'output.mp4';
  const written: string[] = [];
  // Das Video wird NICHT in den Speicher kopiert, sondern direkt aus der Datei gelesen (WORKERFS).
  // Das spart auf dem iPhone mehrere hundert MB und verhindert Abstürze.
  const dir = '/in';
  const ext = (inp.file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const file = new File([inp.file], `video.${ext}`, { type: inp.file.type });
  const input = `${dir}/${file.name}`;
  try {
    await ff.createDir(dir);
  } catch {
    /* existiert schon */
  }
  await ff.mount(FFFSType.WORKERFS, { files: [file] }, dir);

  let lastErr = '';
  const debug = /[?&]debug\b/.test(location.search);
  const onLog = ({ message }: { message: string }) => {
    inp.onLog?.(message);
    if (debug) console.log('[ffmpeg]', message);
    if (/error|invalid|failed|could not|not divisible|do not match/i.test(message)) lastErr = message;
    const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(message);
    if (m) {
      const t = +m[1] * 3600 + +m[2] * 60 + +m[3];
      inp.onProgress(Math.min(0.99, t / inp.duration));
    }
  };
  ff.on('log', onLog);

  try {
    const masks: MaskSpec[] = [];
    for (let i = 0; i < inp.regions.length; i++) {
      const r = inp.regions[i];
      const spec: MaskSpec = { boxes: regionBoxes(r, inp.width, inp.height), start: r.start, end: r.end };
      if (inp.settings.method === 'blur') {
        // Weichzeichnen folgt der genauen Pinselform → Masken-Bild nötig
        spec.file = `mask${i}.png`;
        await ff.writeFile(spec.file, await canvasToPng(regionMaskCanvas(r, inp.width, inp.height)));
        written.push(spec.file);
      }
      masks.push(spec);
    }

    const args = buildArgs({
      input, output, width: inp.width, height: inp.height, duration: inp.duration,
      masks, settings: inp.settings, copyAudio,
    });
    if (debug) console.log('[ffmpeg] args', JSON.stringify(args));
    const code = await ff.exec(args);
    if (code !== 0) throw new Error(lastErr || `ffmpeg wurde mit Fehler ${code} beendet.`);

    const data = (await ff.readFile(output)) as Uint8Array;
    written.push(output);
    inp.onProgress(1);
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    ff.off('log', onLog);
    try {
      await ff.unmount(dir);
    } catch {
      /* ignorieren */
    }
    for (const f of written) {
      try {
        await ff.deleteFile(f);
      } catch {
        /* existiert evtl. nicht */
      }
    }
  }
}
