// Prüft die erzeugten ffmpeg-Befehle mit einem nativen ffmpeg.
// Aufruf: node scripts/test-filters.mjs   (benötigt ffmpeg im PATH, Node >= 22.18)
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { buildArgs } from '../src/lib/buildJob.ts';

const dir = 'test-output';
mkdirSync(dir, { recursive: true });
process.chdir(dir);

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const probe = (file) =>
  JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file]).toString(),
  );

const W = 540, H = 960, D = 4;

// Testvideo im Stil einer Reel-Bildschirmaufnahme: bewegtes Bild, Symbole rechts, schwarzer Balken unten
if (!existsSync('sample.mp4')) {
  ff([
    // bewegter Hintergrund (wie eine Kamerafahrt)
    '-f', 'lavfi', '-i', `testsrc2=size=${W * 2}x${H}:rate=30:duration=${D}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${D}`,
    '-filter_complex',
    `[0:v]crop=${W}:${H - 80}:x='t*60':y='t*15',pad=${W}:${H}:0:0:black,` +
      `drawbox=x=460:y=500:w=60:h=60:color=white@1:t=fill,` +
      `drawbox=x=460:y=640:w=60:h=60:color=white@1:t=6,` +
      `drawbox=x=460:y=780:w=60:h=40:color=white@1:t=fill[v]`,
    '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', 'sample.mp4',
  ]);
}

// Masken: Symbol-Spalte (ganzes Video) und ein kleiner Bereich (nur 1–2 s)
ff(['-f', 'lavfi', '-i', `color=black:s=${W}x${H}`, '-vf', 'drawbox=x=450:y=490:w=80:h=340:color=white:t=fill', '-frames:v', '1', '-y', 'mask0.png']);
ff(['-f', 'lavfi', '-i', `color=black:s=${W}x${H}`, '-vf', 'drawbox=x=40:y=40:w=100:h=60:color=white:t=fill', '-frames:v', '1', '-y', 'mask1.png']);

const masks = [
  // Symbol-Spalte reicht bis an den rechten Rand → muss für delogo begrenzt werden
  { file: 'mask0.png', boxes: [{ x: 450, y: 490, w: 90, h: 340 }], start: 0, end: D },
  { file: 'mask1.png', boxes: [{ x: 0, y: 0, w: 140, h: 100 }, { x: 200, y: 900, w: 340, h: 60 }], start: 1, end: 2 },
];

const cases = [
  ['remove', { method: 'remove', crop: null, fit: 'none', quality: 'original' }, masks, W, H],
  ['blur', { method: 'blur', crop: null, fit: 'none', quality: 'original' }, masks, W, H],
  ['crop', { method: 'remove', crop: { x: 0, y: 0, w: 450, h: 880 }, fit: 'none', quality: 'original' }, [], 450, 880],
  ['crop-916', { method: 'remove', crop: { x: 0, y: 0, w: 450, h: 880 }, fit: 'blur916', quality: 'original' }, [], 494, 880],
  ['all-720p', { method: 'blur', crop: { x: 1, y: 3, w: 451, h: 877 }, fit: 'blur916', quality: '720p' }, masks, null, null],
];

// Hochauflösendes Video: Arbeitsgröße muss auf 1080p (kürzere Seite) verkleinert werden
const BW = 1440, BH = 2560;
if (!existsSync('big.mp4')) {
  ff(['-f', 'lavfi', '-i', `testsrc2=size=${BW}x${BH}:rate=30:duration=1`, '-f', 'lavfi', '-i', 'sine=duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', 'big.mp4']);
}
const bigMasks = [{ boxes: [{ x: 1300, y: 1200, w: 140, h: 900 }], start: 0, end: 1 }];
let failed = 0;
for (const [quality, ew, eh] of [['original', 1080, 1920], ['720p', 720, 1280]]) {
  for (const crop of [null, { x: 0, y: 0, w: 1280, h: 2400 }]) {
    const out = `out-big-${quality}-${crop ? 'crop' : 'full'}.mp4`;
    const args = buildArgs({ input: 'big.mp4', output: out, width: BW, height: BH, duration: 1, masks: bigMasks,
      settings: { method: 'remove', crop, fit: 'none', quality }, copyAudio: true });
    try {
      ff(args);
      const v = probe(out).streams.find((s) => s.codec_type === 'video');
      const f = ew / BW;
      const w = crop ? Math.floor((1280 * f) / 2) * 2 : ew, h = crop ? Math.floor((2400 * f) / 2) * 2 : eh;
      const ok = v.width === w && v.height === h;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${out}: ${v.width}x${v.height} (erwartet ${w}x${h})`);
      if (!ok) failed++;
    } catch (e) {
      failed++;
      console.log(`FAIL ${out}: ${e.message}`);
    }
  }
}

for (const [name, settings, m, ew, eh] of cases) {
  for (const copyAudio of [true, false]) {
    const out = `out-${name}-${copyAudio ? 'copy' : 'aac'}.mp4`;
    const args = buildArgs({ input: 'sample.mp4', output: out, width: W, height: H, duration: D, masks: m, settings, copyAudio });
    try {
      ff(args);
      const p = probe(out);
      const v = p.streams.find((s) => s.codec_type === 'video');
      const a = p.streams.find((s) => s.codec_type === 'audio');
      const dur = Number(p.format.duration);
      const ok = v && a && Math.abs(dur - D) < 0.2 && (ew == null || (v.width === ew && v.height === eh)) && v.width % 2 === 0 && v.height % 2 === 0;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${out}: ${v?.width}x${v?.height}, ${dur.toFixed(2)}s, audio=${!!a}`);
      if (!ok) failed++;
    } catch (e) {
      failed++;
      console.log(`FAIL ${out}: ${e.message}\n  ${args.join(' ')}`);
    }
  }
}
process.exit(failed ? 1 : 0);
