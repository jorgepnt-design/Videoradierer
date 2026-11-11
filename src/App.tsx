import { useCallback, useEffect, useRef, useState } from 'react';
import { Editor, type Tool } from './components/Editor';
import { Picker } from './components/Picker';
import { LegalNotice } from './components/LegalNotice';
import { Processing } from './components/Processing';
import { Result } from './components/Result';
import type { ExportSettings, Rect, Region } from './lib/types';
import { cloneCanvas, maskFromDetection, regionBounds } from './lib/masks';
import { detectBars, detectStaticOverlays, suggestCrop } from './lib/detect';
import { sampleFrames } from './lib/sampler';
import { cancelFFmpeg, exportVideo, loadFFmpeg } from './lib/ffmpeg';
import { PRESETS } from './lib/presets';
import { clamp, formatBytes, formatTime, friendlyError, haptic, uid } from './lib/util';

type Screen = 'pick' | 'edit' | 'process' | 'result';
interface Snapshot {
  regions: Region[];
  crop: Rect | null;
}
interface Meta {
  w: number;
  h: number;
  duration: number;
}

// ---------- Absturz-Erkennung ----------
// iOS beendet eine Seite ohne Fehlermeldung, wenn der Speicher knapp wird, und lädt sie neu.
// Wir merken uns den laufenden Schritt; steht er nach dem Neuladen noch da, war es ein Absturz.
const STEP_KEY = 'videoradierer.step';
function markStep(step: string | null) {
  try {
    if (step) sessionStorage.setItem(STEP_KEY, step);
    else sessionStorage.removeItem(STEP_KEY);
  } catch {
    /* privater Modus */
  }
}
function crashMessage(): string | null {
  let step: string | null = null;
  try {
    step = sessionStorage.getItem(STEP_KEY);
    sessionStorage.removeItem(STEP_KEY);
  } catch {
    return null;
  }
  if (!step) return null;
  return (
    `Die App wurde beim ${step === 'öffnen' ? 'Öffnen des Videos' : step === 'analysieren' ? 'Analysieren' : 'Exportieren'} ` +
    'von iOS beendet – vermutlich war der Speicher zu knapp. Tipps: andere Apps und Safari-Tabs schließen, ' +
    'ein kürzeres Video nehmen oder beim Export „Schnell (720p)“ wählen.'
  );
}

const cloneRegions = (rs: Region[]) =>
  rs.map((r) => ({ ...r, rect: r.rect && { ...r.rect }, mask: r.mask && cloneCanvas(r.mask) }));

export default function App() {
  const [screen, setScreen] = useState<Screen>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(crashMessage);
  const [notice, setNotice] = useState<string | null>(null);

  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [tool, setTool] = useState<Tool>('rect');
  const [brushSize, setBrushSize] = useState(7);
  const [version, setVersion] = useState(0);
  const [settings, setSettings] = useState<ExportSettings>({ method: 'remove', crop: null, fit: 'none', quality: 'original' });
  const [cropOn, setCropOn] = useState(false);
  const [suggestedCrop, setSuggestedCrop] = useState<Rect | null>(null);
  const [detecting, setDetecting] = useState<number | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  const [undoStack, setUndo] = useState<Snapshot[]>([]);
  const [redoStack, setRedo] = useState<Snapshot[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [proc, setProc] = useState<{ stage: 'loading' | 'working'; progress: number }>({ stage: 'loading', progress: 0 });
  const [result, setResult] = useState<Blob | null>(null);
  const cancelled = useRef(false);

  // ---------- Video laden ----------
  const pick = async (f: File) => {
    setError(null);
    markStep('öffnen');
    const u = URL.createObjectURL(f);
    try {
      const m = await new Promise<Meta>((res, rej) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.playsInline = true;
        v.muted = true;
        const done = () => {
          v.removeAttribute('src');
          v.load(); // Dekoder sofort wieder freigeben
        };
        v.onloadedmetadata = () => {
          const m = { w: v.videoWidth, h: v.videoHeight, duration: v.duration };
          done();
          res(m);
        };
        v.onerror = () => {
          done();
          rej(new Error('Dieses Video kann nicht geöffnet werden.'));
        };
        v.src = u;
      });
      if (!m.w || !m.h || !isFinite(m.duration)) throw new Error('Dieses Video kann nicht geöffnet werden.');
      if (url) URL.revokeObjectURL(url);
      setFile(f);
      setUrl(u);
      setMeta(m);
      setRegions([]);
      setCrop(null);
      setCropOn(false);
      setSuggestedCrop(null);
      setUndo([]);
      setRedo([]);
      setSelectedId(null);
      setTime(0);
      setResult(null);
      setScreen('edit');
      const warn: string[] = [];
      if (m.duration > 60) warn.push(`Das Video ist ${Math.round(m.duration)} s lang – die Bearbeitung kann einige Minuten dauern.`);
      if (f.size > 200e6) warn.push(`Die Datei ist ${formatBytes(f.size)} groß – auf dem iPhone kann der Speicher knapp werden. Tipp: „Schnell (720p)“.`);
      if (Math.min(m.w, m.h) > 1080) warn.push('4K-Video: wird beim Export auf 1080p verkleinert, damit das iPhone genug Speicher hat.');
      setNotice(warn.length ? warn.join(' ') : null);
      // Die Video-Engine wird bewusst NICHT schon hier geladen: zusammen mit dem
      // Dekodieren des Videos wird der Speicher auf dem iPhone sonst zu knapp.
    } catch (e) {
      URL.revokeObjectURL(u);
      setError(friendlyError(e));
    } finally {
      markStep(null);
    }
  };

  // ---------- Undo/Redo ----------
  const snapshot = useCallback((): Snapshot => ({ regions: cloneRegions(regions), crop: crop && { ...crop } }), [regions, crop]);
  const beginChange = useCallback(() => {
    // Schnappschuss sofort anlegen – danach wird ggf. direkt in die Maske gemalt
    const snap = snapshot();
    setUndo((u) => [...u.slice(-29), snap]);
    setRedo([]);
  }, [snapshot]);
  const restore = (s: Snapshot) => {
    setRegions(s.regions);
    setCrop(s.crop);
    if (!s.regions.find((r) => r.id === selectedId)) setSelectedId(null);
    setVersion((v) => v + 1);
  };
  const undo = () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    const snap = snapshot();
    setRedo((r) => [...r, snap]);
    setUndo((u) => u.slice(0, -1));
    restore(last);
    haptic();
  };
  const redo = () => {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    const snap = snapshot();
    setUndo((u) => [...u, snap]);
    setRedo((r) => r.slice(0, -1));
    restore(last);
    haptic();
  };

  // ---------- Zeitleiste ----------
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const loop = () => {
      if (videoRef.current) setTime(videoRef.current.currentTime);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setPlaying(true)).catch(() => {});
      v.onpause = () => setPlaying(false);
      v.onended = () => setPlaying(false);
    } else v.pause();
  };
  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setTime(t);
  };

  const selected = regions.find((r) => r.id === selectedId) ?? null;
  const updateSelected = (patch: Partial<Region>) => {
    if (!selected) return;
    beginChange();
    setRegions(regions.map((r) => (r.id === selected.id ? { ...r, ...patch } : r)));
  };

  // ---------- Automatische Erkennung ----------
  const autoDetect = async () => {
    if (!url || !meta) return;
    setDetecting(0);
    markStep('analysieren');
    try {
      const stack = await sampleFrames(url, 24, 160, (p) => setDetecting(p));
      const s = stack.scale;
      const bars = detectBars(stack);
      const det = detectStaticOverlays(stack, bars);
      const barsV: Rect = { x: bars.x / s, y: bars.y / s, w: bars.w / s, h: bars.h / s };
      const hasBars = barsV.w < meta.w * 0.98 || barsV.h < meta.h * 0.98;

      beginChange();
      let next = regions;
      if (det.boxes.length) {
        const region: Region = {
          id: uid(),
          label: `Automatisch (${det.boxes.length})`,
          kind: 'mask',
          mask: maskFromDetection(det, meta.w, meta.h),
          start: 0,
          end: meta.duration,
        };
        next = [...regions, region];
        setRegions(next);
        setSelectedId(region.id);
        setTool('brush');
      }
      const boxesV = det.boxes.map((b) => ({ x: b.x / s, y: b.y / s, w: b.w / s, h: b.h / s }));
      const otherBoxes = next
        .filter((r) => !r.label.startsWith('Automatisch'))
        .map((r) => regionBounds(r, meta.w, meta.h))
        .filter((b): b is Rect => !!b);
      setSuggestedCrop(suggestCrop(barsV, [...boxesV, ...otherBoxes], 6));

      const parts: string[] = [];
      parts.push(det.boxes.length ? `${det.boxes.length} Symbol${det.boxes.length > 1 ? 'e' : ''} gefunden` : 'Keine Symbole gefunden');
      if (hasBars) parts.push('schwarzer Rand erkannt');
      setNotice(
        parts.join(', ') +
          '. ' +
          (det.boxes.length
            ? 'Mit Pinsel/Radierer kannst du die Markierung korrigieren.'
            : 'Markiere die Stellen von Hand oder nutze eine Vorlage.') +
          (hasBars || det.boxes.length ? ' Tipp: „Zuschneiden“ entfernt Randbereiche ganz ohne Spuren.' : ''),
      );
      haptic(15);
    } catch (e) {
      setNotice(friendlyError(e));
    } finally {
      setDetecting(null);
      markStep(null);
    }
  };

  const applyPreset = (id: string) => {
    if (!meta) return;
    const p = PRESETS.find((x) => x.id === id)!;
    beginChange();
    const add: Region[] = p.areas.map((a) => ({
      id: uid(),
      label: a.label,
      kind: 'rect',
      rect: { x: a.rect.x * meta.w, y: a.rect.y * meta.h, w: a.rect.w * meta.w, h: a.rect.h * meta.h },
      start: 0,
      end: meta.duration,
    }));
    setRegions([...regions, ...add]);
    setSelectedId(add[0].id);
    setTool('rect');
    setShowPresets(false);
    setNotice(`Vorlage „${p.name}“ eingefügt. Ziehe die Rechtecke an die richtige Stelle.`);
  };

  // ---------- Zuschnitt ----------
  const currentSuggestion = (): Rect => {
    if (!meta) return { x: 0, y: 0, w: 1, h: 1 };
    const base = suggestedCrop ?? { x: 0, y: 0, w: meta.w, h: meta.h };
    const boxes = regions.map((r) => regionBounds(r, meta.w, meta.h)).filter((b): b is Rect => !!b);
    return suggestCrop(base, boxes, 6);
  };
  const toggleCrop = (on: boolean) => {
    beginChange();
    setCropOn(on);
    if (on && !crop) setCrop(currentSuggestion());
    if (on) setTool('crop');
    else if (tool === 'crop') setTool('rect');
  };

  // ---------- Export ----------
  const canExport = !!meta && (regions.length > 0 || (cropOn && !!crop));
  const startExport = async () => {
    if (!file || !meta) return;
    cancelled.current = false;
    videoRef.current?.pause();
    setScreen('process');
    setProc({ stage: 'loading', progress: 0 });
    let lock: { release: () => Promise<void> } | null = null;
    try {
      lock = await (navigator as any).wakeLock?.request('screen');
    } catch {
      /* nicht verfügbar */
    }
    markStep('exportieren');
    try {
      await loadFFmpeg();
      if (cancelled.current) return;
      setProc({ stage: 'working', progress: 0 });
      const blob = await exportVideo({
        file,
        width: meta.w,
        height: meta.h,
        duration: meta.duration,
        regions,
        settings: { ...settings, crop: cropOn ? crop : null },
        onProgress: (p) => setProc({ stage: 'working', progress: clamp(p, 0, 1) }),
      });
      if (cancelled.current) return;
      setResult(blob);
      setScreen('result');
      haptic(20);
    } catch (e) {
      if (cancelled.current) return;
      setNotice(friendlyError(e));
      setScreen('edit');
    } finally {
      markStep(null);
      lock?.release().catch(() => {});
    }
  };
  const cancelExport = () => {
    cancelled.current = true;
    cancelFFmpeg();
    setScreen('edit');
    setNotice('Abgebrochen.');
  };

  // ---------- Ansichten ----------
  if (screen === 'pick' || !meta || !url || !file) {
    return (
      <>
        <LegalNotice />
        <Picker onPick={pick} error={error} />
      </>
    );
  }

  if (screen === 'process') return <Processing stage={proc.stage} progress={proc.progress} onCancel={cancelExport} />;

  if (screen === 'result' && result) {
    const outSize = !(cropOn && crop) && settings.fit === 'none' && settings.quality === 'original';
    return (
      <Result
        originalUrl={url}
        result={result}
        fileName={file.name}
        sameSize={outSize}
        onBack={() => setScreen('edit')}
        onNew={() => {
          setScreen('pick');
          setResult(null);
        }}
      />
    );
  }

  return (
    <div className="editor">
      <LegalNotice />
      <header className="topbar">
        <button className="link" onClick={() => setScreen('pick')}>‹ Neu</button>
        <span className="title">{file.name}</span>
        <div className="undo">
          <button className="icon" disabled={!undoStack.length} onClick={undo} aria-label="Rückgängig">↶</button>
          <button className="icon" disabled={!redoStack.length} onClick={redo} aria-label="Wiederholen">↷</button>
        </div>
      </header>

      <Editor
        src={url}
        vw={meta.w}
        vh={meta.h}
        duration={meta.duration}
        videoRef={videoRef}
        regions={regions}
        selectedId={selectedId}
        crop={crop}
        showCrop={cropOn}
        tool={tool}
        brushSize={brushSize}
        currentTime={time}
        version={version}
        onSelect={setSelectedId}
        onBeginChange={beginChange}
        onRegionsChange={(r) => {
          setRegions(r);
          setVersion((v) => v + 1);
        }}
        onCropChange={setCrop}
        onLoaded={() => setTime(videoRef.current?.currentTime ?? 0)}
      />

      <div className="timeline">
        <button className="icon play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Abspielen'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="track">
          {selected && (
            <div
              className="span"
              style={{
                left: `${(selected.start / meta.duration) * 100}%`,
                width: `${((selected.end - selected.start) / meta.duration) * 100}%`,
              }}
            />
          )}
          <input
            type="range"
            min={0}
            max={meta.duration}
            step={0.01}
            value={time}
            onChange={(e) => seek(+e.target.value)}
            aria-label="Zeit"
          />
        </div>
        <span className="time">{formatTime(time)}</span>
      </div>

      {notice && (
        <div className="notice" onClick={() => setNotice(null)}>
          {notice} <span className="x">✕</span>
        </div>
      )}

      <div className="tools">
        <button className={tool === 'rect' ? 'on' : ''} onClick={() => setTool('rect')}>
          <span>▭</span>Rechteck
        </button>
        <button className={tool === 'brush' ? 'on' : ''} onClick={() => setTool('brush')}>
          <span>✎</span>Pinsel
        </button>
        <button className={tool === 'erase' ? 'on' : ''} onClick={() => setTool('erase')}>
          <span>⌫</span>Radierer
        </button>
        <button className={tool === 'crop' ? 'on' : ''} onClick={() => (cropOn ? setTool('crop') : toggleCrop(true))}>
          <span>⛶</span>Zuschnitt
        </button>
      </div>

      {(tool === 'brush' || tool === 'erase') && (
        <label className="slider-row">
          <span>Pinselgröße</span>
          <input type="range" min={1} max={15} step={0.5} value={brushSize} onChange={(e) => setBrushSize(+e.target.value)} />
        </label>
      )}
      <p className="hint">
        {tool === 'rect' && 'Rechteck aufziehen. Antippen zum Auswählen, an den Ecken ziehen zum Ändern.'}
        {tool === 'brush' && 'Über die Stellen malen, die verschwinden sollen.'}
        {tool === 'erase' && 'Zu viel markiert? Hier wegradieren.'}
        {tool === 'crop' && 'Gelben Rahmen verschieben oder an den Ecken ziehen.'} Zwei Finger: zoomen.
      </p>

      <div className="quick">
        <button className="btn accent" onClick={autoDetect} disabled={detecting != null}>
          {detecting != null ? `Analysiere … ${Math.round(detecting * 100)} %` : '✨ Symbole automatisch finden'}
        </button>
        <button className="btn" onClick={() => setShowPresets((s) => !s)}>
          Vorlagen
        </button>
      </div>
      {showPresets && (
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.id} className="chip" onClick={() => applyPreset(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {regions.length > 0 && (
        <section className="card">
          <h3>Markierte Bereiche</h3>
          <div className="chips">
            {regions.map((r) => (
              <button
                key={r.id}
                className={`chip ${r.id === selectedId ? 'on' : ''}`}
                onClick={() => {
                  setSelectedId(r.id);
                  setTool(r.kind === 'rect' ? 'rect' : 'brush');
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          {selected && (
            <div className="region-edit">
              <div className="row between">
                <span className="muted small">
                  Sichtbar von {formatTime(selected.start)} bis {formatTime(selected.end)}
                </span>
                <button
                  className="link danger"
                  onClick={() => {
                    beginChange();
                    setRegions(regions.filter((r) => r.id !== selected.id));
                    setSelectedId(null);
                  }}
                >
                  Löschen
                </button>
              </div>
              <div className="row wrap">
                <button className="btn small" onClick={() => updateSelected({ start: Math.min(time, selected.end - 0.05) })}>
                  Start = jetzt
                </button>
                <button className="btn small" onClick={() => updateSelected({ end: Math.max(time, selected.start + 0.05) })}>
                  Ende = jetzt
                </button>
                <button className="btn small" onClick={() => updateSelected({ start: 0, end: meta.duration })}>
                  Ganzes Video
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h3>Wie sollen die Stellen verschwinden?</h3>
        <div className="seg">
          <button className={settings.method === 'remove' ? 'on' : ''} onClick={() => setSettings({ ...settings, method: 'remove' })}>
            Entfernen
          </button>
          <button className={settings.method === 'blur' ? 'on' : ''} onClick={() => setSettings({ ...settings, method: 'blur' })}>
            Weichzeichnen
          </button>
        </div>
        <p className="muted small">
          {settings.method === 'remove'
            ? 'Füllt die Stelle mit den umliegenden Farben auf. Ideal für kleine Symbole auf ruhigem Hintergrund.'
            : 'Verwischt die Stelle stark. Unauffällig bei bewegtem Hintergrund.'}
        </p>

        <label className="toggle">
          <input type="checkbox" checked={cropOn} onChange={(e) => toggleCrop(e.target.checked)} />
          <span>
            <b>Zuschneiden</b>
            <small>Ränder mit Symbolen oder schwarzen Balken wegschneiden – sauberste Lösung, keine Spuren.</small>
          </span>
        </label>
        {cropOn && (
          <>
            <div className="row wrap">
              <button
                className="btn small"
                onClick={() => {
                  beginChange();
                  setCrop(currentSuggestion());
                  setTool('crop');
                }}
              >
                Vorschlag übernehmen
              </button>
              <button
                className="btn small"
                onClick={() => {
                  beginChange();
                  setCrop({ x: 0, y: 0, w: meta.w, h: meta.h });
                }}
              >
                Zurücksetzen
              </button>
            </div>
            <div className="seg">
              <button className={settings.fit === 'none' ? 'on' : ''} onClick={() => setSettings({ ...settings, fit: 'none' })}>
                Format wie Zuschnitt
              </button>
              <button className={settings.fit === 'blur916' ? 'on' : ''} onClick={() => setSettings({ ...settings, fit: 'blur916' })}>
                9:16 (Reel)
              </button>
            </div>
            {settings.fit === 'blur916' && <p className="muted small">Fehlende Fläche wird mit einem unscharfen Hintergrund gefüllt.</p>}
          </>
        )}

        <h3>Qualität</h3>
        <div className="seg">
          <button className={settings.quality === 'original' ? 'on' : ''} onClick={() => setSettings({ ...settings, quality: 'original' })}>
            {Math.min(meta.w, meta.h) > 1080 ? 'Hoch (1080p)' : `Original (${Math.min(meta.w, meta.h)}p)`}
          </button>
          <button className={settings.quality === '720p' ? 'on' : ''} onClick={() => setSettings({ ...settings, quality: '720p' })}>
            Schnell (720p)
          </button>
        </div>
      </section>

      <div className="export-bar">
        <button className="btn primary big" disabled={!canExport} onClick={startExport}>
          Video exportieren
        </button>
        {!canExport && <p className="muted small center">Markiere zuerst eine Stelle oder aktiviere „Zuschneiden“.</p>}
        <p className="muted small center">🔒 Die Bearbeitung läuft komplett auf deinem Gerät.</p>
      </div>
    </div>
  );
}
