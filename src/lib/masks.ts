import type { Rect, Region } from './types';

/** Maximale Kantenlänge der Pinsel-Masken (spart Speicher, wird beim Export hochskaliert). */
export const MASK_MAX = 720;

export function maskSize(vw: number, vh: number) {
  const s = Math.min(1, MASK_MAX / Math.max(vw, vh));
  return { w: Math.round(vw * s), h: Math.round(vh * s), s };
}

export function newMaskCanvas(vw: number, vh: number): HTMLCanvasElement {
  const { w, h } = maskSize(vw, vh);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

/** Schwarz-weiße Maske in voller Videoauflösung für ffmpeg (weiß = entfernen). */
export function regionMaskCanvas(r: Region, vw: number, vh: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = vw;
  c.height = vh;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, vw, vh);
  ctx.fillStyle = '#fff';
  if (r.kind === 'rect' && r.rect) {
    ctx.fillRect(Math.round(r.rect.x), Math.round(r.rect.y), Math.round(r.rect.w), Math.round(r.rect.h));
  } else if (r.mask) {
    // Masken-Alpha → weiß; danach hart schwellen, damit keine Graustufen übrig bleiben
    const tmp = document.createElement('canvas');
    tmp.width = vw;
    tmp.height = vh;
    const t = tmp.getContext('2d')!;
    t.drawImage(r.mask, 0, 0, vw, vh);
    const img = t.getImageData(0, 0, vw, vh);
    const out = ctx.getImageData(0, 0, vw, vh);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = img.data[i + 3] > 40 ? 255 : 0;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }
  return c;
}

/** Begrenzungsrechteck einer Region in Videopixeln (für Zuschnitt-Vorschläge). */
export function regionBounds(r: Region, vw: number, vh: number): Rect | null {
  if (r.kind === 'rect') return r.rect ?? null;
  if (!r.mask) return null;
  const { width: w, height: h } = r.mask;
  const d = r.mask.getContext('2d')!.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3] > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return null;
  const sx = vw / w, sy = vh / h;
  return { x: minX * sx, y: minY * sy, w: (maxX - minX + 1) * sx, h: (maxY - minY + 1) * sy };
}

/** Erkennungs-Ergebnis (Analyse-Auflösung) als Pinsel-Maske in Masken-Auflösung. */
export function maskFromDetection(
  det: { mask: Uint8ClampedArray; w: number; h: number },
  vw: number,
  vh: number,
): HTMLCanvasElement {
  const c = newMaskCanvas(vw, vh);
  const small = document.createElement('canvas');
  small.width = det.w;
  small.height = det.h;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(det.w, det.h);
  for (let i = 0; i < det.mask.length; i++) {
    if (det.mask[i]) {
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 40;
      img.data[i * 4 + 2] = 40;
      img.data[i * 4 + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, c.width, c.height);
  return c;
}

/**
 * Zerlegt eine Region in Rechtecke (Videopixel) für delogo:
 * zusammenhängende Flächen der Pinsel-Maske werden einzeln umrahmt.
 */
export function regionBoxes(r: Region, vw: number, vh: number): Rect[] {
  if (r.kind === 'rect') return r.rect && r.rect.w > 1 && r.rect.h > 1 ? [r.rect] : [];
  if (!r.mask) return [];
  const { width: w, height: h } = r.mask;
  const d = r.mask.getContext('2d')!.getImageData(0, 0, w, h).data;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < on.length; i++) on[i] = d[i * 4 + 3] > 40 ? 1 : 0;
  const seen = new Uint8Array(w * h);
  let boxes: Rect[] = [];
  const stack: number[] = [];
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || seen[s]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      // 8er-Nachbarschaft
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (on[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
    boxes.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  // Überlappende oder fast berührende Rechtecke zusammenfassen
  const gap = 3;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x - gap <= b.x + b.w && b.x - gap <= a.x + a.w && a.y - gap <= b.y + b.h && b.y - gap <= a.y + a.h) {
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          boxes[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
  }
  const sx = vw / w, sy = vh / h, pad = 2;
  boxes = boxes.map((b) => ({ x: b.x * sx - pad, y: b.y * sy - pad, w: b.w * sx + 2 * pad, h: b.h * sy + 2 * pad }));
  return boxes;
}
