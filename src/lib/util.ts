export const uid = () => Math.random().toString(36).slice(2, 10);

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function formatTime(t: number): string {
  if (!isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function formatBytes(b: number): string {
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(b / 1e3))} KB`;
}

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* iOS unterstützt das nicht */
  }
}

/** Verständliche deutsche Fehlermeldung */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/memory|OOM|allocation|RangeError/i.test(msg))
    return 'Zu wenig Speicher. Wähle „Schnell (720p)“ oder kürze das Video.';
  if (/Invalid data|could not find codec|Unknown format|moov atom/i.test(msg))
    return 'Dieses Videoformat wird nicht unterstützt. Probiere ein MP4- oder MOV-Video vom iPhone.';
  if (/terminate|abgebrochen/i.test(msg)) return 'Abgebrochen.';
  if (/fetch|network|Failed to load|import/i.test(msg))
    return 'Die Video-Engine konnte nicht geladen werden. Prüfe deine Internetverbindung und versuche es erneut.';
  return `Etwas ist schiefgelaufen: ${msg}`;
}
