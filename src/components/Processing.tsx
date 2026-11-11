import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../lib/util';

export function Processing({
  stage,
  progress,
  onCancel,
}: {
  stage: 'loading' | 'working';
  progress: number;
  onCancel: () => void;
}) {
  const start = useRef(performance.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (stage === 'working') start.current = performance.now();
  }, [stage]);

  const elapsed = (performance.now() - start.current) / 1000;
  const eta = progress > 0.03 ? (elapsed * (1 - progress)) / progress : null;

  return (
    <div className="processing">
      <div className="spinner" />
      <h2>{stage === 'loading' ? 'Video-Engine wird geladen …' : 'Video wird bearbeitet …'}</h2>
      {stage === 'loading' ? (
        <p className="muted">Beim ersten Mal werden ca. 30 MB geladen, danach geht es schneller.</p>
      ) : (
        <>
          <div className="bar">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="big-num">{Math.round(progress * 100)} %</p>
          <p className="muted">
            {eta != null ? `noch ca. ${formatTime(eta).replace(/\.\d$/, '')} min` : 'Restzeit wird berechnet …'}
          </p>
        </>
      )}
      <p className="muted small">Lass die App geöffnet und den Bildschirm an.</p>
      <button className="btn" onClick={onCancel}>
        Abbrechen
      </button>
    </div>
  );
}
