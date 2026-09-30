/**
 * Reine Spiellogik des Pixel-Modus (ohne DOM), damit sie auch im
 * Level-Generator/Solver und später im Editor nutzbar ist.
 */

export interface BlockDef {
  color: number;
  ammo: number;
}

export interface PixelLevel {
  id: string;
  name: string;
  palette: string[];
  /** Zeilen aus Zeichen: '.' = leer, sonst Palettenindex (0-9, a-z). */
  image: string[];
  slots: number;
  blocks: BlockDef[];
}

export interface State {
  w: number;
  h: number;
  /** -1 = leer, sonst Palettenindex */
  grid: Int8Array;
  remaining: number;
  supply: (BlockDef | null)[];
  slots: (BlockDef | null)[];
}

export type Status = "shooting" | "idle" | "win" | "lose";

export interface ShotResult {
  slot: number;
  cell: number;
  color: number;
  emptied: boolean;
}

const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
export const colorChar = (i: number): string => CHARS[i] ?? ".";

function fail(msg: string): never {
  throw new Error("Level ungültig: " + msg);
}

export function parseLevel(raw: unknown): PixelLevel {
  if (typeof raw !== "object" || raw === null) fail("kein Objekt");
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) fail("id fehlt");
  if (typeof r.name !== "string") fail("name fehlt");

  if (!Array.isArray(r.palette) || r.palette.length < 1 || r.palette.length > CHARS.length)
    fail("palette fehlt");
  const palette = r.palette as unknown[];
  for (const c of palette) {
    if (typeof c !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(c)) fail("palette enthält ungültige Farbe");
  }

  if (!Array.isArray(r.image) || r.image.length < 1 || r.image.length > 64) fail("image fehlt");
  const image = r.image as unknown[];
  const width = typeof image[0] === "string" ? image[0].length : 0;
  if (width < 1 || width > 64) fail("image-Breite ungültig");
  const need = new Array<number>(palette.length).fill(0);
  for (const row of image) {
    if (typeof row !== "string" || row.length !== width) fail("image-Zeilen unterschiedlich lang");
    for (const ch of row as string) {
      if (ch === ".") continue;
      const idx = CHARS.indexOf(ch);
      if (idx < 0 || idx >= palette.length) fail(`unbekanntes Zeichen '${ch}' im Bild`);
      need[idx]++;
    }
  }

  if (!Number.isInteger(r.slots) || (r.slots as number) < 1 || (r.slots as number) > 8)
    fail("slots muss 1–8 sein");

  if (!Array.isArray(r.blocks) || r.blocks.length < 1 || r.blocks.length > 200) fail("blocks fehlt");
  const have = new Array<number>(palette.length).fill(0);
  const blocks: BlockDef[] = [];
  for (const b of r.blocks as unknown[]) {
    const bb = b as Record<string, unknown> | null;
    if (
      typeof bb !== "object" ||
      bb === null ||
      !Number.isInteger(bb.color) ||
      (bb.color as number) < 0 ||
      (bb.color as number) >= palette.length ||
      !Number.isInteger(bb.ammo) ||
      (bb.ammo as number) < 1 ||
      (bb.ammo as number) > 999
    )
      fail("ungültiger Block");
    const color = (bb as Record<string, number>).color as number;
    const ammo = (bb as Record<string, number>).ammo as number;
    have[color] += ammo;
    blocks.push({ color, ammo });
  }
  for (let i = 0; i < palette.length; i++) {
    if (have[i] < need[i]) fail(`Farbe ${i}: zu wenig Munition (${have[i]} von ${need[i]})`);
  }

  return {
    id: r.id,
    name: r.name,
    palette: palette as string[],
    image: image as string[],
    slots: r.slots as number,
    blocks,
  };
}

export function createState(level: PixelLevel): State {
  const h = level.image.length;
  const w = level.image[0].length;
  const grid = new Int8Array(w * h).fill(-1);
  let remaining = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = level.image[y][x];
      if (ch !== ".") {
        grid[y * w + x] = CHARS.indexOf(ch);
        remaining++;
      }
    }
  }
  return {
    w,
    h,
    grid,
    remaining,
    supply: level.blocks.map((b) => ({ ...b })),
    slots: new Array<BlockDef | null>(level.slots).fill(null),
  };
}

export function cloneState(s: State): State {
  return {
    w: s.w,
    h: s.h,
    grid: s.grid.slice(),
    remaining: s.remaining,
    supply: s.supply.slice(),
    slots: s.slots.map((b) => (b ? { ...b } : null)),
  };
}

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

/** Erstes freigelegtes Pixel der Farbe (zeilenweise von oben links) oder -1. */
export function findTarget(s: State, color: number): number {
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (s.grid[y * s.w + x] === color && isExposed(s, x, y)) return y * s.w + x;
    }
  }
  return -1;
}

/** Legt einen Vorrats-Block in den ersten freien Slot. Gibt Slot-Index oder -1 zurück. */
export function placeBlock(s: State, supplyIndex: number): number {
  const b = s.supply[supplyIndex];
  if (!b) return -1;
  const slot = s.slots.indexOf(null);
  if (slot < 0) return -1;
  s.slots[slot] = { ...b };
  s.supply[supplyIndex] = null;
  return slot;
}

/** Ein einzelner Schuss: der erste Slot-Block mit Ziel feuert. */
export function step(s: State): ShotResult | null {
  for (let i = 0; i < s.slots.length; i++) {
    const b = s.slots[i];
    if (!b) continue;
    const t = findTarget(s, b.color);
    if (t < 0) continue;
    s.grid[t] = -1;
    s.remaining--;
    b.ammo--;
    const emptied = b.ammo <= 0;
    if (emptied) s.slots[i] = null;
    return { slot: i, cell: t, color: b.color, emptied };
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
  const need = new Map<number, number>();
  for (const v of s.grid) if (v >= 0) need.set(v, (need.get(v) ?? 0) + 1);
  const have = new Map<number, number>();
  for (const b of [...s.slots, ...s.supply]) if (b) have.set(b.color, (have.get(b.color) ?? 0) + b.ammo);
  for (const [c, n] of need) if ((have.get(c) ?? 0) < n) return "lose";
  const canPlace = s.slots.includes(null) && s.supply.some((b) => b !== null);
  return canPlace ? "idle" : "lose";
}

function settle(s: State): void {
  while (step(s)) {
    /* schießt bis nichts mehr geht */
  }
}

function stateKey(s: State): string {
  let k = "";
  for (const v of s.grid) k += String.fromCharCode(v + 2);
  k += "|";
  for (const b of s.supply) k += b ? "1" : "0";
  k += "|";
  for (const b of s.slots) k += b ? `${b.color}:${b.ammo},` : "-,";
  return k;
}

export type SolveResult =
  | { result: "solved"; moves: number[] }
  | { result: "unsolvable" }
  | { result: "limit" };

/** Tiefensuche über die Reihenfolge, in der Blöcke aus dem Vorrat gelegt werden. */
export function solve(level: PixelLevel, maxNodes = 300_000): SolveResult {
  const seen = new Set<string>();
  let nodes = 0;
  let limit = false;

  const dfs = (s: State): number[] | null => {
    settle(s);
    const st = status(s);
    if (st === "win") return [];
    if (st === "lose") return null;
    const key = stateKey(s);
    if (seen.has(key)) return null;
    seen.add(key);
    if (++nodes > maxNodes) {
      limit = true;
      return null;
    }
    const tried = new Set<string>();
    for (let i = 0; i < s.supply.length; i++) {
      const b = s.supply[i];
      if (!b) continue;
      const bk = `${b.color}:${b.ammo}`;
      if (tried.has(bk)) continue;
      tried.add(bk);
      const c = cloneState(s);
      if (placeBlock(c, i) < 0) continue;
      const r = dfs(c);
      if (r) return [i, ...r];
      if (limit) return null;
    }
    return null;
  };

  const moves = dfs(createState(level));
  if (moves) return { result: "solved", moves };
  return limit ? { result: "limit" } : { result: "unsolvable" };
}
