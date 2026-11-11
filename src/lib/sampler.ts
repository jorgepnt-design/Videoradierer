import type { FrameStack } from './detect';

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      // iOS braucht manchmal einen Frame, bis das Bild wirklich gezeichnet ist
      requestAnimationFrame(() => resolve());
    };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

/**
 * Liest gleichmäßig verteilte Frames als Graustufen-Bilder in kleiner Auflösung.
 * Nutzt ein eigenes, unsichtbares Video-Element, damit die Vorschau nicht springt.
 */
export async function sampleFrames(
  src: string,
  count = 24,
  analysisWidth = 160,
  onProgress?: (p: number) => void,
): Promise<FrameStack & { scale: number }> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;
  await new Promise<void>((res, rej) => {
    video.onloadeddata = () => res();
    video.onerror = () => rej(new Error('Video konnte nicht gelesen werden.'));
  });
  // iOS dekodiert erst nach einem kurzen play()
  try {
    await video.play();
    video.pause();
  } catch {
    /* ignorieren */
  }
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = analysisWidth / vw;
  const w = analysisWidth;
  const h = Math.round(vh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frames: Uint8ClampedArray[] = [];
  const dur = video.duration;
  for (let i = 0; i < count; i++) {
    const t = Math.min(dur - 0.05, (dur * (i + 0.5)) / count);
    await seek(video, t);
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const g = new Uint8ClampedArray(w * h);
    for (let p = 0, q = 0; p < g.length; p++, q += 4) {
      g[p] = (data[q] * 77 + data[q + 1] * 150 + data[q + 2] * 29) >> 8;
    }
    frames.push(g);
    onProgress?.((i + 1) / count);
  }
  video.removeAttribute('src');
  video.load();
  return { w, h, frames, scale };
}
