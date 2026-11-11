// Prüft die Overlay-Erkennung an Frames aus test-output/sample.mp4
import { execFileSync } from 'node:child_process';
import { detectStaticOverlays, detectBars, suggestCrop } from '../src/lib/detect.ts';
const w = 160, h = 284, n = 20;
const buf = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', 'test-output/sample.mp4', '-vf', `fps=${n / 4},scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-']);
const frames = [];
for (let i = 0; i + w * h <= buf.length; i += w * h) frames.push(new Uint8ClampedArray(buf.subarray(i, i + w * h)));
const bars = detectBars({ w, h, frames });
const det = detectStaticOverlays({ w, h, frames }, bars);
console.log('frames', frames.length, 'bars', bars);
console.log('boxes', det.boxes);
console.log('crop', suggestCrop(bars, det.boxes));
