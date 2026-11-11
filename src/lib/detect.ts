import type { Rect } from './types';

/** Graustufen-Frames in kleiner Analyse-Auflösung */
export interface FrameStack {
  w: number;
  h: number;
  frames: Uint8ClampedArray[];
}

export interface DetectionResult {
  /** Maske in Analyse-Auflösung, 255 = Overlay */
  mask: Uint8ClampedArray;
  w: number;
  h: number;
  /** Gefundene Symbole als Rechtecke (Analyse-Auflösung) */
  boxes: Rect[];
}

function sobel(f: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -f[i - w - 1] - 2 * f[i - 1] - f[i + w - 1] + f[i - w + 1] + 2 * f[i + 1] + f[i + w + 1];
      const gy =
        -f[i - w - 1] - 2 * f[i - w] - f[i - w + 1] + f[i + w - 1] + 2 * f[i + w] + f[i + w + 1];
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

function dilate(m: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  // getrennt horizontal + vertikal (quadratisches Strukturelement)
  const tmp = new Uint8ClampedArray(m.length);
  const out = new Uint8ClampedArray(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !v; k++) v = m[y * w + k];
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !v; k++) v = tmp[k * w + x];
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * Entfernt lange, gerade Kantenzüge (Türrahmen, Bildkanten, Balken) –
 * Symbole und Zahlen bestehen nur aus kurzen Kanten.
 */
function suppressLongLines(m: Uint8ClampedArray, w: number, h: number, maxV: number, maxH: number) {
  const kill = new Uint8Array(m.length);
  const near = (x: number, y: number) => m[y * w + x];
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!near(x, y)) { y++; continue; }
      const s = y;
      while (y < h && near(x, y)) y++;
      if (y - s > maxV) for (let k = s; k < y; k++) kill[k * w + x] = 1;
    }
  }
  const nearH = (x: number, y: number) => m[y * w + x];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!nearH(x, y)) { x++; continue; }
      const s = x;
      while (x < w && nearH(x, y)) x++;
      if (x - s > maxH) for (let k = s; k < x; k++) kill[y * w + k] = 1;
    }
  }
  for (let i = 0; i < m.length; i++) if (kill[i]) m[i] = 0;
}

/**
 * Findet statische Einblendungen (Symbole, Zahlen, Logos): Pixel, die sich über die Zeit
 * kaum verändern, aber in jedem Frame deutliche Kanten haben – während der Rest des Videos sich bewegt.
 */
export function detectStaticOverlays(stack: FrameStack, content: Rect | null = null): DetectionResult {
  const { w, h, frames } = stack;
  const n = frames.length;
  const N = w * h;
  const mean = new Float32Array(N);
  const sq = new Float32Array(N);
  const edgeHits = new Uint16Array(N);
  const edgeSum = new Float32Array(N);

  for (const f of frames) {
    const e = sobel(f, w, h);
    for (let i = 0; i < N; i++) {
      mean[i] += f[i];
      sq[i] += f[i] * f[i];
      edgeSum[i] += e[i];
      if (e[i] > 50) edgeHits[i]++;
    }
  }

  const std = new Float32Array(N);
  let motion = 0;
  for (let i = 0; i < N; i++) {
    mean[i] /= n;
    std[i] = Math.sqrt(Math.max(0, sq[i] / n - mean[i] * mean[i]));
    motion += std[i];
  }
  motion /= N;

  // Schwellwerte an die Gesamtbewegung des Videos anpassen
  const stdMax = Math.max(6, Math.min(18, motion * 0.4));
  const raw = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) {
    const persistentEdge = edgeHits[i] >= n * 0.8 && edgeSum[i] / n > 80;
    if (persistentEdge && std[i] < stdMax) raw[i] = 255;
  }
  if (content) {
    // nur innerhalb des eigentlichen Bildes suchen (ohne schwarze Ränder und deren Kante)
    const m = 2;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (x < content.x + m || x >= content.x + content.w - m || y < content.y + m || y >= content.y + content.h - m)
          raw[y * w + x] = 0;
  }
  suppressLongLines(raw, w, h, Math.max(12, Math.round(h * 0.1)), Math.max(12, Math.round(w * 0.22)));

  // Kanten zu Flächen schließen, dann Komponenten bewerten
  const grown = dilate(raw, w, h, 1);
  const label = new Int32Array(N);
  const boxes: Rect[] = [];
  const keep = new Uint8ClampedArray(N);
  const stackXY: number[] = [];
  let id = 0;
  for (let s = 0; s < N; s++) {
    if (!grown[s] || label[s]) continue;
    id++;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0, hits = 0;
    const members: number[] = [];
    stackXY.push(s);
    label[s] = id;
    while (stackXY.length) {
      const p = stackXY.pop()!;
      members.push(p);
      const x = p % w, y = (p - x) / w;
      area++;
      if (raw[p]) hits++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && grown[q] && !label[q]) { label[q] = id; stackXY.push(q); }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const tooSmall = hits < 6 || bw * bh < 16;
    // Riesige Komponenten sind eher statischer Hintergrund als ein Symbol
    const tooBig = bw > w * 0.45 || bh > h * 0.3;
    const lineLike = Math.max(bw, bh) / Math.min(bw, bh) > 6;
    if (tooSmall || tooBig || lineLike) continue;
    for (const p of members) keep[p] = 255;
    boxes.push({ x: minX, y: minY, w: bw, h: bh });
  }

  return { mask: dilate(keep, w, h, 1), w, h, boxes };
}

/** Erkennt einfarbig dunkle Ränder (z. B. schwarzer Balken unter einer Bildschirmaufnahme). */
export function detectBars(stack: FrameStack, threshold = 22): Rect {
  const { w, h, frames } = stack;
  const max = new Uint8ClampedArray(w * h);
  for (const f of frames) for (let i = 0; i < f.length; i++) if (f[i] > max[i]) max[i] = f[i];
  const rowDark = (y: number) => {
    let dark = 0;
    for (let x = 0; x < w; x++) if (max[y * w + x] <= threshold) dark++;
    return dark >= w * 0.97;
  };
  const colDark = (x: number, y0: number, y1: number) => {
    let dark = 0;
    for (let y = y0; y < y1; y++) if (max[y * w + x] <= threshold) dark++;
    return dark >= (y1 - y0) * 0.97;
  };
  let top = 0, bottom = h;
  while (top < h / 3 && rowDark(top)) top++;
  while (bottom > (h * 2) / 3 && rowDark(bottom - 1)) bottom--;
  let left = 0, right = w;
  while (left < w / 3 && colDark(left, top, bottom)) left++;
  while (right > (w * 2) / 3 && colDark(right - 1, top, bottom)) right--;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Schlägt einen Zuschnitt vor, der alle markierten Bereiche am Rand abschneidet
 * und dabei möglichst viel Bild behält.
 */
export function suggestCrop(base: Rect, boxes: Rect[], pad = 4): Rect {
  let c = { ...base };
  for (const b of boxes) {
    const bx0 = b.x - pad, by0 = b.y - pad, bx1 = b.x + b.w + pad, by1 = b.y + b.h + pad;
    if (bx1 <= c.x || by1 <= c.y || bx0 >= c.x + c.w || by0 >= c.y + c.h) continue; // schon draußen
    const options: Rect[] = [
      { x: c.x, y: c.y, w: bx0 - c.x, h: c.h }, // rechts abschneiden
      { x: bx1, y: c.y, w: c.x + c.w - bx1, h: c.h }, // links abschneiden
      { x: c.x, y: c.y, w: c.w, h: by0 - c.y }, // unten abschneiden
      { x: c.x, y: by1, w: c.w, h: c.y + c.h - by1 }, // oben abschneiden
    ].filter((o) => o.w > base.w * 0.4 && o.h > base.h * 0.4);
    if (!options.length) continue;
    options.sort((a, b2) => b2.w * b2.h - a.w * a.h);
    c = options[0];
  }
  return c;
}
