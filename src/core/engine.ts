import type { GameHost, GameMode, LevelData } from "./types";

export class Engine {
  private g: CanvasRenderingContext2D;
  private mode: GameMode | null = null;
  private last = 0;
  private raf = 0;
  private w = 0;
  private h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D nicht verfügbar");
    this.g = ctx;
    window.addEventListener("resize", () => this.resize());
    for (const type of ["down", "move", "up"] as const) {
      canvas.addEventListener(`pointer${type}`, (e) => {
        const r = canvas.getBoundingClientRect();
        this.mode?.onPointer?.(e.clientX - r.left, e.clientY - r.top, type);
      });
    }
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start(mode: GameMode, level: LevelData, host: GameHost): void {
    this.stop();
    this.resize();
    this.mode = mode;
    mode.init(level, host);
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.mode?.destroy?.();
    this.mode = null;
  }

  private loop(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (this.mode) {
      this.mode.update(dt);
      this.g.clearRect(0, 0, this.w, this.h);
      this.mode.render(this.g, this.w, this.h);
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }
  }
}
