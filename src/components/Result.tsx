import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../lib/util';

interface Props {
  originalUrl: string;
  result: Blob;
  fileName: string;
  sameSize: boolean;
  onBack: () => void;
  onNew: () => void;
}

export function Result({ originalUrl, result, fileName, sameSize, onBack, onNew }: Props) {
  const [url] = useState(() => URL.createObjectURL(result));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const after = useRef<HTMLVideoElement>(null);
  const before = useRef<HTMLVideoElement>(null);
  const [split, setSplit] = useState(50);
  const [view, setView] = useState<'after' | 'before'>('after');
  const [msg, setMsg] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  // Vorher-Video mit dem Nachher-Video synchron halten
  useEffect(() => {
    const a = after.current, b = before.current;
    if (!a || !b) return;
    const sync = () => {
      if (Math.abs(b.currentTime - a.currentTime) > 0.15) b.currentTime = a.currentTime;
    };
    const play = () => b.play().catch(() => {});
    const pause = () => b.pause();
    a.addEventListener('timeupdate', sync);
    a.addEventListener('seeked', sync);
    a.addEventListener('play', play);
    a.addEventListener('pause', pause);
    return () => {
      a.removeEventListener('timeupdate', sync);
      a.removeEventListener('seeked', sync);
      a.removeEventListener('play', play);
      a.removeEventListener('pause', pause);
    };
  }, [sameSize]);

  const outName = fileName.replace(/\.[^.]+$/, '') + '-radiert.mp4';

  const share = async () => {
    const file = new File([result], outName, { type: 'video/mp4' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Videoradierer' });
        return;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    download();
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setMsg('Download gestartet. Auf dem iPhone findest du das Video in der Dateien-App unter „Downloads“.');
  };

  return (
    <div className="result">
      <h2>Fertig ✨</h2>
      {sameSize ? (
        <div className="compare">
          <video
            ref={after}
            src={url}
            playsInline
            loop
            className="cmp-after"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <video
            ref={before}
            src={originalUrl}
            playsInline
            muted
            className="cmp-before"
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
          <div className="cmp-line" style={{ left: `${split}%` }} />
          <span className="cmp-label left">Vorher</span>
          <span className="cmp-label right">Nachher</span>
          <button
            className="cmp-play"
            aria-label={playing ? 'Pause' : 'Abspielen'}
            onClick={() => (playing ? after.current?.pause() : after.current?.play())}
          >
            {playing ? '❚❚' : '▶'}
          </button>
        </div>
      ) : (
        <>
          <div className="seg">
            <button className={view === 'before' ? 'on' : ''} onClick={() => setView('before')}>Vorher</button>
            <button className={view === 'after' ? 'on' : ''} onClick={() => setView('after')}>Nachher</button>
          </div>
          <div className="single">
            <video ref={after} src={url} playsInline controls style={{ display: view === 'after' ? 'block' : 'none' }} />
            <video ref={before} src={originalUrl} playsInline controls style={{ display: view === 'before' ? 'block' : 'none' }} />
          </div>
        </>
      )}
      {sameSize && (
        <label className="slider-row">
          <span>Vorher/Nachher</span>
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(+e.target.value)} />
        </label>
      )}
      <p className="muted small">MP4 · {formatBytes(result.size)}</p>
      <button className="btn primary big" onClick={share}>
        In Fotos sichern / Teilen
      </button>
      <p className="muted small">Im Teilen-Menü auf „Video sichern“ tippen.</p>
      {msg && <p className="muted small">{msg}</p>}
      <div className="row">
        <button className="btn" onClick={onBack}>
          Weiter bearbeiten
        </button>
        <button className="btn" onClick={onNew}>
          Neues Video
        </button>
      </div>
    </div>
  );
}
