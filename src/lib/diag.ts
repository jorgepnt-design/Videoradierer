// Diagnose-Protokoll: überlebt ein Neuladen der Seite (sessionStorage), damit man nach einem
// Absturz sieht, bis zu welchem Schritt die App gekommen ist und welche Fehler auftraten.
const KEY = 'videoradierer.diag';
const MAX = 30;

function read(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function diag(msg: string) {
  const t = new Date().toLocaleTimeString('de-DE');
  const lines = [...read(), `${t} ${msg}`].slice(-MAX);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* privater Modus */
  }
}

export function diagLines(): string[] {
  return read();
}

export function diagClear() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignorieren */
  }
}

export function deviceInfo(): string {
  const n = navigator as Navigator & { deviceMemory?: number };
  const standalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return [
    navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''),
    `Bildschirm ${screen.width}×${screen.height} @${window.devicePixelRatio}x`,
    standalone ? 'Home-Bildschirm' : 'Browser',
    n.deviceMemory ? `${n.deviceMemory} GB` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Alle unbehandelten Fehler mitschreiben */
export function installErrorCapture(onError: (msg: string) => void) {
  window.addEventListener('error', (e) => {
    const msg = `FEHLER: ${e.message} ${e.filename ? `(${e.filename.split('/').pop()}:${e.lineno})` : ''}`;
    diag(msg);
    onError(msg);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | string;
    const msg = `FEHLER (async): ${r instanceof Error ? r.message : String(r)}`;
    diag(msg);
    onError(msg);
  });
}
