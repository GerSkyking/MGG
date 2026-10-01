/**
 * Reine Spiellogik des Pixel-Modus (ohne DOM), damit sie auch im
 * Level-Generator/Solver und später im Editor nutzbar ist.
 *
 * Mechaniken:
 *  - Vorrat als Spalten (Stapel): nur der oberste Block einer Spalte ist spielbar.
 *  - Doppelblock (`link`): zwei Teile, belegt beim Setzen zwei freie Slots.
 *  - Schlüsselblock (`lock`): spielbar erst, wenn alle Pixel dieser Farbe weg sind.
 *  - Joker (color -1): schießt auf jede Farbe.
 *  - Harte Pixel (`hard`): brauchen zwei Treffer.
 *  - Gesperrte Slots (`slotLocks`): öffnen sich nach N Schüssen.
 *  - Nebel (`window`): nur die ersten N nicht leeren Spalten sind spielbar.
 */

export interface PartDef {
  color: number;
  ammo: number;
}

export interface BlockDef extends PartDef {
  /** Farbindex: Block ist erst spielbar, wenn alle Pixel dieser Farbe weg sind */
  lock?: number;
  /** Zweiter Teil: macht den Block zum Doppelblock (belegt 2 Slots) */
  link?: PartDef;
}

export interface PixelLevel {
  id: string;
  name: string;
  palette: string[];
  /** Zeilen aus Zeichen: '.' = leer, sonst Palettenindex (0-9, a-z). */
  image: string[];
  /** Optional, gleiche Form wie image: '1' = hartes Pixel (2 Treffer) */
  hard?: string[];
  slots: number;
  /** Pro Slot: nötige Schüsse, bis er sich öffnet (0 = von Anfang an offen) */
  slotLocks?: number[];
  /** Nebel: nur die ersten N nicht leeren Spalten sind spielbar (0/fehlt = alle) */
  window?: number;
  /** Vorrat: Spalten, Index 0 = oberster (spielbarer) Block */
  columns: BlockDef[][];
}

export interface SlotPart {
  color: number;
  ammo: number;
  linked: boolean;
}

export interface State {
  w: number;
  h: number;
  /** -1 = leer, sonst Palettenindex */
  grid: Int8Array;
  /** verbleibende Treffer je Pixel (1 oder 2) */
  hp: Uint8Array;
  remaining: number;
  /** Anzahl Pixel je Farbe */
  left: number[];
  cols: BlockDef[][];
  head: number[];
  win: number;
  slots: (SlotPart | null)[];
  open: number[];
  shots: number;
}

export type Status = "shooting" | "idle" | "win" | "lose";

export interface ShotResult {
  slot: number;
  cell: number;
  /** Farbe des getroffenen Pixels */
  color: number;
  destroyed: boolean;
  emptied: boolean;
}

export type TopState = "empty" | "ok" | "key" | "fog";

export const JOKER = -1;

const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
export const colorChar = (i: number): string => CHARS[i] ?? ".";

function fail(msg: string): never {
  throw new Error("Level ungültig: " + msg);
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function parsePart(raw: unknown, ncolors: number, what: string): PartDef {
  const b = raw as Record<string, unknown> | null;
  if (typeof b !== "object" || b === null) fail(`${what}: kein Objekt`);
  const o = b as Record<string, unknown>;
  if (!isInt(o.color, -1, ncolors - 1)) fail(`${what}: color ungültig`);
  if (!isInt(o.ammo, 1, 999)) fail(`${what}: ammo ungültig`);
  return { color: o.color as number, ammo: o.ammo as number };
}

function parseBlock(raw: unknown, ncolors: number): BlockDef {
  const p = parsePart(raw, ncolors, "Block");
  const o = raw as Record<string, unknown>;
  const b: BlockDef = { color: p.color, ammo: p.ammo };
  if (o.lock !== undefined) {
    if (!isInt(o.lock, 0, ncolors - 1)) fail("Block: lock ungültig");
    b.lock = o.lock as number;
  }
  if (o.link !== undefined) b.link = parsePart(o.link, ncolors, "Block.link");
  return b;
}

/** Trefferbedarf je Farbe, Munition je Farbe und Joker-Munition prüfen. */
function ammoEnough(need: number[], have: number[], joker: number): boolean {
  let deficit = 0;
  for (let c = 0; c < need.length; c++) deficit += Math.max(0, need[c] - have[c]);
  return deficit <= joker;
}

export function parseLevel(raw: unknown): PixelLevel {
  if (typeof raw !== "object" || raw === null) fail("kein Objekt");
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) fail("id fehlt");
  if (typeof r.name !== "string") fail("name fehlt");

  if (!Array.isArray(r.palette) || r.palette.length < 1 || r.palette.length > CHARS.length) fail("palette fehlt");
  const palette = r.palette as unknown[];
  for (const c of palette) {
    if (typeof c !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(c)) fail("palette enthält ungültige Farbe");
  }
  const nc = palette.length;

  if (!Array.isArray(r.image) || r.image.length < 1 || r.image.length > 64) fail("image fehlt");
  const image = r.image as unknown[];
  const width = typeof image[0] === "string" ? image[0].length : 0;
  if (width < 1 || width > 64) fail("image-Breite ungültig");
  const need = new Array<number>(nc).fill(0);

  let hard: string[] | undefined;
  if (r.hard !== undefined) {
    if (!Array.isArray(r.hard) || r.hard.length !== image.length) fail("hard passt nicht zu image");
    hard = r.hard as string[];
  }
  for (let y = 0; y < image.length; y++) {
    const row = image[y];
    if (typeof row !== "string" || row.length !== width) fail("image-Zeilen unterschiedlich lang");
    const hrow = hard?.[y];
    if (hard && (typeof hrow !== "string" || hrow.length !== width)) fail("hard-Zeilen passen nicht zu image");
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      if (ch === ".") {
        if (hrow && hrow[x] !== "." && hrow[x] !== "0") fail("hard auf leerem Feld");
        continue;
      }
      const idx = CHARS.indexOf(ch);
      if (idx < 0 || idx >= nc) fail(`unbekanntes Zeichen '${ch}' im Bild`);
      need[idx] += hrow && hrow[x] === "1" ? 2 : 1;
    }
  }

  if (!isInt(r.slots, 1, 8)) fail("slots muss 1–8 sein");
  const slots = r.slots as number;

  let slotLocks: number[] | undefined;
  if (r.slotLocks !== undefined) {
    if (!Array.isArray(r.slotLocks) || r.slotLocks.length > slots) fail("slotLocks ungültig");
    slotLocks = (r.slotLocks as unknown[]).map((v) => (isInt(v, 0, 999) ? v : fail("slotLocks-Wert ungültig")));
    if (!slotLocks.includes(0) && slotLocks.length >= slots) fail("mindestens ein Slot muss offen sein");
  }

  let win: number | undefined;
  if (r.window !== undefined) {
    if (!isInt(r.window, 0, 40)) fail("window ungültig");
    win = r.window as number;
  }

  let columns: BlockDef[][];
  if (r.columns !== undefined) {
    if (r.blocks !== undefined) fail("entweder blocks oder columns");
    if (!Array.isArray(r.columns) || r.columns.length < 1 || r.columns.length > 40) fail("columns fehlt");
    columns = (r.columns as unknown[]).map((col) => {
      if (!Array.isArray(col) || col.length < 1 || col.length > 12) fail("Spalte ungültig");
      return (col as unknown[]).map((b) => parseBlock(b, nc));
    });
  } else {
    if (!Array.isArray(r.blocks) || r.blocks.length < 1 || r.blocks.length > 200) fail("blocks fehlt");
    columns = (r.blocks as unknown[]).map((b) => [parseBlock(b, nc)]);
  }
  const total = columns.reduce((n, c) => n + c.length, 0);
  if (total > 200) fail("zu viele Blöcke");

  const have = new Array<number>(nc).fill(0);
  let joker = 0;
  let needsPair = false;
  for (const col of columns) {
    for (const b of col) {
      const parts = b.link ? [b, b.link] : [b];
      if (b.link) needsPair = true;
      for (const p of parts) {
        if (p.color === JOKER) joker += p.ammo;
        else have[p.color] += p.ammo;
      }
    }
  }
  if (!ammoEnough(need, have, joker)) fail("zu wenig Munition für die Pixel");
  if (needsPair) {
    const openSlots = Array.from({ length: slots }, (_, i) => slotLocks?.[i] ?? 0).filter((v) => v === 0).length;
    if (openSlots < 2) fail("Doppelblöcke brauchen mindestens 2 offene Slots");
  }

  const level: PixelLevel = { id: r.id, name: r.name, palette: palette as string[], image: image as string[], slots, columns };
  if (hard && hard.some((row) => row.includes("1"))) level.hard = hard;
  if (slotLocks && slotLocks.some((v) => v > 0)) level.slotLocks = slotLocks;
  if (win) level.window = win;
  return level;
}

export function createState(level: PixelLevel): State {
  const h = level.image.length;
  const w = level.image[0].length;
  const grid = new Int8Array(w * h).fill(-1);
  const hp = new Uint8Array(w * h);
  const left = new Array<number>(level.palette.length).fill(0);
  let remaining = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = level.image[y][x];
      if (ch === ".") continue;
      const c = CHARS.indexOf(ch);
      grid[y * w + x] = c;
      hp[y * w + x] = level.hard?.[y][x] === "1" ? 2 : 1;
      left[c]++;
      remaining++;
    }
  }
  return {
    w,
    h,
    grid,
    hp,
    remaining,
    left,
    cols: level.columns,
    head: level.columns.map(() => 0),
    win: level.window ?? 0,
    slots: new Array<SlotPart | null>(level.slots).fill(null),
    open: Array.from({ length: level.slots }, (_, i) => level.slotLocks?.[i] ?? 0),
    shots: 0,
  };
}

export function cloneState(s: State): State {
  return {
    ...s,
    grid: s.grid.slice(),
    hp: s.hp.slice(),
    left: s.left.slice(),
    head: s.head.slice(),
    slots: s.slots.map((b) => (b ? { ...b } : null)),
  };
}

export const isSlotOpen = (s: State, i: number): boolean => s.shots >= s.open[i];

/** Ein Pixel ist freigelegt, wenn ein Nachbar (4er) leer oder außerhalb des Bildes ist. */
export function isExposed(s: State, x: number, y: number): boolean {
  if (s.grid[y * s.w + x] < 0) return false;
  if (x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1) return true;
  return (
    s.grid[y * s.w + x - 1] < 0 ||
    s.grid[y * s.w + x + 1] < 0 ||
    s.grid[(y - 1) * s.w + x] < 0 ||
    s.grid[(y + 1) * s.w + x] < 0
  );
}

/** Erstes freigelegtes Pixel der Farbe (Joker: jeder Farbe), zeilenweise von oben links, oder -1. */
export function findTarget(s: State, color: number): number {
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const v = s.grid[y * s.w + x];
      if (v >= 0 && (color === JOKER || v === color) && isExposed(s, x, y)) return y * s.w + x;
    }
  }
  return -1;
}

export function columnLeft(s: State, col: number): number {
  return s.cols[col].length - s.head[col];
}

export function topBlock(s: State, col: number): BlockDef | null {
  return s.head[col] < s.cols[col].length ? s.cols[col][s.head[col]] : null;
}

/** Zustand des obersten Blocks einer Spalte (ohne Slot-Prüfung). */
export function topState(s: State, col: number): TopState {
  if (s.head[col] >= s.cols[col].length) return "empty";
  if (s.win > 0) {
    let rank = 0;
    for (let i = 0; i < col; i++) if (s.head[i] < s.cols[i].length) rank++;
    if (rank >= s.win) return "fog";
  }
  const b = s.cols[col][s.head[col]];
  if (b.lock !== undefined && s.left[b.lock] > 0) return "key";
  return "ok";
}

export function freeOpenSlots(s: State): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.slots.length; i++) if (s.slots[i] === null && isSlotOpen(s, i)) out.push(i);
  return out;
}

/** Spalten, deren oberster Block jetzt gesetzt werden kann. */
export function legalMoves(s: State): number[] {
  const free = freeOpenSlots(s).length;
  const out: number[] = [];
  for (let c = 0; c < s.cols.length; c++) {
    if (topState(s, c) !== "ok") continue;
    const b = s.cols[c][s.head[c]];
    if (free >= (b.link ? 2 : 1)) out.push(c);
  }
  return out;
}

/** Setzt den obersten Block der Spalte in freie Slots. Gibt die belegten Slots zurück (leer = nicht möglich). */
export function placeBlock(s: State, col: number): number[] {
  if (topState(s, col) !== "ok") return [];
  const b = s.cols[col][s.head[col]];
  const free = freeOpenSlots(s);
  const parts = b.link ? [b, b.link] : [b];
  if (free.length < parts.length) return [];
  const used: number[] = [];
  parts.forEach((p, i) => {
    s.slots[free[i]] = { color: p.color, ammo: p.ammo, linked: parts.length > 1 };
    used.push(free[i]);
  });
  s.head[col]++;
  return used;
}

/** Ein einzelner Schuss: der erste Slot-Block mit Ziel feuert. */
export function step(s: State): ShotResult | null {
  for (let i = 0; i < s.slots.length; i++) {
    const b = s.slots[i];
    if (!b) continue;
    const t = findTarget(s, b.color);
    if (t < 0) continue;
    const color = s.grid[t];
    s.hp[t]--;
    const destroyed = s.hp[t] <= 0;
    if (destroyed) {
      s.grid[t] = -1;
      s.remaining--;
      s.left[color]--;
    }
    s.shots++;
    b.ammo--;
    const emptied = b.ammo <= 0;
    if (emptied) s.slots[i] = null;
    return { slot: i, cell: t, color, destroyed, emptied };
  }
  return null;
}

export function canShoot(s: State): boolean {
  for (const b of s.slots) {
    if (b && findTarget(s, b.color) >= 0) return true;
  }
  return false;
}

export function status(s: State): Status {
  if (s.remaining === 0) return "win";
  if (canShoot(s)) return "shooting";
  // Reicht die restliche Munition überhaupt noch?
  const nc = s.left.length;
  const need = new Array<number>(nc).fill(0);
  for (let i = 0; i < s.grid.length; i++) if (s.grid[i] >= 0) need[s.grid[i]] += s.hp[i];
  const have = new Array<number>(nc).fill(0);
  let joker = 0;
  const add = (p: PartDef): void => {
    if (p.color === JOKER) joker += p.ammo;
    else have[p.color] += p.ammo;
  };
  for (const b of s.slots) if (b) add(b);
  for (let c = 0; c < s.cols.length; c++) {
    for (let i = s.head[c]; i < s.cols[c].length; i++) {
      const b = s.cols[c][i];
      add(b);
      if (b.link) add(b.link);
    }
  }
  if (!ammoEnough(need, have, joker)) return "lose";
  return legalMoves(s).length > 0 ? "idle" : "lose";
}

export function settle(s: State): void {
  while (step(s)) {
    /* schießt bis nichts mehr geht */
  }
}

const partKey = (p: PartDef): string => `${p.color}:${p.ammo}`;
const blockKey = (b: BlockDef): string =>
  partKey(b) + (b.link ? "+" + partKey(b.link) : "") + (b.lock !== undefined ? "L" + b.lock : "");

function stateKey(s: State, maxOpen: number): string {
  let k = "";
  for (let i = 0; i < s.grid.length; i++) k += String.fromCharCode(s.grid[i] + 2 + (s.hp[i] > 1 ? 64 : 0));
  k += "|" + s.head.join(",") + "|";
  for (const b of s.slots) k += b ? `${b.color}:${b.ammo}${b.linked ? "l" : ""},` : "-,";
  if (maxOpen > 0) k += "|" + Math.min(s.shots, maxOpen);
  return k;
}

export type SolveResult =
  | { result: "solved"; moves: number[] }
  | { result: "unsolvable" }
  | { result: "limit" };

/** Tiefensuche über die Reihenfolge, in der Blöcke (Spalten) gesetzt werden. */
export function solve(level: PixelLevel, maxNodes = 300_000): SolveResult {
  const seen = new Set<string>();
  let nodes = 0;
  let limit = false;
  const start = createState(level);
  const maxOpen = Math.max(0, ...start.open);

  const dfs = (s: State): number[] | null => {
    settle(s);
    const st = status(s);
    if (st === "win") return [];
    if (st === "lose") return null;
    const key = stateKey(s, maxOpen);
    if (seen.has(key)) return null;
    seen.add(key);
    if (++nodes > maxNodes) {
      limit = true;
      return null;
    }
    const tried = new Set<string>();
    for (const c of legalMoves(s)) {
      // Gleiche einzelne Blöcke in verschiedenen Spalten sind austauschbar
      if (s.win === 0 && columnLeft(s, c) === 1) {
        const sig = blockKey(s.cols[c][s.head[c]]);
        if (tried.has(sig)) continue;
        tried.add(sig);
      }
      const n = cloneState(s);
      if (placeBlock(n, c).length === 0) continue;
      const r = dfs(n);
      if (r) return [c, ...r];
      if (limit) return null;
    }
    return null;
  };

  const moves = dfs(start);
  if (moves) return { result: "solved", moves };
  return limit ? { result: "limit" } : { result: "unsolvable" };
}
