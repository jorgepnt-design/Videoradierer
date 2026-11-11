import { useRef } from 'react';

export function Picker({ onPick, error }: { onPick: (f: File) => void; error: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="picker">
      <div className="logo" aria-hidden>
        <svg viewBox="0 0 64 64" width="72" height="72">
          <rect x="4" y="12" width="56" height="40" rx="10" fill="#1c1c1e" stroke="#3a3a3c" strokeWidth="2" />
          <path d="M26 24v16l13-8z" fill="#fff" />
          <rect x="40" y="6" width="20" height="26" rx="4" transform="rotate(35 50 19)" fill="#ff375f" />
          <rect x="40" y="25" width="20" height="7" rx="2" transform="rotate(35 50 19)" fill="#ffd1dc" />
        </svg>
      </div>
      <h1>Videoradierer</h1>
      <p className="muted">
        Entferne Symbole, Logos, Zahlen und Einblendungen aus deinen Videos – direkt auf dem iPhone.
      </p>
      <button className="btn primary big" onClick={() => input.current?.click()}>
        Video auswählen
      </button>
      <input
        ref={input}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      {error && <p className="error">{error}</p>}
      <ul className="features">
        <li>🔒 Dein Video verlässt dein Gerät nicht.</li>
        <li>✨ Symbole in Bildschirmaufnahmen automatisch finden</li>
        <li>✂️ Ränder und schwarze Balken sauber wegschneiden</li>
      </ul>
    </div>
  );
}
