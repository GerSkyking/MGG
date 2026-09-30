/**
 * Erzeugt das Paket "classic" (public/content/classic) und prüft jedes Level
 * mit dem Solver auf Lösbarkeit. Aufruf: npm run gen:levels
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  colorChar,
  createState,
  parseLevel,
  placeBlock,
  solve,
  status,
  step,
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

/** ASCII-Sprite -> Bildzeilen; keys[i] ist das Zeichen für Palettenindex i. */
function sprite(rows: string[], keys: string): string[] {
  return rows.map((r) =>
    [...r].map((ch) => (ch === "." ? "." : colorChar(keys.indexOf(ch)))).join(""),
  );
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

const rings = (size: number, colors: number) =>
  build(size, (x, y) => Math.min(x, y, size - 1 - x, size - 1 - y) % colors);

const diamond = (size: number, colors: number) => {
  const c = (size - 1) / 2;
  return build(size, (x, y) => {
    const d = Math.abs(x - c) + Math.abs(y - c);
    return d > c ? null : Math.round(c - d) % colors;
  });
};

const target = (size: number, colors: number) => {
  const c = (size - 1) / 2;
  return build(size, (x, y) => {
    const r = Math.hypot(x - c, y - c);
    if (r > c + 0.3) return null;
    return Math.floor((c + 0.3 - r) / 1.4) % colors;
  });
};

const kaleido = (size: number, colors: number, sectors: number, band: number, twist = 1) => {
  const c = (size - 1) / 2;
  return build(size, (x, y) => {
    const r = Math.hypot(x - c, y - c);
    if (r > c + 0.4) return null;
    const ring = Math.floor((c + 0.4 - r) / band);
    const a = Math.atan2(y - c, x - c) + Math.PI;
    const sec = Math.floor((a / (2 * Math.PI)) * sectors) % sectors;
    return (ring * twist + sec) % colors;
  });
};

interface Def {
  name: string;
  palette: string[];
  image: string[];
  slots: number;
  chunk: [number, number];
  /** Ziel: Gewinnrate eines zufällig spielenden Spielers (kleiner = schwerer) */
  rate: number;
}

const P = {
  red: "#e63946",
  white: "#f5f5f5",
  green: "#3aa655",
  dgreen: "#1f6f3a",
  brown: "#8d5a2b",
  yellow: "#f4d03f",
  orange: "#f28c28",
  beige: "#e9c9a0",
  blue: "#3a86ff",
  purple: "#9b5de5",
  teal: "#2ec4b6",
  pink: "#ff70a6",
};

const defs: Def[] = [
  {
    name: "Herz",
    palette: [P.red, P.white],
    image: sprite(
      [".RR.RR.", "RWRRRRR", "RRRRRRR", ".RRRRR.", "..RRR..", "...R..."],
      "RW",
    ),
    slots: 4, rate: 0.9,
    chunk: [2, 4],
  },
  {
    name: "Baum",
    palette: [P.green, P.dgreen, P.brown],
    image: sprite(
      ["...G...", "..GGG..", ".GGDGG.", "GGGGGDG", ".GDGGG.", "GGGGGGG", "...B...", "...B..."],
      "GDB",
    ),
    slots: 4, rate: 0.7,
    chunk: [3, 6],
  },
  {
    name: "Sonne",
    palette: [P.yellow, P.orange],
    image: sprite(
      [
        "....O....",
        ".O..O..O.",
        "..OYYYO..",
        "...YYY...",
        "OOYYYYYOO",
        "...YYY...",
        "..OYYYO..",
        ".O..O..O.",
        "....O....",
      ],
      "YO",
    ),
    slots: 3, rate: 0.5,
    chunk: [3, 6],
  },
  {
    name: "Pilz",
    palette: [P.red, P.white, P.beige],
    image: sprite(
      [
        "...RRRR...",
        ".RRWWRRRR.",
        "RRWWRRRWRR",
        "RRRRRRRRRR",
        "RWRRWWRRWR",
        ".RRRRRRRR.",
        "...BBBB...",
        "...BBBB...",
        "..BBBBBB..",
      ],
      "RWB",
    ),
    slots: 3, rate: 0.35,
    chunk: [4, 8],
  },
  { name: "Ringe", palette: [P.blue, P.yellow, P.red], image: rings(8, 3), slots: 3, rate: 0.25, chunk: [4, 8] },
  { name: "Raute", palette: [P.teal, P.purple, P.orange, P.white], image: diamond(11, 4), slots: 3, rate: 0.15, chunk: [5, 10] },
  { name: "Zielscheibe", palette: [P.red, P.white, P.blue, P.yellow], image: target(12, 4), slots: 2, rate: 0.1, chunk: [6, 12] },
  {
    name: "Kaleidoskop",
    palette: [P.pink, P.teal, P.yellow, P.purple, P.blue],
    image: kaleido(12, 5, 4, 1.4),
    slots: 2, rate: 0.06,
    chunk: [6, 12],
  },
  {
    name: "Blüte",
    palette: [P.pink, P.white, P.yellow, P.orange, P.purple],
    image: kaleido(13, 5, 6, 1.5, 2),
    slots: 2, rate: 0.03,
    chunk: [7, 14],
  },
  {
    name: "Mandala",
    palette: [P.red, P.orange, P.yellow, P.green, P.blue, P.purple],
    image: kaleido(14, 6, 8, 1.2, 2),
    slots: 2, rate: 0.015,
    chunk: [8, 16],
  },
];

function makeBlocks(image: string[], palette: number, chunk: [number, number], rand: () => number) {
  const count = new Array<number>(palette).fill(0);
  for (const row of image) for (const ch of row) if (ch !== ".") count[parseInt(ch, 36)]++;
  const blocks: { color: number; ammo: number }[] = [];
  count.forEach((n, color) => {
    let left = n;
    while (left > 0) {
      const c = Math.min(left, chunk[0] + Math.floor(rand() * (chunk[1] - chunk[0] + 1)));
      blocks.push({ color, ammo: c });
      left -= c;
    }
  });
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  return blocks;
}

mkdirSync(`${OUT}/levels`, { recursive: true });
const manifestLevels: { id: string; file: string; name: string }[] = [];

/** Gewinnrate eines Spielers, der jeden Zug zufällig wählt. */
function randomWinRate(level: PixelLevel, runs: number, rand: () => number): number {
  let wins = 0;
  for (let r = 0; r < runs; r++) {
    const s = createState(level);
    for (;;) {
      while (step(s)) {
        /* schießen */
      }
      const st = status(s);
      if (st === "win") {
        wins++;
        break;
      }
      if (st !== "idle") break;
      const open = s.supply.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
      placeBlock(s, open[Math.floor(rand() * open.length)]);
    }
  }
  return wins / runs;
}

const results: { level: PixelLevel; rate: number; pixels: number }[] = [];

defs.forEach((d, idx) => {
  const id = `tmp${idx}`;
  let slots = d.slots;
  let chosen: PixelLevel | null = null;
  let chosenRate = 0;
  const t0 = Date.now();

  while (!chosen) {
    let bestDist = Infinity;
    for (let seed = 1; seed <= 120; seed++) {
      const level: PixelLevel = {
        id,
        name: d.name,
        palette: d.palette,
        image: d.image,
        slots,
        blocks: makeBlocks(d.image, d.palette.length, d.chunk, rng(seed * 7919 + idx)),
      };
      if (solve(level).result !== "solved") continue;
      const rate = randomWinRate(level, 400, rng(seed + 99));
      const dist = Math.abs(Math.log((rate + 0.005) / (d.rate + 0.005)));
      if (dist < bestDist) {
        bestDist = dist;
        chosen = level;
        chosenRate = rate;
      }
    }
    if (!chosen) {
      slots++;
      if (slots > 8) throw new Error(`Level ${id}: keine lösbare Variante gefunden`);
    }
  }

  const level = parseLevel(chosen); // Validierung
  const pixels = level.image.join("").replace(/\./g, "").length;
  results.push({ level, rate: chosenRate, pixels });
  console.log(
    `${d.name.padEnd(12)} ${level.image[0].length}x${level.image.length}  Farben ${d.palette.length}  Blöcke ${level.blocks.length}  Slots ${level.slots}  Zufalls-Gewinnrate ${(chosenRate * 100).toFixed(1)}%  ${Date.now() - t0}ms`,
  );
});

// Nach gemessener Schwierigkeit sortieren (leicht -> schwer), Rate in 5%-Stufen
results.sort((a, b) => Math.round(b.rate * 20) - Math.round(a.rate * 20) || a.pixels - b.pixels);
console.log("\nReihenfolge:");
results.forEach((r, i) => {
  const id = `l${String(i + 1).padStart(2, "0")}`;
  r.level.id = id;
  writeFileSync(`${OUT}/levels/${id}.json`, JSON.stringify(r.level));
  manifestLevels.push({ id, file: `levels/${id}.json`, name: r.level.name });
  console.log(`${id} ${r.level.name.padEnd(12)} ${(r.rate * 100).toFixed(1)}%`);
});

writeFileSync(
  `${OUT}/manifest.json`,
  JSON.stringify({ id: "classic", name: "Klassik", version: "0.2.0", mode: "pixel", levels: manifestLevels }, null, 2),
);
writeFileSync("public/content/packs.json", JSON.stringify(["classic"]));
console.log("fertig");
