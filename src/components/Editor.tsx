import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Rect, Region } from '../lib/types';
import { newMaskCanvas } from '../lib/masks';
import { clamp, haptic, uid } from '../lib/util';

export type Tool = 'rect' | 'brush' | 'erase' | 'crop';

interface Props {
  src: string;
  vw: number;
  vh: number;
  duration: number;
  videoRef: React.RefObject<HTMLVideoElement>;
  regions: Region[];
  selectedId: string | null;
  crop: Rect | null;
  showCrop: boolean;
  tool: Tool;
  brushSize: number; // in % der Bildbreite
  currentTime: number;
  version: number;
  onSelect: (id: string | null) => void;
  /** Vor jeder Änderung aufrufen (Undo-Schnappschuss) */
  onBeginChange: () => void;
  onRegionsChange: (r: Region[]) => void;
  onCropChange: (c: Rect) => void;
  onLoaded: () => void;
}

type Drag =
  | { kind: 'none' }
  | { kind: 'new-rect'; id: string; x0: number; y0: number }
  | { kind: 'move-rect'; id: string; dx: number; dy: number }
  | { kind: 'resize-rect'; id: string; corner: number; anchor: { x: number; y: number } }
  | { kind: 'paint'; id: string; last: { x: number; y: number } }
  | { kind: 'crop-move'; dx: number; dy: number }
  | { kind: 'crop-resize'; corner: number; anchor: { x: number; y: number } };

const HANDLE = 24; // Touch-Radius in CSS-Pixeln

export function Editor(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [disp, setDisp] = useState({ w: 300, h: 500 });
  const [zoom, setZoom] = useState({ s: 1, tx: 0, ty: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const drag = useRef<Drag>({ kind: 'none' });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<null | { d0: number; c0: { x: number; y: number }; z0: typeof zoom }>(null);
  const propsRef = useRef(p);
  propsRef.current = p;

  // Anzeigegröße: Video in die verfügbare Fläche einpassen
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const fit = () => {
      const maxW = el.clientWidth;
      const maxH = Math.max(240, window.innerHeight * 0.56);
      const s = Math.min(maxW / p.vw, maxH / p.vh);
      setDisp({ w: Math.round(p.vw * s), h: Math.round(p.vh * s) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [p.vw, p.vh]);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const { regions, selectedId, crop, showCrop, vw, currentTime } = propsRef.current;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(disp.w * dpr), H = Math.round(disp.h * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    const k = W / vw; // Video-Pixel → Canvas-Pixel
    const hs = (HANDLE / 2.4) * dpr / zoomRef.current.s;

    for (const r of regions) {
      const active = currentTime >= r.start - 0.01 && currentTime <= r.end + 0.01;
      const sel = r.id === selectedId;
      ctx.globalAlpha = active ? (sel ? 0.6 : 0.45) : 0.15;
      if (r.kind === 'mask' && r.mask) {
        ctx.drawImage(r.mask, 0, 0, W, H);
      } else if (r.rect) {
        ctx.fillStyle = '#ff3b30';
        ctx.fillRect(r.rect.x * k, r.rect.y * k, r.rect.w * k, r.rect.h * k);
      }
      ctx.globalAlpha = 1;
      if (sel && r.kind === 'rect' && r.rect) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * dpr / zoomRef.current.s;
        ctx.strokeRect(r.rect.x * k, r.rect.y * k, r.rect.w * k, r.rect.h * k);
        drawHandles(ctx, r.rect, k, hs);
      }
    }

    if (showCrop && crop) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(crop.x * k, crop.y * k, crop.w * k, crop.h * k);
      ctx.fill('evenodd');
      ctx.setLineDash([8 * dpr, 6 * dpr]);
      ctx.strokeStyle = '#ffd60a';
      ctx.lineWidth = 2 * dpr / zoomRef.current.s;
      ctx.strokeRect(crop.x * k, crop.y * k, crop.w * k, crop.h * k);
      ctx.restore();
      if (propsRef.current.tool === 'crop') drawHandles(ctx, crop, k, hs, '#ffd60a');
    }
  }, [disp]);

  useEffect(draw, [draw, p.regions, p.selectedId, p.crop, p.showCrop, p.version, p.currentTime, p.tool, zoom]);

  // ---- Koordinaten ----
  const toVideo = (cx: number, cy: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: clamp(((cx - r.left) / r.width) * p.vw, 0, p.vw),
      y: clamp(((cy - r.top) / r.height) * p.vh, 0, p.vh),
    };
  };
  /** Abstand in Video-Pixeln, der HANDLE CSS-Pixeln entspricht */
  const handleRadius = () => {
    const r = canvasRef.current!.getBoundingClientRect();
    return (HANDLE * p.vw) / r.width;
  };

  const hitCorner = (rect: Rect, pt: { x: number; y: number }) => {
    const hr = handleRadius();
    const cs = corners(rect);
    for (let i = 0; i < 4; i++) if (Math.hypot(cs[i].x - pt.x, cs[i].y - pt.y) < hr) return i;
    return -1;
  };
  const inside = (r: Rect, pt: { x: number; y: number }) =>
    pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;

  const updateRegion = (id: string, fn: (r: Region) => Region) => {
    p.onRegionsChange(propsRef.current.regions.map((r) => (r.id === id ? fn(r) : r)));
  };

  const paintLine = (region: Region, a: { x: number; y: number }, b: { x: number; y: number }, erase: boolean) => {
    const m = region.mask!;
    const ctx = m.getContext('2d')!;
    const s = m.width / p.vw;
    ctx.save();
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = 'rgb(255,40,40)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, ((p.brushSize / 100) * p.vw) * s);
    ctx.beginPath();
    ctx.moveTo(a.x * s, a.y * s);
    ctx.lineTo(b.x * s + 0.01, b.y * s);
    ctx.stroke();
    ctx.restore();
  };

  // ---- Gesten ----
  const startOne = (cx: number, cy: number) => {
    const pt = toVideo(cx, cy);
    const { regions, selectedId, tool, crop } = propsRef.current;

    if (tool === 'crop') {
      const c = crop ?? { x: 0, y: 0, w: p.vw, h: p.vh };
      const ci = hitCorner(c, pt);
      p.onBeginChange();
      if (ci >= 0) {
        const opp = corners(c)[3 - ci];
        drag.current = { kind: 'crop-resize', corner: ci, anchor: opp };
      } else {
        drag.current = { kind: 'crop-move', dx: pt.x - c.x, dy: pt.y - c.y };
      }
      if (!crop) p.onCropChange(c);
      return;
    }

    if (tool === 'rect') {
      const sel = regions.find((r) => r.id === selectedId && r.kind === 'rect');
      if (sel?.rect) {
        const ci = hitCorner(sel.rect, pt);
        if (ci >= 0) {
          p.onBeginChange();
          drag.current = { kind: 'resize-rect', id: sel.id, corner: ci, anchor: corners(sel.rect)[3 - ci] };
          return;
        }
      }
      const hit = [...regions].reverse().find((r) => r.kind === 'rect' && r.rect && inside(r.rect, pt));
      if (hit?.rect) {
        p.onBeginChange();
        p.onSelect(hit.id);
        drag.current = { kind: 'move-rect', id: hit.id, dx: pt.x - hit.rect.x, dy: pt.y - hit.rect.y };
        return;
      }
      p.onBeginChange();
      const id = uid();
      const n = regions.filter((r) => r.kind === 'rect').length + 1;
      p.onRegionsChange([
        ...regions,
        { id, label: `Rechteck ${n}`, kind: 'rect', rect: { x: pt.x, y: pt.y, w: 0, h: 0 }, start: 0, end: p.duration },
      ]);
      p.onSelect(id);
      drag.current = { kind: 'new-rect', id, x0: pt.x, y0: pt.y };
      return;
    }

    // Pinsel / Radierer
    let target = regions.find((r) => r.id === selectedId && r.kind === 'mask');
    if (!target) {
      if (tool === 'erase') {
        target = [...regions].reverse().find((r) => r.kind === 'mask');
        if (!target) return;
        p.onSelect(target.id);
      } else {
        p.onBeginChange();
        const n = regions.filter((r) => r.kind === 'mask').length + 1;
        target = { id: uid(), label: `Pinsel ${n}`, kind: 'mask', mask: newMaskCanvas(p.vw, p.vh), start: 0, end: p.duration };
        p.onRegionsChange([...regions, target]);
        p.onSelect(target.id);
        paintLine(target, pt, pt, false);
        drag.current = { kind: 'paint', id: target.id, last: pt };
        return;
      }
    }
    p.onBeginChange();
    paintLine(target, pt, pt, tool === 'erase');
    drag.current = { kind: 'paint', id: target.id, last: pt };
    draw();
  };

  const moveOne = (cx: number, cy: number) => {
    const pt = toVideo(cx, cy);
    const d = drag.current;
    const vw = p.vw, vh = p.vh;
    switch (d.kind) {
      case 'new-rect':
        updateRegion(d.id, (r) => ({ ...r, rect: rectFrom({ x: d.x0, y: d.y0 }, pt) }));
        break;
      case 'move-rect':
        updateRegion(d.id, (r) => {
          const rc = r.rect!;
          return { ...r, rect: { ...rc, x: clamp(pt.x - d.dx, 0, vw - rc.w), y: clamp(pt.y - d.dy, 0, vh - rc.h) } };
        });
        break;
      case 'resize-rect':
        updateRegion(d.id, (r) => ({ ...r, rect: rectFrom(d.anchor, pt) }));
        break;
      case 'paint': {
        const r = propsRef.current.regions.find((x) => x.id === d.id);
        if (r) paintLine(r, d.last, pt, propsRef.current.tool === 'erase');
        d.last = pt;
        draw();
        break;
      }
      case 'crop-move': {
        const c = propsRef.current.crop!;
        p.onCropChange({ ...c, x: clamp(pt.x - d.dx, 0, vw - c.w), y: clamp(pt.y - d.dy, 0, vh - c.h) });
        break;
      }
      case 'crop-resize': {
        const r = rectFrom(d.anchor, pt);
        if (r.w > vw * 0.1 && r.h > vh * 0.1) p.onCropChange(r);
        break;
      }
    }
  };

  const endOne = () => {
    const d = drag.current;
    if (d.kind === 'new-rect') {
      const r = propsRef.current.regions.find((x) => x.id === d.id);
      if (r?.rect && (r.rect.w < 6 || r.rect.h < 6)) {
        // nur getippt → kein Rechteck anlegen, Auswahl aufheben
        p.onRegionsChange(propsRef.current.regions.filter((x) => x.id !== d.id));
        p.onSelect(null);
      } else haptic();
    }
    if (d.kind === 'paint') p.onRegionsChange([...propsRef.current.regions]);
    drag.current = { kind: 'none' };
  };

  const clampZoom = (z: { s: number; tx: number; ty: number }) => ({
    s: z.s,
    tx: clamp(z.tx, disp.w - disp.w * z.s, 0),
    ty: clamp(z.ty, disp.h - disp.h * z.s, 0),
  });

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // Zwei Finger: Zoom statt Zeichnen
      if (drag.current.kind !== 'none') endOne();
      const [a, b] = [...pointers.current.values()];
      const sr = stageRef.current!.getBoundingClientRect();
      pinch.current = {
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        c0: { x: (a.x + b.x) / 2 - sr.left, y: (a.y + b.y) / 2 - sr.top },
        z0: zoomRef.current,
      };
    } else if (pointers.current.size === 1) {
      startOne(e.clientX, e.clientY);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const sr = stageRef.current!.getBoundingClientRect();
      const c = { x: (a.x + b.x) / 2 - sr.left, y: (a.y + b.y) / 2 - sr.top };
      const { d0, c0, z0 } = pinch.current;
      const s = clamp((z0.s * Math.hypot(a.x - b.x, a.y - b.y)) / d0, 1, 6);
      const px = (c0.x - z0.tx) / z0.s, py = (c0.y - z0.ty) / z0.s;
      setZoom(clampZoom({ s, tx: c.x - px * s, ty: c.y - py * s }));
    } else if (pointers.current.size === 1) {
      moveOne(e.clientX, e.clientY);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0 && drag.current.kind !== 'none') endOne();
  };

  return (
    <div className="stage-wrap" ref={wrapRef}>
    <div className="stage" ref={stageRef} style={{ width: disp.w, height: disp.h }}>
      <div
        className="zoom"
        style={{
          width: disp.w,
          height: disp.h,
          transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})`,
        }}
      >
        <video
          ref={p.videoRef}
          src={p.src}
          playsInline
          preload="metadata"
          onLoadedData={p.onLoaded}
          style={{ width: disp.w, height: disp.h }}
        />
        <canvas
          ref={canvasRef}
          className="overlay"
          style={{ width: disp.w, height: disp.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      {zoom.s > 1.01 && (
        <button className="zoom-reset" onClick={() => setZoom({ s: 1, tx: 0, ty: 0 })}>
          {Math.round(zoom.s * 100)} % · Zurücksetzen
        </button>
      )}
    </div>
    </div>
  );
}

function corners(r: Rect) {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x, y: r.y + r.h },
    { x: r.x + r.w, y: r.y + r.h },
  ];
}

function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function drawHandles(ctx: CanvasRenderingContext2D, r: Rect, k: number, size: number, color = '#fff') {
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  for (const c of corners(r)) {
    ctx.beginPath();
    ctx.arc(c.x * k, c.y * k, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
