import type { JobSpec, Rect } from './types';

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** Zuschnitt auf gerade Werte innerhalb des Bildes bringen (x264 braucht gerade Maße). */
export function normalizeCrop(c: Rect, width: number, height: number): Rect {
  let x = Math.max(0, Math.round(c.x));
  let y = Math.max(0, Math.round(c.y));
  x -= x % 2;
  y -= y % 2;
  const w = even(Math.min(c.w, width - x));
  const h = even(Math.min(c.h, height - y));
  return { x, y, w, h };
}

/** Zielgröße für "auf 9:16 bringen" – der Zuschnitt passt immer vollständig hinein. */
export function fitSize(w: number, h: number): { w: number; h: number } {
  let H = even(h);
  let W = even((H * 9) / 16);
  if (W < w) {
    W = even(w);
    H = even((W * 16) / 9);
  }
  return { w: W, h: H };
}

/** delogo braucht mindestens 1 Pixel Abstand zum Bildrand. */
export function delogoBox(b: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(1, Math.floor(b.x));
  const y0 = Math.max(1, Math.floor(b.y));
  const x1 = Math.min(width - 1, Math.ceil(b.x + b.w));
  const y1 = Math.min(height - 1, Math.ceil(b.y + b.h));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function enableExpr(start: number, end: number, duration: number): string {
  if (start <= 0.01 && end >= duration - 0.01) return '';
  return `:enable='between(t,${fmt(start)},${fmt(end)})'`;
}

/**
 * Baut die ffmpeg-Argumente für einen Exportauftrag.
 * Reihenfolge: Bereiche entfernen/weichzeichnen → zuschneiden → 9:16 → skalieren.
 */
export function buildArgs(job: JobSpec): string[] {
  const { settings, masks, duration } = job;
  // Arbeitsgröße = Anzeigegröße im Browser (gerade Werte). Gleicht Videos mit
  // nicht-quadratischen Pixeln (SAR) an, damit Markierungen exakt passen.
  const width = even(job.width);
  const height = even(job.height);
  const args: string[] = ['-i', job.input];
  const parts: string[] = [];
  let n = 0;
  const next = () => `[s${n++}]`;
  let cur = next();
  parts.push(`[0:v]scale=${width}:${height},setsar=1${cur}`);

  if (settings.method === 'blur' && masks.some((m) => m.file)) {
    const sigma = Math.max(8, Math.round(Math.min(width, height) / 40));
    masks.filter((m) => m.file).forEach((m, i) => {
      args.push('-loop', '1', '-i', m.file!);
      const a = next(), b = next(), bl = next(), mk = next(), merged = next(), out = next();
      parts.push(`${cur}split${a}${b}`);
      parts.push(`${b}gblur=sigma=${sigma}${bl}`);
      parts.push(`[${i + 1}:v]scale=${width}:${height},format=gray${mk}`);
      parts.push(`${bl}${mk}alphamerge${merged}`);
      parts.push(`${a}${merged}overlay=0:0:shortest=1${enableExpr(m.start, m.end, duration)}${out}`);
      cur = out;
    });
  } else {
    // delogo füllt ein Rechteck aus den umliegenden Pixeln – schnell, auch im Browser
    const filters: string[] = [];
    for (const m of masks) {
      for (const b of m.boxes) {
        const d = delogoBox(b, width, height);
        if (d) filters.push(`delogo=x=${d.x}:y=${d.y}:w=${d.w}:h=${d.h}${enableExpr(m.start, m.end, duration)}`);
      }
    }
    if (filters.length) {
      const out = next();
      parts.push(`${cur}${filters.join(',')}${out}`);
      cur = out;
    }
  }

  let curW = width;
  let curH = height;
  if (settings.crop) {
    const c = normalizeCrop(settings.crop, width, height);
    if (c.w !== width || c.h !== height) {
      const out = next();
      parts.push(`${cur}crop=${c.w}:${c.h}:${c.x}:${c.y}${out}`);
      cur = out;
      curW = c.w;
      curH = c.h;
    }
  }

  if (settings.fit === 'blur916') {
    const t = fitSize(curW, curH);
    if (t.w !== curW || t.h !== curH) {
      const a = next(), b = next(), bg = next(), fg = next(), out = next();
      const sigma = Math.max(10, Math.round(t.w / 25));
      parts.push(`${cur}split${a}${b}`);
      parts.push(
        `${a}scale=${t.w}:${t.h}:force_original_aspect_ratio=increase,crop=${t.w}:${t.h},gblur=sigma=${sigma}${bg}`,
      );
      parts.push(`${b}scale=${t.w}:${t.h}:force_original_aspect_ratio=decrease,setsar=1${fg}`);
      parts.push(`${bg}${fg}overlay=(W-w)/2:(H-h)/2${out}`);
      cur = out;
      curW = t.w;
      curH = t.h;
    }
  }

  let tail = '';
  if (settings.quality === '720p' && Math.min(curW, curH) > 720) {
    tail =
      curW <= curH
        ? `scale=720:-2:flags=lanczos,`
        : `scale=-2:720:flags=lanczos,`;
  }
  parts.push(`${cur}${tail}format=yuv420p[out]`);

  args.push(
    '-filter_complex', parts.join(';'),
    '-map', '[out]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '20',
    '-c:a', ...(job.copyAudio ? ['copy'] : ['aac', '-b:a', '192k']),
    '-t', fmt(duration),
    '-movflags', '+faststart',
    '-y', job.output,
  );
  return args;
}
