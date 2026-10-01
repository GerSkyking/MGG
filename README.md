# MGG

Offline-fähige Puzzle-App. Spielmodi und Level sind austauschbar und kommen als Pakete
(eingebaut, ZIP-Datei oder Git-Archiv per URL).

## Starten
```bash
npm install
npm run dev                    # http://localhost:5173
# oder als Container:
docker compose up -d --build   # http://localhost:8080
```
Nicht per `file://` öffnen – die App lädt ihre Pakete per fetch.

## Pixel-Modus (Regeln)
- Das Bild verschwindet von außen nach innen: nur **freigelegte** Pixel (Rand oder leeres Nachbarfeld) können getroffen werden.
- Unten liegt der Vorrat an Blöcken (Farbe + Munition). Antippen legt einen Block in einen freien **Slot**.
- Ein Block im Slot schießt automatisch auf freigelegte Pixel seiner Farbe, bis die Munition leer ist. Dann wird der Slot frei.
- Gewonnen: alle Pixel weg. Verloren: kein Zug mehr möglich (Slots blockiert oder Munition falsch verteilt).
- Während geschossen wird, sind Eingaben gesperrt (so ist jedes Level per Solver exakt prüfbar).

## Paket-Format
```
mein-paket/
  manifest.json
  levels/l01.json
```
`manifest.json`:
```json
{ "id": "mein-paket", "name": "Mein Paket", "version": "1.0.0", "mode": "pixel",
  "levels": [ { "id": "l01", "file": "levels/l01.json", "name": "Herz" } ] }
```
Pixel-Level (einfach):
```json
{ "id": "l01", "name": "Herz",
  "palette": ["#e63946", "#f5f5f5"],
  "image": ["..0.0..", ".00000."],
  "slots": 4,
  "blocks": [ { "color": 0, "ammo": 4 } ] }
```
`image`: `.` = leer, sonst Palettenindex (0-9, a-z). Die Munition muss die Treffer je Farbe decken.

Erweiterte Felder (alle optional):
- `columns`: statt `blocks` ein Vorrat aus **Stapeln**. `[[{…},{…}],[{…}]]`, Index 0 = oberster, spielbarer Block. Die ersten zwei sind sichtbar, tiefere verdeckt.
- Block `link: { "color": 1, "ammo": 3 }`: **Doppelblock** (zwei Teile, belegt beim Setzen zwei freie Slots; Farben dürfen gleich sein = verbundene Blöcke).
- Block `lock: 2`: **Schlüsselblock**, spielbar erst wenn alle Pixel der Farbe 2 weg sind.
- Block `color: -1`: **Joker**, schießt auf jede Farbe.
- `hard`: Zeilen wie `image`, `1` = **hartes Pixel** (2 Treffer).
- `slotLocks`: z. B. `[0,0,8]`, Slot 3 öffnet sich nach 8 Schüssen.
- `window`: **Nebel**, nur die ersten N Spalten sind spielbar, der Rest ist verdeckt.

ZIP/Git-Archive dürfen einen Top-Ordner haben (wie `.../archive/main.zip` bei Gitea/GitHub).

## Pakete aus Git laden und aktualisieren
- Im Menü unter "Pakete laden": Repo-URL (`https://git.jensr.de/user/repo`) und Branch/Tag (Standard `main`) eingeben, oder direkt einen ZIP-Link. Die App holt `…/archive/<ref>.zip`.
- Die Quelle wird beim Paket gespeichert. "Auf Update prüfen" lädt das Archiv und vergleicht `version` im Manifest (numerisch, z. B. 1.10.0 > 1.9.0). Ist sie neuer, erscheint "Auf vX aktualisieren". Kein automatischer Check, kein Zwang.
- CORS: Downloads von `git.jensr.de` laufen im Browser über den Proxy `/gitproxy/` (nginx im Container, `vite`-Proxy im Dev-Server). Der Proxy ist fest auf diese Instanz und nur auf GET beschränkt. Andere Hosts werden direkt geladen und brauchen CORS. In der Android-App (Capacitor) entfällt der Proxy.
- Level-IDs müssen im Paket stabil bleiben, damit der Fortschritt beim Update erhalten bleibt.

## Eingebaute Level neu erzeugen
```bash
npm run gen:levels
```
Erzeugt `public/content/classic` (100 Level in 10 Welten, je eine neue Mechanik), prüft jedes Level mit dem Solver auf Lösbarkeit und trimmt die Schwierigkeit (Gewinnrate eines Zufallsspielers) auf eine Kurve je Welt.
`WORLDS=4,5 npm run gen:levels` erzeugt nur diese Welten neu, `FROM=88 TO=90` nur diese Level-Nummern.

Welten: 1 Grundspiel · 2 Stapel · 3 Doppelblöcke · 4 Schlüssel · 5 harte Pixel · 6 gesperrte Slots · 7 Nebel · 8 Joker · 9 Stapel+Doppel+Schlüssel · 10 alles zusammen.

## Struktur
- `src/core/` - Engine, Typen, Modus-Registry, Fortschritt
- `src/modes/pixel/` - Spiellogik (`logic.ts`, DOM-frei) und Darstellung (`index.ts`)
- `src/content/packs.ts` - Pakete laden, ZIP-Import (IndexedDB)
- `src/ui/app.ts` - Menü, HUD, Ergebnis-Overlay
- `tools/gen-levels.ts` - Level-Generator + Solver-Check
