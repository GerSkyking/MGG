import type { GameHost, GameMode, LevelData } from "../../core/types";
import {
  createState,
  parseLevel,
  placeBlock,
  status,
  step,
  type PixelLevel,
  type State,
} from "./logic";

const SHOT_INTERVAL = 0.09;
const SHOT_TRAVEL = 0.14;
const FADE = 0.25;
const END_DELAY = 0.7;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Layout {
  supply: Rect[];
  slots: Rect[];
  gx: number;
  gy: number;
  cell: number;
  slotsY: number;
}
interface Flight {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  color: string;
  age: number;
}
interface Fade {
  cell: number;
  color: string;
  age: number;
}

const inside = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function textOn(hex: string): string {
  let c = hex.slice(1);
  if (c.length === 3 || c.length === 4) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111" : "#fff";
}

function drawBlock(g: CanvasRenderingContext2D, r: Rect, color: string, ammo: number): void {
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(r.x, r.y, r.w, r.h, 8);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = textOn(color);
  g.font = `bold ${Math.floor(r.h * 0.42)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(ammo), r.x + r.w / 2, r.y + r.h / 2 + 1);
}

export function validatePixelLevel(raw: unknown): void {
  parseLevel(raw);
}

export function createPixelMode(): GameMode {
  let level: PixelLevel;
  let s: State;
  let host: GameHost;
  let layout: Layout | null = null;
  let acc = 0;
  let endWait = 0;
  let finished = false;
  let hint = "";
  let hintT = 0;
  const flights: Flight[] = [];
  const fades: Fade[] = [];

  function computeLayout(w: number, h: number): Layout {
    const pad = 12;
    const gap = 8;
    const hud = 56;
    const n = level.blocks.length;
    const bs = Math.max(34, Math.min(60, Math.floor((w - pad * 2 - gap * 5) / 6)));
    const cols = Math.max(1, Math.floor((w - pad * 2 + gap) / (bs + gap)));
    const rows = Math.ceil(n / cols);
    const supplyW = Math.min(n, cols) * (bs + gap) - gap;
    const sx = Math.round((w - supplyW) / 2);
    const supplyH = rows * (bs + gap) - gap;
    const supplyY = h - pad - supplyH;

    const supply: Rect[] = [];
    for (let i = 0; i < n; i++) {
      supply.push({ x: sx + (i % cols) * (bs + gap), y: supplyY + Math.floor(i / cols) * (bs + gap), w: bs, h: bs });
    }

    const slotsN = level.slots;
    const slotsW = slotsN * (bs + gap) - gap;
    const slx = Math.round((w - slotsW) / 2);
    const slotsY = supplyY - pad * 2 - bs;
    const slots: Rect[] = [];
    for (let i = 0; i < slotsN; i++) slots.push({ x: slx + i * (bs + gap), y: slotsY, w: bs, h: bs });

    const areaTop = hud + pad;
    const areaBottom = slotsY - pad - 14;
    const areaH = Math.max(40, areaBottom - areaTop);
    const cell = Math.max(4, Math.floor(Math.min((w - pad * 2) / s.w, areaH / s.h)));
    const gx = Math.round((w - cell * s.w) / 2);
    const gy = Math.round(areaTop + (areaH - cell * s.h) / 2);
    return { supply, slots, gx, gy, cell, slotsY };
  }

  const center = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

  return {
    id: "pixel",
    name: "Pixel-Modus",

    init(raw: LevelData, h: GameHost) {
      level = parseLevel(raw);
      s = createState(level);
      host = h;
      layout = null;
      acc = 0;
      endWait = 0;
      finished = false;
      hint = "";
      flights.length = 0;
      fades.length = 0;
    },

    update(dt) {
      for (const f of flights) f.age += dt;
      for (const f of fades) f.age += dt;
      while (flights.length && flights[0].age > SHOT_TRAVEL) flights.shift();
      while (fades.length && fades[0].age > FADE) fades.shift();
      if (hintT > 0) hintT -= dt;
      if (finished || !layout) return;

      const st = status(s);
      if (st === "shooting") {
        endWait = 0;
        acc += dt;
        while (acc >= SHOT_INTERVAL) {
          acc -= SHOT_INTERVAL;
          const r = step(s);
          if (!r) break;
          const from = center(layout.slots[r.slot]);
          const col = r.cell % s.w;
          const row = Math.floor(r.cell / s.w);
          flights.push({
            fx: from[0],
            fy: from[1],
            tx: layout.gx + (col + 0.5) * layout.cell,
            ty: layout.gy + (row + 0.5) * layout.cell,
            color: level.palette[r.color],
            age: 0,
          });
          fades.push({ cell: r.cell, color: level.palette[r.color], age: 0 });
        }
      } else {
        acc = 0;
        if (st === "win" || st === "lose") {
          endWait += dt;
          if (endWait >= END_DELAY) {
            finished = true;
            host.finish(st);
          }
        }
      }
    },

    render(g, w, h) {
      layout = computeLayout(w, h);
      const L = layout;

      g.fillStyle = "#151515";
      g.fillRect(0, 0, w, h);

      // Bild
      g.fillStyle = "#1d1d1d";
      g.beginPath();
      g.roundRect(L.gx - 6, L.gy - 6, L.cell * s.w + 12, L.cell * s.h + 12, 10);
      g.fill();
      const inner = Math.max(1, Math.floor(L.cell * 0.06));
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          const v = s.grid[y * s.w + x];
          if (v < 0) continue;
          g.fillStyle = level.palette[v];
          g.fillRect(L.gx + x * L.cell + inner, L.gy + y * L.cell + inner, L.cell - inner * 2, L.cell - inner * 2);
        }
      }
      for (const f of fades) {
        const k = 1 - f.age / FADE;
        const col = f.cell % s.w;
        const row = Math.floor(f.cell / s.w);
        const size = (L.cell - inner * 2) * k;
        g.globalAlpha = k;
        g.fillStyle = f.color;
        g.fillRect(
          L.gx + (col + 0.5) * L.cell - size / 2,
          L.gy + (row + 0.5) * L.cell - size / 2,
          size,
          size,
        );
        g.globalAlpha = 1;
      }

      // Slots
      for (let i = 0; i < L.slots.length; i++) {
        const r = L.slots[i];
        const b = s.slots[i];
        if (b) {
          drawBlock(g, r, level.palette[b.color], b.ammo);
        } else {
          g.strokeStyle = "#555";
          g.lineWidth = 2;
          g.setLineDash([5, 5]);
          g.beginPath();
          g.roundRect(r.x, r.y, r.w, r.h, 8);
          g.stroke();
          g.setLineDash([]);
        }
      }

      // Vorrat
      for (let i = 0; i < L.supply.length; i++) {
        const b = s.supply[i];
        if (b) drawBlock(g, L.supply[i], level.palette[b.color], b.ammo);
      }

      // Schüsse
      for (const f of flights) {
        const k = Math.min(1, f.age / SHOT_TRAVEL);
        g.fillStyle = f.color;
        g.strokeStyle = "#fff";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(f.fx + (f.tx - f.fx) * k, f.fy + (f.ty - f.fy) * k, Math.max(3, L.cell * 0.22), 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }

      if (hintT > 0 && hint) {
        g.fillStyle = "#ddd";
        g.font = "14px system-ui, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        g.fillText(hint, w / 2, L.slotsY - 10);
      }
    },

    onPointer(x, y, type) {
      if (type !== "down" || finished || !layout) return;
      const idx = layout.supply.findIndex((r, i) => s.supply[i] !== null && inside(r, x, y));
      if (idx < 0) return;
      const st = status(s);
      if (st !== "idle") return; // während des Schießens gesperrt
      if (placeBlock(s, idx) < 0) {
        hint = "Kein freier Slot";
        hintT = 1.2;
      }
    },
  };
}
