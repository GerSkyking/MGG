import type { GameHost, GameMode, LevelData } from "../../core/types";
import {
  JOKER,
  columnLeft,
  createState,
  freeOpenSlots,
  isSlotOpen,
  parseLevel,
  placeBlock,
  status,
  step,
  topState,
  type BlockDef,
  type PixelLevel,
  type State,
} from "./logic";

const SHOT_INTERVAL = 0.09;
const SHOT_TRAVEL = 0.14;
const FADE = 0.25;
const END_DELAY = 0.7;
const VISIBLE = 3; // Karten je Spalte: 1 spielbar, 1 sichtbar, danach verdeckt

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface ColBox {
  box: Rect;
  front: Rect;
}
interface Layout {
  cols: ColBox[];
  slots: Rect[];
  gx: number;
  gy: number;
  cell: number;
  slotsY: number;
  peek: number;
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

function jokerGradient(g: CanvasRenderingContext2D, r: Rect): CanvasGradient {
  const gr = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  const stops = ["#e63946", "#f4d03f", "#3aa655", "#3a86ff", "#9b5de5"];
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
}

function roundRectPath(g: CanvasRenderingContext2D, r: Rect, rad: number): void {
  g.beginPath();
  g.roundRect(r.x, r.y, r.w, r.h, rad);
}

interface CardOpts {
  /** Mittelpunkt für den Text, Standard: Kartenmitte */
  textY?: number;
  fontH?: number;
  alpha?: number;
  linkMark?: boolean;
}

/** Zeichnet eine Karte mit einem oder zwei Teilen (Doppelblock). */
function drawCard(
  g: CanvasRenderingContext2D,
  r: Rect,
  palette: string[],
  parts: { color: number; ammo: number }[],
  o: CardOpts = {},
): void {
  g.globalAlpha = o.alpha ?? 1;
  const n = parts.length;
  g.save();
  roundRectPath(g, r, 8);
  g.clip();
  parts.forEach((p, i) => {
    const pr = { x: r.x + (r.w * i) / n, y: r.y, w: r.w / n, h: r.h };
    g.fillStyle = p.color === JOKER ? jokerGradient(g, pr) : palette[p.color];
    g.fillRect(pr.x, pr.y, pr.w + 1, pr.h);
  });
  g.restore();
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 1.5;
  roundRectPath(g, r, 8);
  g.stroke();
  if (n > 1) {
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(r.x + r.w / 2, r.y + 3);
    g.lineTo(r.x + r.w / 2, r.y + r.h - 3);
    g.stroke();
  }
  const fh = o.fontH ?? Math.floor(r.h * (n > 1 ? 0.34 : 0.42));
  g.font = `bold ${fh}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const ty = o.textY ?? r.y + r.h / 2 + 1;
  parts.forEach((p, i) => {
    const cx = r.x + (r.w * (i + 0.5)) / n;
    const base = p.color === JOKER ? "#333" : palette[p.color];
    g.fillStyle = p.color === JOKER ? "#fff" : textOn(base);
    if (p.color === JOKER) {
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.lineWidth = 3;
      g.strokeText(String(p.ammo), cx, ty);
    }
    g.fillText(String(p.ammo), cx, ty);
  });
  g.globalAlpha = 1;
}

function drawLock(g: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  g.font = `${Math.floor(size)}px system-ui, "Segoe UI Emoji", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  g.fillText("🔒", cx, cy);
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
  let hintColor = "";
  let hintT = 0;
  const flights: Flight[] = [];
  const fades: Fade[] = [];

  function computeLayout(w: number, h: number): Layout {
    const pad = 12;
    const gap = 8;
    const hud = 56;
    const nc = level.columns.length;
    const maxDepth = Math.max(...level.columns.map((c) => c.length));
    const shown = Math.min(VISIBLE, maxDepth);

    let bs = 60;
    let perRow = 1;
    let bands = 1;
    let peek = 0;
    let colH = bs;
    let supplyH = bs;
    for (bs = 60; bs >= 30; bs -= 2) {
      perRow = Math.max(1, Math.floor((w - pad * 2 + gap) / (bs + gap)));
      bands = Math.ceil(nc / perRow);
      peek = Math.round(bs * 0.4);
      colH = bs + (shown - 1) * peek;
      supplyH = bands * colH + (bands - 1) * gap;
      if (supplyH <= h * 0.42) break;
    }
    bs = Math.max(bs, 30);
    const supplyY = h - pad - supplyH;

    const cols: ColBox[] = [];
    for (let i = 0; i < nc; i++) {
      const band = Math.floor(i / perRow);
      const inRow = Math.min(perRow, nc - band * perRow);
      const rowW = inRow * (bs + gap) - gap;
      const sx = Math.round((w - rowW) / 2);
      const x = sx + (i % perRow) * (bs + gap);
      const y0 = supplyY + band * (colH + gap);
      cols.push({
        box: { x, y: y0, w: bs, h: colH },
        front: { x, y: y0 + colH - bs, w: bs, h: bs },
      });
    }

    const n = level.slots;
    const sbs = Math.min(bs, Math.floor((w - pad * 2 - gap * (n - 1)) / n));
    const slotsW = n * (sbs + gap) - gap;
    const slx = Math.round((w - slotsW) / 2);
    const slotsY = supplyY - pad * 2 - sbs;
    const slots: Rect[] = [];
    for (let i = 0; i < n; i++) slots.push({ x: slx + i * (sbs + gap), y: slotsY, w: sbs, h: sbs });

    const areaTop = hud + pad;
    const areaBottom = slotsY - pad - 14;
    const areaH = Math.max(40, areaBottom - areaTop);
    const cell = Math.max(4, Math.floor(Math.min((w - pad * 2) / s.w, areaH / s.h)));
    const gx = Math.round((w - cell * s.w) / 2);
    const gy = Math.round(areaTop + (areaH - cell * s.h) / 2);
    return { cols, slots, gx, gy, cell, slotsY, peek };
  }

  const center = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

  function say(text: string, color = ""): void {
    hint = text;
    hintColor = color;
    hintT = 1.8;
  }

  function drawSupply(g: CanvasRenderingContext2D, L: Layout): void {
    level.columns.forEach((_, ci) => {
      const cb = L.cols[ci];
      const left = columnLeft(s, ci);
      if (left === 0) return;
      const st = topState(s, ci);
      const n = Math.min(VISIBLE, left);
      // hinten zuerst
      for (let k = n - 1; k >= 0; k--) {
        const b: BlockDef = s.cols[ci][s.head[ci] + k];
        const r: Rect = { x: cb.front.x, y: cb.front.y - k * L.peek, w: cb.front.w, h: cb.front.h };
        const parts = b.link ? [b, b.link] : [b];
        if (st === "fog") {
          g.fillStyle = "#3a3a3a";
          roundRectPath(g, r, 8);
          g.fill();
          g.strokeStyle = "rgba(255,255,255,0.2)";
          g.lineWidth = 1.5;
          g.stroke();
          if (k === 0) {
            g.fillStyle = "#aaa";
            g.font = `bold ${Math.floor(r.h * 0.42)}px system-ui, sans-serif`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText("?", r.x + r.w / 2, r.y + r.h / 2);
            drawLock(g, r.x + r.w - 10, r.y + 11, r.h * 0.28);
          }
        } else if (k === 0) {
          drawCard(g, r, level.palette, parts);
          if (st === "key") {
            g.fillStyle = "rgba(0,0,0,0.5)";
            roundRectPath(g, r, 8);
            g.fill();
            drawLock(g, r.x + r.w / 2, r.y + r.h / 2, r.h * 0.5);
            g.fillStyle = level.palette[b.lock as number];
            g.strokeStyle = "#fff";
            g.lineWidth = 2;
            g.beginPath();
            g.arc(r.x + 10, r.y + 10, 7, 0, Math.PI * 2);
            g.fill();
            g.stroke();
          }
        } else if (k === 1) {
          drawCard(g, r, level.palette, parts, { textY: r.y + L.peek / 2, fontH: Math.floor(L.peek * 0.78), alpha: 0.75 });
          drawLock(g, r.x + r.w - 9, r.y + L.peek / 2, L.peek * 0.7);
        } else {
          g.fillStyle = "#3a3a3a";
          roundRectPath(g, r, 8);
          g.fill();
          g.strokeStyle = "rgba(255,255,255,0.2)";
          g.lineWidth = 1.5;
          g.stroke();
          g.fillStyle = "#aaa";
          g.font = `bold ${Math.floor(L.peek * 0.8)}px system-ui, sans-serif`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText("?", r.x + r.w / 2 - 6, r.y + L.peek / 2);
          drawLock(g, r.x + r.w / 2 + 8, r.y + L.peek / 2, L.peek * 0.7);
        }
      }
      if (left > VISIBLE) {
        g.fillStyle = "#ccc";
        g.font = "bold 11px system-ui, sans-serif";
        g.textAlign = "left";
        g.textBaseline = "alphabetic";
        g.fillText(`+${left - VISIBLE}`, cb.box.x + 2, cb.box.y - 3);
      }
    });
  }

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
      hintT = 0;
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
          if (r.destroyed) fades.push({ cell: r.cell, color: level.palette[r.color], age: 0 });
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
          const px = L.gx + x * L.cell + inner;
          const py = L.gy + y * L.cell + inner;
          const sz = L.cell - inner * 2;
          g.fillStyle = level.palette[v];
          g.fillRect(px, py, sz, sz);
          if (s.hp[y * s.w + x] > 1) {
            // hartes Pixel: dunkler Rahmen + Kreuz
            const lw = Math.max(2, sz * 0.16);
            g.strokeStyle = "rgba(0,0,0,0.75)";
            g.lineWidth = lw;
            g.strokeRect(px + lw / 2, py + lw / 2, sz - lw, sz - lw);
            g.strokeStyle = "rgba(255,255,255,0.45)";
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(px + lw, py + lw);
            g.lineTo(px + sz - lw, py + sz - lw);
            g.stroke();
          }
        }
      }
      for (const f of fades) {
        const k = 1 - f.age / FADE;
        const col = f.cell % s.w;
        const row = Math.floor(f.cell / s.w);
        const size = (L.cell - inner * 2) * k;
        g.globalAlpha = k;
        g.fillStyle = f.color;
        g.fillRect(L.gx + (col + 0.5) * L.cell - size / 2, L.gy + (row + 0.5) * L.cell - size / 2, size, size);
        g.globalAlpha = 1;
      }

      // Slots
      for (let i = 0; i < L.slots.length; i++) {
        const r = L.slots[i];
        const b = s.slots[i];
        if (!isSlotOpen(s, i)) {
          g.fillStyle = "#262626";
          roundRectPath(g, r, 8);
          g.fill();
          g.strokeStyle = "#555";
          g.lineWidth = 2;
          g.stroke();
          drawLock(g, r.x + r.w / 2, r.y + r.h * 0.38, r.h * 0.4);
          g.fillStyle = "#ddd";
          g.font = `bold ${Math.floor(r.h * 0.28)}px system-ui, sans-serif`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText(String(s.open[i] - s.shots), r.x + r.w / 2, r.y + r.h * 0.76);
        } else if (b) {
          drawCard(g, r, level.palette, [b]);
          if (b.linked) {
            g.fillStyle = "#fff";
            g.font = `${Math.floor(r.h * 0.26)}px system-ui, "Segoe UI Emoji", sans-serif`;
            g.textAlign = "right";
            g.textBaseline = "top";
            g.fillText("🔗", r.x + r.w - 2, r.y + 2);
          }
        } else {
          g.strokeStyle = "#555";
          g.lineWidth = 2;
          g.setLineDash([5, 5]);
          roundRectPath(g, r, 8);
          g.stroke();
          g.setLineDash([]);
        }
      }

      drawSupply(g, L);

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
        g.font = "14px system-ui, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        const tw = g.measureText(hint).width;
        const chip = hintColor ? 22 : 0;
        const x0 = w / 2 - (tw + chip) / 2;
        if (hintColor) {
          g.fillStyle = hintColor;
          g.strokeStyle = "#fff";
          g.lineWidth = 2;
          g.beginPath();
          g.arc(x0 + 8, L.slotsY - 15, 7, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        g.fillStyle = "#ddd";
        g.textAlign = "left";
        g.fillText(hint, x0 + chip, L.slotsY - 10);
      }
    },

    onPointer(x, y, type) {
      if (type !== "down" || finished || !layout) return;
      const L = layout;

      const si = L.slots.findIndex((r) => inside(r, x, y));
      if (si >= 0 && !isSlotOpen(s, si)) {
        say(`Slot öffnet nach ${s.open[si] - s.shots} Schüssen`);
        return;
      }

      const ci = L.cols.findIndex((c) => inside(c.box, x, y));
      if (ci < 0 || columnLeft(s, ci) === 0) return;
      if (status(s) !== "idle") return; // während des Schießens gesperrt

      const front = L.cols[ci].front;
      if (!inside(front, x, y)) {
        say("Verdeckt: erst den Block davor setzen");
        return;
      }
      const st = topState(s, ci);
      if (st === "fog") {
        say("Noch verdeckt: erst einen anderen Block setzen");
        return;
      }
      if (st === "key") {
        const b = s.cols[ci][s.head[ci]];
        say("Gesperrt: erst alle Pixel dieser Farbe abschießen", level.palette[b.lock as number]);
        return;
      }
      if (placeBlock(s, ci).length === 0) {
        const b = s.cols[ci][s.head[ci]];
        say(b.link && freeOpenSlots(s).length === 1 ? "Doppelblock braucht 2 freie Slots" : "Kein freier Slot");
      }
    },
  };
}
