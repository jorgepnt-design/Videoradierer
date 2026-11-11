import { useRef } from 'react';

interface Props {
  onPick: (f: File) => void;
  /** Wird vor dem Öffnen der iOS-Auswahl aufgerufen (für die Absturz-Erkennung) */
  onPickStart: () => void;
  onPickEnd: () => void;
  error: string | null;
}

export function Picker({ onPick, onPickStart, onPickEnd, error }: Props) {
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  const open = (el: HTMLInputElement | null) => {
    if (!el) return;
    onPickStart();
    // Wird die Auswahl abgebrochen, kommt kein change-Ereignis → "cancel" bzw. Fokus-Rückkehr
    const end = () => {
      window.removeEventListener('focus', end);
      setTimeout(() => {
        if (!el.files?.length) onPickEnd();
      }, 1500);
    };
    el.addEventListener('cancel', onPickEnd, { once: true });
    window.addEventListener('focus', end);
    el.click();
  };

  const input = (ref: React.RefObject<HTMLInputElement>, accept: string) => (
    <input
      ref={ref}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onPick(f);
        else onPickEnd();
        e.target.value = '';
      }}
    />
  );

  return (
    <div className="picker">
      <div className="logo" aria-hidden>
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} width={84} height={84} alt="" />
      </div>
      <h1>Videoradierer</h1>
      <p className="muted">
        Entferne Symbole, Logos, Zahlen und Einblendungen aus deinen Videos – direkt auf dem iPhone.
      </p>
      <button className="btn primary big" onClick={() => open(photos.current)}>
        Video auswählen
      </button>
      <button className="btn big" onClick={() => open(files.current)}>
        Aus der Dateien-App wählen
      </button>
      {input(photos, 'video/*')}
      {input(files, '.mov,.mp4,.m4v,video/quicktime,video/mp4')}
      {error && <p className="error">{error}</p>}
      <details className="help">
        <summary>Absturz beim Hochladen?</summary>
        <ul>
          <li>
            Aus der <b>Fotomediathek</b> wandelt iOS das Video beim Auswählen oft komplett um – das braucht viel
            Speicher. Falls in der Auswahl oben <b>„Optionen“</b> erscheint, dort <b>„Aktuell“</b> wählen.
          </li>
          <li>
            Sicherer: Video in der Fotos-App über <b>Teilen → „In Dateien sichern“</b> speichern und hier
            <b> „Aus der Dateien-App wählen“</b> nehmen. Dann wird nichts umgewandelt.
          </li>
          <li>Andere Apps und Safari-Tabs schließen. Lange Videos vorher in der Fotos-App kürzen.</li>
          <li>Klappt es vom Home-Bildschirm nicht, die Seite einmal direkt in Safari öffnen.</li>
        </ul>
      </details>
      <ul className="features">
        <li>🔒 Dein Video verlässt dein Gerät nicht.</li>
        <li>✨ Symbole in Bildschirmaufnahmen automatisch finden</li>
        <li>✂️ Ränder und schwarze Balken sauber wegschneiden</li>
      </ul>
    </div>
  );
}
