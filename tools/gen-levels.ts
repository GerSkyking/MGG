/**
 * Erzeugt das Paket "classic" (public/content/classic): 100 Level in 10 Welten.
 * Jede Welt führt eine Mechanik ein; jedes Level wird per Solver auf Lösbarkeit geprüft
 * und die Schwierigkeit (Gewinnrate eines Zufallsspielers) auf eine Kurve getrimmt.
 *
 *   npm run gen:levels              alle Welten
 *   WORLDS=2,3 npm run gen:levels   nur diese Welten neu (andere Dateien bleiben)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  colorChar,
  createState,
  JOKER,
  legalMoves,
  parseLevel,
  placeBlock,
  settle,
  solve,
  status,
  type BlockDef,
  type PixelLevel,
} from "../src/modes/pixel/logic";

const OUT = "public/content/classic";

function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = <T>(a: T[], rand: () => number): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------- Motive ----------

const P = [
  "#e63946", "#f5f5f5", "#3aa655", "#f4d03f", "#3a86ff", "#9b5de5",
  "#f28c28", "#2ec4b6", "#ff70a6", "#8d5a2b", "#1f6f3a", "#e9c9a0",
];

/** ASCII-Sprite -> Bildzeilen; keys[i] ist das Zeichen für Palettenindex i. */
function sprite(rows: string[], keys: string): string[] {
  return rows.map((r) => [...r].map((ch) => (ch === "." ? "." : colorChar(keys.indexOf(ch)))).join(""));
}

function build(size: number, f: (x: number, y: number) => number | null): string[] {
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = "";
    for (let x = 0; x < size; x++) {
      const c = f(x, y);
      row += c === null ? "." : colorChar(c);
    }
    rows.push(row);
  }
  return rows;
}

const rings = (size: number, k: number) => build(size, (x, y) => Math.min(x, y, size - 1 - x, size - 1 - y) % k);

const diamond = (size: number, k: number) => {
  const c = (size - 1) / 2;
  return build(size, (x, y) => {
    const d = Math.abs(x - c) + Math.abs(y - c);
    return d > c ? null : Math.round(c - d) % k;
  });
};

const target = (size: number, k: number) => {
  const c = (size - 1) / 2;
  return build(size, (x, y) => {
    const r = Math.hypot(x - c, y - c);
    return r > c + 0.3 ? null : Math.floor((c + 0.3 - r) / 1.4) % k;
  });
};

const kaleido = (size: number, k: number, sectors: number, band: number, twist = 1) => {
  const c = (size - 1) / 2;
  return build(size, (x, y) => {
    const r = Math.hypot(x - c, y - c);
    if (r > c + 0.4) return null;
    const ring = Math.floor((c + 0.4 - r) / band);
    const a = Math.atan2(y - c, x - c) + Math.PI;
    const sec = Math.floor((a / (2 * Math.PI)) * sectors) % sectors;
    return (ring * twist + sec) % k;
  });
};

/** Spiegelsymmetrische Kristalle: Voronoi-Zellen in einer Kreisform. */
const crystal = (size: number, k: number, seed: number) => {
  const rand = rng(seed);
  const c = (size - 1) / 2;
  const pts: { x: number; y: number; col: number }[] = [];
  for (let i = 0; i < k * 2; i++) {
    const x = rand() * c;
    const y = rand() * (size - 1);
    const col = i % k;
    pts.push({ x: c - x, y, col }, { x: c + x, y, col });
  }
  return build(size, (x, y) => {
    if (Math.hypot(x - c, y - c) > c + 0.35) return null;
    let best = 0;
    let bd = Infinity;
    pts.forEach((p, i) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return pts[best].col;
  });
};

const heart = (size: number, k: number) => {
  const c = (size - 1) / 2;
  return build(size, (x, y) => {
    const u = ((x - c) / (c + 0.6)) * 1.25;
    const v = -((y - c * 0.9) / (c + 0.6)) * 1.25;
    const f = Math.pow(u * u + v * v - 1, 3) - u * u * v * v * v;
    if (f > 0) return null;
    return Math.floor(((y + x * 0.3) / size) * k) % k;
  });
};

const star = (size: number, k: number, arms: number) => {
  const c = (size - 1) / 2;
  return build(size, (x, y) => {
    const dx = x - c;
    const dy = y - c;
    const r = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    const lim = (c + 0.4) * (0.45 + 0.55 * Math.abs(Math.cos((arms * a) / 2)));
    return r > lim ? null : Math.floor((r / (c + 0.4)) * k) % k;
  });
};

const spiral = (size: number, k: number) => {
  const c = (size - 1) / 2;
  return build(size, (x, y) => {
    const r = Math.hypot(x - c, y - c);
    if (r > c + 0.4) return null;
    const a = Math.atan2(y - c, x - c) + Math.PI;
    return Math.floor((r * 0.9 + (a / (2 * Math.PI)) * k * 1.2)) % k;
  });
};

const plus = (size: number, k: number) => {
  const c = (size - 1) / 2;
  const arm = Math.max(1, Math.round(size / 4));
  return build(size, (x, y) => {
    const ax = Math.abs(x - c);
    const ay = Math.abs(y - c);
    if (ax > arm && ay > arm) return null;
    return Math.floor(Math.max(ax, ay) / 1.5) % k;
  });
};

const checker = (size: number, k: number) => {
  const c = (size - 1) / 2;
  return build(size, (x, y) => (Math.hypot(x - c, y - c) > c + 0.4 ? null : (Math.floor(x / 2) + Math.floor(y / 2)) % k));
};

const motifs: { name: string; make: (size: number, k: number, seed: number) => string[] }[] = [
  { name: "Ringe", make: (s, k) => rings(s, k) },
  { name: "Raute", make: (s, k) => diamond(s, k) },
  { name: "Zielscheibe", make: (s, k) => target(s, k) },
  { name: "Kaleidoskop", make: (s, k) => kaleido(s, k, 4 + 2 * (s % 3), 1.4) },
  { name: "Kristall", make: (s, k, seed) => crystal(s, k, seed) },
  { name: "Herz", make: (s, k) => heart(s, k) },
  { name: "Stern", make: (s, k) => star(s, k, 5 + (s % 3)) },
  { name: "Kreuz", make: (s, k) => plus(s, k) },
  { name: "Spirale", make: (s, k) => spiral(s, k) },
  { name: "Mosaik", make: (s, k) => checker(s, k) },
  { name: "Blüte", make: (s, k) => kaleido(s, k, 6, 1.5, 2) },
  { name: "Mandala", make: (s, k) => kaleido(s, k, 8, 1.2, 2) },
];

/** Palettenindizes auf die tatsächlich benutzten Farben verdichten. */
function compact(image: string[], palette: string[]): { image: string[]; palette: string[] } {
  const used: number[] = [];
  for (const row of image) for (const ch of row) if (ch !== ".") used.includes(parseInt(ch, 36)) || used.push(parseInt(ch, 36));
  used.sort((a, b) => a - b);
  return {
    palette: used.map((i) => palette[i]),
    image: image.map((row) => [...row].map((ch) => (ch === "." ? "." : colorChar(used.indexOf(parseInt(ch, 36))))).join("")),
  };
}

interface Motif {
  name: string;
  image: string[];
  palette: string[];
}

/** Handgezeichnete Sprites der ersten Welt (Level 1-4). */
const HAND: Motif[] = [
  {
    name: "Herz",
    palette: ["#e63946", "#f5f5f5"],
    image: sprite([".RR.RR.", "RWRRRRR", "RRRRRRR", ".RRRRR.", "..RRR..", "...R..."], "RW"),
  },
  {
    name: "Baum",
    palette: ["#3aa655", "#1f6f3a", "#8d5a2b"],
    image: sprite(["...G...", "..GGG..", ".GGDGG.", "GGGGGDG", ".GDGGG.", "GGGGGGG", "...B...", "...B..."], "GDB"),
  },
  {
    name: "Sonne",
    palette: ["#f4d03f", "#f28c28"],
    image: sprite(
      ["....O....", ".O..O..O.", "..OYYYO..", "...YYY...", "OOYYYYYOO", "...YYY...", "..OYYYO..", ".O..O..O.", "....O...."],
      "YO",
    ),
  },
  {
    name: "Pilz",
    palette: ["#e63946", "#f5f5f5", "#e9c9a0"],
    image: sprite(
      ["...RRRR...", ".RRWWRRRR.", "RRWWRRRWRR", "RRRRRRRRRR", "RWRRWWRRWR", ".RRRRRRRR.", "...BBBB...", "...BBBB...", "..BBBBBB.."],
      "RWB",
    ),
  },
];

function motifFor(world: number, idx: number, variant = 0): Motif {
  if (world === 1 && idx < HAND.length && variant === 0) return HAND[idx];
  const n = world * 10 + idx + variant * 1000;
  const size = Math.min(15, 7 + Math.floor(idx * 0.75) + Math.floor((world - 1) / 3));
  const k = Math.min(6, 2 + Math.floor((idx + Math.floor(world / 2)) / 2.4) + (variant % 2));
  const kind = motifs[(world * 5 + idx * 7 + variant * 5) % motifs.length];
  const off = (n * 5) % P.length;
  const pal = Array.from({ length: k }, (_, i) => P[(off + i * 5) % P.length]);
  const raw = kind.make(size, k, n * 131 + 7);
  const c = compact(raw, pal);
  return { name: kind.name, image: c.image, palette: c.palette };
}

// ---------- Level bauen ----------

interface Mech {
  stacks?: number; // Tiefe der Spalten
  doubles?: number;
  keys?: number;
  hard?: number; // Anteil harter Pixel
  slotLocks?: number; // Anzahl gesperrter Slots
  fog?: number; // Fenstergröße
  jokers?: number;
}

const mechFor = (world: number, i: number): Mech => {
  switch (world) {
    case 1: return {};
    case 2: return { stacks: i < 5 ? 2 : 3 };
    case 3: return { doubles: 1 + Math.floor(i / 2) };
    case 4: return { keys: 1 + Math.floor(i / 3) };
    case 5: return { hard: 0.1 + i * 0.03 };
    case 6: return { slotLocks: i < 5 ? 1 : 2 };
    case 7: return { fog: i < 4 ? 4 : i < 8 ? 3 : 2 };
    case 8: return { jokers: 1 + Math.floor(i / 4) };
    case 9: return { stacks: 2, doubles: 1 + Math.floor(i / 3), keys: 1 + Math.floor(i / 4) };
    default:
      return {
        stacks: i < 5 ? 2 : 3,
        doubles: 1 + Math.floor(i / 4),
        keys: 1 + Math.floor(i / 5),
        hard: 0.08 + i * 0.02,
        slotLocks: i >= 3 ? 1 : 0,
        jokers: i >= 6 ? 1 : 0,
        fog: i >= 8 ? 3 : 0,
      };
  }
};

/** Zielkurve der Zufallsgewinnrate innerhalb einer Welt. */
const targetRate = (world: number, i: number): number => {
  const a = world === 1 ? 0.98 : 0.8;
  const b = world === 1 ? 0.03 : 0.04;
  return a * Math.pow(b / a, i / 9);
};

function makeBlocks(need: number[], count: number, rand: () => number): BlockDef[] {
  const total = need.reduce((a, b) => a + b, 0);
  const out: BlockDef[] = [];
  need.forEach((n, color) => {
    if (n <= 0) return;
    const k = Math.max(1, Math.min(n, Math.round((count * n) / total)));
    // n in k Teile zerlegen
    const cuts = new Set<number>();
    while (cuts.size < k - 1) cuts.add(1 + Math.floor(rand() * (n - 1)));
    const pts = [0, ...[...cuts].sort((a, b) => a - b), n];
    for (let i = 0; i < k; i++) out.push({ color, ammo: pts[i + 1] - pts[i] });
  });
  return shuffle(out, rand);
}

interface Cand {
  level: PixelLevel;
}

function buildLevel(m: Motif, mech: Mech, slots: number, blockScale: number, seed: number, id: string, name: string): Cand {
  const rand = rng(seed);
  const h = m.image.length;
  const w = m.image[0].length;

  let hard: string[] | undefined;
  if (mech.hard) {
    hard = m.image.map((row) => [...row].map((ch) => (ch !== "." && rand() < (mech.hard as number) ? "1" : ".")).join(""));
    if (!hard.some((r) => r.includes("1"))) hard = undefined;
  }
  const need = new Array<number>(m.palette.length).fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = m.image[y][x];
      if (ch !== ".") need[parseInt(ch, 36)] += hard?.[y][x] === "1" ? 2 : 1;
    }
  const hits = need.reduce((a, b) => a + b, 0);

  const target = Math.round(Math.min(34, (6 + hits / 7) * blockScale));
  let blocks = makeBlocks(need, target, rand);

  // Joker: Blöcke durch gleich große Joker ersetzen
  if (mech.jokers) {
    const order = blocks.map((_, i) => i).sort((a, b) => blocks[b].ammo - blocks[a].ammo);
    for (const i of order.slice(0, mech.jokers)) blocks[i] = { color: JOKER, ammo: blocks[i].ammo };
  }
  // Schlüssel
  if (mech.keys && m.palette.length > 1) {
    const idxs = shuffle(blocks.map((_, i) => i).filter((i) => blocks[i].color !== JOKER), rand).slice(0, mech.keys);
    for (const i of idxs) {
      const others = m.palette.map((_, c) => c).filter((c) => c !== blocks[i].color);
      blocks[i] = { ...blocks[i], lock: others[Math.floor(rand() * others.length)] };
    }
  }
  // Doppelblöcke (zwei Blöcke zu einer Karte)
  if (mech.doubles) {
    for (let d = 0; d < mech.doubles && blocks.length > 3; d++) {
      const free = blocks.map((_, i) => i).filter((i) => !blocks[i].link && blocks[i].lock === undefined);
      if (free.length < 2) break;
      const a = free[Math.floor(rand() * free.length)];
      let bi = free[Math.floor(rand() * free.length)];
      let guard = 0;
      while (bi === a && guard++ < 20) bi = free[Math.floor(rand() * free.length)];
      if (bi === a) break;
      blocks[a] = { ...blocks[a], link: { color: blocks[bi].color, ammo: blocks[bi].ammo } };
      blocks = blocks.filter((_, i) => i !== bi);
    }
  }

  // Spalten
  let columns: BlockDef[][];
  if (mech.stacks) {
    const d = mech.stacks;
    columns = [];
    for (let i = 0; i < blocks.length; i += d) columns.push(blocks.slice(i, i + d));
    if (columns.length > 8) {
      const d2 = Math.ceil(blocks.length / 8);
      columns = [];
      for (let i = 0; i < blocks.length; i += d2) columns.push(blocks.slice(i, i + d2));
    }
  } else columns = blocks.map((b) => [b]);

  const level: PixelLevel = { id, name, palette: m.palette, image: m.image, slots, columns };
  if (hard) level.hard = hard;
  if (mech.fog) level.window = mech.fog;
  if (mech.slotLocks) {
    const locks = new Array<number>(slots).fill(0);
    const nLock = Math.min(mech.slotLocks, slots - (mech.doubles ? 2 : 1));
    for (let j = 0; j < nLock; j++) locks[slots - 1 - j] = Math.max(2, Math.round(hits * (0.12 + 0.2 * j) * (0.7 + rand() * 0.6)));
    level.slotLocks = locks;
  }
  return { level };
}

function randomWinRate(level: PixelLevel, runs: number, rand: () => number): number {
  let wins = 0;
  for (let r = 0; r < runs; r++) {
    const s = createState(level);
    for (;;) {
      settle(s);
      const st = status(s);
      if (st === "win") {
        wins++;
        break;
      }
      if (st !== "idle") break;
      const mv = legalMoves(s);
      placeBlock(s, mv[Math.floor(rand() * mv.length)]);
    }
  }
  return wins / runs;
}

function slotOptions(world: number, mech: Mech): number[] {
  const lo = mech.doubles ? 2 : 1;
  let opts = [lo, lo + 1, lo + 2, lo + 3];
  if (mech.slotLocks) opts = opts.map((o) => o + (mech.doubles ? 3 : 2));
  else if (world >= 2) opts = opts.map((o) => Math.max(2, o));
  return [...new Set(opts)].filter((o) => o <= 8);
}

function generateFor(world: number, i: number, variant: number): { level: PixelLevel; rate: number; dist: number } | null {
  const m = motifFor(world, i, variant);
  const mech = mechFor(world, i);
  const goal = targetRate(world, i);
  const id = `l${String((world - 1) * 10 + i + 1).padStart(3, "0")}`;
  const t0 = Date.now();
  let best: { level: PixelLevel; rate: number } | null = null;
  let bestDist = Infinity;
  // Bei Bedarf Mechanik abschwächen, wenn keine lösbare Variante gefunden wird
  for (const soft of [1, 0.6, 0.3, 0]) {
    const mm: Mech = { ...mech };
    if (soft < 1) {
      if (mm.doubles) mm.doubles = Math.max(1, Math.floor(mm.doubles * soft));
      if (mm.keys) mm.keys = Math.max(1, Math.floor(mm.keys * soft));
      if (mm.jokers) mm.jokers = Math.max(1, Math.floor(mm.jokers * soft));
      if (soft === 0) {
        delete mm.fog;
        delete mm.slotLocks;
      }
    }
    for (const slots of slotOptions(world, mm)) {
      for (const scale of [0.6, 0.8, 1, 1.3, 1.7, 2.2]) {
        for (let seed = 1; seed <= 25; seed++) {
          if (best && Date.now() - t0 > 25_000) break;
          const { level } = buildLevel(m, mm, slots, scale, seed * 7919 + world * 101 + i * 17 + Math.round(scale * 10), id, m.name);
          try {
            parseLevel(JSON.parse(JSON.stringify(level)));
          } catch {
            continue;
          }
          // Erst die billige Zufallsmessung; der teure Solver läuft nur für echte Verbesserungen.
          const rate = randomWinRate(level, 150, rng(seed + 99));
          const dist = Math.abs(Math.log((rate + 0.01) / (goal + 0.01)));
          if (dist >= bestDist) continue;
          if (solve(level, 30_000).result !== "solved") continue;
          bestDist = dist;
          best = { level, rate };
        }
      }
    }
    if (best) {
      if (soft < 1) console.log(`  (Mechanik abgeschwächt: ${soft})`);
      break;
    }
  }
  if (!best) return null;
  const L = best.level;
  const blocksN = L.columns.reduce((n, c) => n + c.length, 0);
  console.log(
    `${id} W${world}.${i + 1} ${m.name.padEnd(12)} ${L.image[0].length}x${L.image.length} F${L.palette.length} Blöcke ${blocksN} Slots ${L.slots}  Ziel ${(goal * 100).toFixed(0)}%  Zufall ${(best.rate * 100).toFixed(1)}%  ${Date.now() - t0}ms`,
  );
  return { ...best, dist: bestDist };
}

function generate(world: number, i: number): { level: PixelLevel; rate: number } {
  let best: { level: PixelLevel; rate: number; dist: number } | null = null;
  for (let v = 0; v < 5; v++) {
    const r = generateFor(world, i, v);
    if (r && (!best || r.dist < best.dist)) best = r;
    if (best && best.dist < 0.3) break;
  }
  if (!best) throw new Error(`Welt ${world} Level ${i + 1}: keine lösbare Variante gefunden`);
  return best;
}

// ---------- Ausgabe ----------

function serialize(l: PixelLevel): string {
  const single = l.columns.every((c) => c.length === 1);
  const { columns, ...rest } = l;
  return JSON.stringify(single ? { ...rest, blocks: columns.map((c) => c[0]) } : { ...rest, columns });
}

mkdirSync(`${OUT}/levels`, { recursive: true });
const worldsArg = process.env.WORLDS ? process.env.WORLDS.split(",").map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

for (const world of worldsArg) {
  console.log(`\nWelt ${world}`);
  for (let i = 0; i < 10; i++) {
    const nr = (world - 1) * 10 + i + 1;
    if (nr < Number(process.env.FROM ?? 1) || nr > Number(process.env.TO ?? 100)) continue;
    const { level } = generate(world, i);
    writeFileSync(`${OUT}/levels/${level.id}.json`, serialize(level));
  }
}

const manifestLevels: { id: string; file: string; name: string }[] = [];
for (let n = 1; n <= 100; n++) {
  const id = `l${String(n).padStart(3, "0")}`;
  if (!existsSync(`${OUT}/levels/${id}.json`)) continue;
  const name = (JSON.parse(readFileSync(`${OUT}/levels/${id}.json`, "utf8")) as { name: string }).name;
  manifestLevels.push({ id, file: `levels/${id}.json`, name });
}
writeFileSync(
  `${OUT}/manifest.json`,
  JSON.stringify({ id: "classic", name: "Klassik", version: "1.0.0", mode: "pixel", levels: manifestLevels }, null, 2),
);
writeFileSync("public/content/packs.json", JSON.stringify(["classic"]));
console.log(`\nfertig: ${manifestLevels.length} Level im Manifest`);
