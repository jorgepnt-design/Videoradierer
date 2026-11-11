import { useState } from 'react';

const KEY = 'videoradierer.legal.v1';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function LegalNotice() {
  const [ok, setOk] = useState(read);
  if (ok) return null;
  return (
    <div className="modal-bg">
      <div className="modal">
        <h2>Kurzer Hinweis</h2>
        <p>
          Bearbeite nur Videos, an denen du die Rechte hast. Das Entfernen von Wasserzeichen oder
          Kennzeichnungen aus fremden Inhalten kann Urheberrechte verletzen.
        </p>
        <button
          className="btn primary"
          onClick={() => {
            try {
              localStorage.setItem(KEY, '1');
            } catch {
              /* privater Modus */
            }
            setOk(true);
          }}
        >
          Verstanden
        </button>
      </div>
    </div>
  );
}
