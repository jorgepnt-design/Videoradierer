export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Ein markierter Bereich. Alle Koordinaten sind in Video-Pixeln
 * (so wie der Browser das Video anzeigt, also bereits gedreht).
 */
export interface Region {
  id: string;
  label: string;
  kind: 'rect' | 'mask';
  /** Für kind === 'rect' */
  rect?: Rect;
  /** Für kind === 'mask': Graustufen-Maske in Masken-Auflösung (weiß = entfernen) */
  mask?: HTMLCanvasElement;
  start: number;
  end: number;
}

export type Method = 'remove' | 'blur';
export type Fit = 'none' | 'blur916';
export type Quality = 'original' | '720p';

export interface ExportSettings {
  method: Method;
  crop: Rect | null;
  fit: Fit;
  quality: Quality;
}

/** Ein markierter Bereich, so wie ihn der ffmpeg-Befehl braucht */
export interface MaskSpec {
  /** Rechtecke in Videopixeln (für „Entfernen“ mit delogo) */
  boxes: Rect[];
  /** Masken-PNG in Videoauflösung (für „Weichzeichnen“) */
  file?: string;
  start: number;
  end: number;
}

export interface JobSpec {
  input: string;
  output: string;
  width: number;
  height: number;
  duration: number;
  masks: MaskSpec[];
  settings: ExportSettings;
  /** Audio unverändert übernehmen (sonst AAC neu kodieren) */
  copyAudio: boolean;
}
