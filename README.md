# Videoradierer

Web-App fürs iPhone, mit der man störende Stellen aus Videos entfernt: Symbole, Logos, Zahlen,
Datumsstempel, Text-Einblendungen. Besonders praktisch für Bildschirmaufnahmen von Reels/TikToks,
bei denen rechts Like-, Kommentar- und Teilen-Symbole und unten ein schwarzer Balken mit im Bild sind.

Alles läuft **lokal im Browser** (ffmpeg.wasm), das Video verlässt das Gerät nicht.

## Funktionen

- Video aus der Mediathek wählen (MOV/HEVC und MP4 vom iPhone)
- Markieren mit **Rechteck** (aufziehen, verschieben, an den Ecken skalieren), **Pinsel** und **Radierer**
- **Symbole automatisch finden**: Die App analysiert ~24 Frames und markiert Stellen, die sich nicht
  bewegen, aber deutliche Kanten haben (Bedienelemente, Logos). Schwarze Ränder werden ebenfalls erkannt.
- **Vorlagen** für Instagram Reels, TikTok, Facebook Reels und YouTube Shorts
- Jeder Bereich kann auf einen **Zeitraum** begrenzt werden („Start = jetzt“, „Ende = jetzt“)
- Drei Wege, Stellen loszuwerden:
  - **Entfernen** – füllt das Rechteck aus den umliegenden Pixeln (ffmpeg `delogo`)
  - **Weichzeichnen** – verwischt exakt die gemalte Form (Maske + `gblur`)
  - **Zuschneiden** – schneidet Randbereiche mit Symbolen und schwarze Balken weg, optional
    zurück auf **9:16** mit unscharfem Hintergrund. Die sauberste Lösung, wenn die Symbole am Rand liegen.
- Pinch-to-Zoom zum genauen Markieren, Rückgängig/Wiederholen
- Export als H.264-MP4 in Originalauflösung oder „Schnell (720p)“, Ton wird übernommen
- Vorher/Nachher-Vergleich mit Schieberegler
- **In Fotos sichern** über das iOS-Teilen-Menü (Web Share API), sonst Download
- PWA: „Zum Home-Bildschirm“ hinzufügen, funktioniert danach auch offline

## Benutzung auf dem iPhone

1. Die veröffentlichte Seite in Safari öffnen (siehe unten).
2. Teilen → **Zum Home-Bildschirm**, dann startet die App wie eine normale App.
3. Video wählen → „Symbole automatisch finden“ oder Stellen markieren → „Video exportieren“
   → „In Fotos sichern / Teilen“ → **Video sichern**.

Tipps:
- Liegen die Symbole am Rand (wie bei Reel-Aufnahmen), ist **Zuschneiden** fast immer am besten.
- Für **Entfernen** das Rechteck etwas größer als das Symbol ziehen, sonst wird der Rand des Symbols
  in die Fläche hineingezogen.
- Lange oder sehr große Videos: „Schnell (720p)“ wählen. Die Bearbeitung läuft auf dem Gerät,
  ein iPhone schafft je nach Modell und Auflösung grob 5–30 Bilder pro Sekunde.

## Entwicklung

```bash
npm install
npm run dev        # http://localhost:5173 (mit --host auch im WLAN erreichbar)
npm run build      # Produktions-Build nach dist/
npm run test:filters   # prüft die erzeugten ffmpeg-Befehle mit einem nativen ffmpeg
node scripts/test-detect.mjs   # prüft die automatische Erkennung (nach test:filters)
```

Für die Tests muss `ffmpeg` installiert sein, außerdem Node ≥ 22.18.

Aufbau:

| Datei | Aufgabe |
| --- | --- |
| `src/App.tsx` | Ablauf, Zustand, Rückgängig/Wiederholen, Einstellungen |
| `src/components/Editor.tsx` | Video mit Zeichenfläche, Gesten (Rechteck, Pinsel, Zuschnitt, Pinch-Zoom) |
| `src/lib/buildJob.ts` | baut aus den Markierungen den ffmpeg-Befehl (reine Funktion, getestet) |
| `src/lib/ffmpeg.ts` | lädt ffmpeg.wasm bei Bedarf, führt den Export aus |
| `src/lib/detect.ts` | Erkennung statischer Einblendungen, schwarzer Ränder, Zuschnitt-Vorschlag |
| `src/lib/masks.ts` | Masken ↔ Rechtecke, Masken-PNGs für ffmpeg |

Fehlersuche: Mit `?debug` an der Adresse werden die ffmpeg-Ausgaben in der Konsole angezeigt.

## Veröffentlichen

**GitHub Pages:** Der Workflow `.github/workflows/pages.yml` baut bei jedem Push und veröffentlicht den
Standard-Branch. Einmalig in den Repo-Einstellungen unter *Settings → Pages → Source* „**GitHub Actions**“
auswählen. Danach ist die App unter `https://<benutzer>.github.io/<repo>/` erreichbar.

**Vercel/Netlify:** Build-Befehl `npm run build`, Ausgabeordner `dist`. Besondere Header (COOP/COEP)
sind nicht nötig, weil die Single-Thread-Version von ffmpeg.wasm verwendet wird.

## Grenzen und Ausbau

- „Entfernen“ interpoliert aus dem Rand. Bei großen Flächen über bewegtem Inhalt (z. B. über einer
  Person) bleibt eine weiche Fläche sichtbar. Dann besser zuschneiden oder weichzeichnen.
- Ein KI-Modus (Video-Inpainting, z. B. ProPainter über eine Serverless-Funktion) ist noch nicht
  eingebaut. Er würde solche Fälle deutlich besser lösen, braucht aber einen Server und einen API-Schlüssel.

Bitte nur Videos bearbeiten, an denen du die Rechte hast.
