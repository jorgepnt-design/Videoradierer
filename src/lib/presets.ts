import type { Rect } from './types';

/**
 * Typische Positionen der Bedienelemente in Bildschirmaufnahmen (relativ zur Bildgröße, 0..1).
 * Nur ein Startpunkt – Lage und Größe lassen sich danach anpassen.
 */
export interface Preset {
  id: string;
  name: string;
  areas: { label: string; rect: Rect }[];
}

export const PRESETS: Preset[] = [
  {
    id: 'instagram',
    name: 'Instagram Reels',
    areas: [
      { label: 'Symbole rechts', rect: { x: 0.85, y: 0.5, w: 0.14, h: 0.42 } },
      { label: 'Name & Text unten', rect: { x: 0.02, y: 0.8, w: 0.78, h: 0.14 } },
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    areas: [
      { label: 'Symbole rechts', rect: { x: 0.84, y: 0.38, w: 0.15, h: 0.5 } },
      { label: 'Name & Text unten', rect: { x: 0.02, y: 0.78, w: 0.78, h: 0.14 } },
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook Reels',
    areas: [
      { label: 'Symbole rechts', rect: { x: 0.84, y: 0.48, w: 0.15, h: 0.44 } },
      { label: 'Name & Text unten', rect: { x: 0.02, y: 0.8, w: 0.78, h: 0.13 } },
    ],
  },
  {
    id: 'shorts',
    name: 'YouTube Shorts',
    areas: [
      { label: 'Symbole rechts', rect: { x: 0.84, y: 0.42, w: 0.15, h: 0.48 } },
      { label: 'Name & Text unten', rect: { x: 0.02, y: 0.8, w: 0.78, h: 0.13 } },
    ],
  },
];
