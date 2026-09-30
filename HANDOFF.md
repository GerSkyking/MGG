# MGG - Übergabe an eine andere Claude-Instanz

Kontext: Sky (Elektriker, lernt Programmieren, Deutschland, Gitea unter git.jensr.de) baut die App **MGG**.
Arbeitsweise: **auf Deutsch, knapp und technisch, Schritt für Schritt mit Bestätigung nach jedem Schritt.**

## Ziel
Lokale, offline nutzbare Puzzle-App (Web/PWA per Docker Compose + Android). Spielmodi und Level sind
dynamisch nachladbar (ZIP oder Git/Gitea) und darüber aktualisierbar. Neue Spielmodi und Level sollen
in der App erstellt und gespeichert werden können. Internet nur zum Herunterladen von Paketen.

Erster Modus (fertig): **Pixel-Modus**. Ein gepixeltes Bild, unten Blöcke mit Farbe + Munition, die Pixel
von außen nach innen wegschießen. Jedes Level soll schwerer werden, später neue Mechaniken.

## Entscheidungen
- Stack: TypeScript + Vite + Canvas 2D. Web als statische Seite (nginx im Docker Compose, Port 8080),
  Android später per Capacitor. Kein Backend.
- Menü/HUD/Overlay sind DOM, das Spielfeld ist Canvas.
- Pakete = Ordner/ZIP/Git-Archiv mit `manifest.json` + Level-JSONs (Format siehe README.md).
- Modi sind zunächst **deklarativ** (Regeln/Level als JSON). Eigener Modus-Code per Download nur später
  und nur aus vertrauten Repos (Sicherheitsrisiko).
- Kein Update-Zwang über Store: Updates laufen über Git-Download der Pakete (Schritt 3).

## Stand (Schritte 1 und 2 erledigt)
1. Projektgerüst, Docker Compose, Engine, Modus-Registry.
2. Pixel-Modus komplett, Menü mit Fortschritt (localStorage), 10 eingebaute Level, ZIP-Import
   (Datei und URL) in IndexedDB. Headless-Browser-Test mit Playwright war grün.

Struktur:
- `src/core/` Engine (Game-Loop, Pointer), `types.ts` (GameMode, GameHost, PackManifest), `registry.ts`
  (Modus registrieren + Level-Validator), `progress.ts`
- `src/modes/pixel/logic.ts` reine Logik (DOM-frei): parseLevel, createState, step, status, solve
- `src/modes/pixel/index.ts` Darstellung/Eingabe des Pixel-Modus
- `src/content/packs.ts` eingebaute Pakete (`public/content/`), ZIP-Import, IndexedDB
- `src/ui/app.ts` Menü, HUD, Ergebnis-Overlay
- `tools/gen-levels.ts` erzeugt `public/content/classic`, prüft per Solver, sortiert nach gemessener Schwierigkeit

## Wichtige Regeln im Code (nicht brechen)
- **Solver-Modell = Laufzeitverhalten.** Während Blöcke schießen, ist Eingabe gesperrt; Schussreihenfolge
  ist deterministisch (Slot-Reihenfolge, Pixel zeilenweise von oben links). Nur so garantiert der Solver
  Lösbarkeit. Wer die Spielregeln ändert, muss `logic.ts` (`step`, `status`, `solve`) mitziehen.
- Pixel gilt als freigelegt, wenn ein 4er-Nachbar leer oder außerhalb des Bilds ist.
- Pakete/Level sind **nicht vertrauenswürdig**: alle Texte aus Paketen nur per `textContent` ausgeben,
  Dateipfade in Manifesten werden geprüft (`isSafePath`), Größenlimits beim ZIP (20 MB, 1 MB je Level).
- Neue Modi: `registerMode(id, factory, validateLevel)` in `main.ts`, Interface `GameMode` aus `types.ts`.

## Befehle
```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # tsc + vite build
npm run gen:levels     # eingebaute Level neu erzeugen (dauert ca. 20 s)
docker compose up -d --build   # http://localhost:8080
```

## Offene Schritte (jeweils einzeln mit Sky bestätigen)
3. **Git-Updates von Paketen**: Paket-Quelle (Gitea-Repo-URL + Branch/Tag) speichern, auf neue
   Version prüfen (Manifest-`version`), aktualisieren. Browser-Download von Gitea scheitert ohne CORS:
   dann kleiner Proxy im Docker Compose (nginx `location /gitproxy/`) oder Gitea-CORS aktivieren.
   Der Download per URL ist bisher **nicht gegen das echte Gitea getestet**.
4. **Editor in der App**: Pixel-Level malen (Palette, Raster), Blöcke/Slots festlegen, Solver-Check
   (`solve` aus `logic.ts` wiederverwenden), lokal speichern, Export als ZIP. Modus-Editor (Regeln als JSON).
5. **Android**: Capacitor um den Vite-Build, Download direkt ohne CORS-Proxy.
6. Spätere Mechaniken für höhere Level: gesperrte/versteckte Blöcke, Verbindungsblöcke, Bedingungen,
   mehr Farben. Level-Format ist erweiterbar, Validator und Solver müssen mitwachsen.

## Bekannte Lücken
- Kein Service Worker/PWA-Manifest (Offline im Browser nur über lokal laufenden Container).
- Schwierigkeitskurve: Level 1-4 sehr leicht, Level 10 sehr schwer (Zufallsspieler-Gewinnrate 1,8 %).
  Feinjustierung nach Sky's Testfeedback offen.
- Kein Ton, keine Undo-Funktion, keine Level-Vorschau im Menü.
