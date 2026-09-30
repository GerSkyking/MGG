/** Verbindung zwischen Spielmodus und App (Menü, Overlay). */
export interface GameHost {
  finish(result: "win" | "lose"): void;
}

/** Schnittstelle, die jeder Spielmodus erfüllen muss. */
export interface GameMode {
  readonly id: string;
  readonly name: string;
  init(level: LevelData, host: GameHost): void;
  update(dt: number): void;
  render(g: CanvasRenderingContext2D, w: number, h: number): void;
  onPointer?(x: number, y: number, type: PointerKind): void;
  destroy?(): void;
}

export type PointerKind = "down" | "move" | "up";

/** Rohdaten eines Levels; der Spielmodus validiert den Inhalt selbst. */
export interface LevelData {
  id: string;
  name: string;
  [key: string]: unknown;
}

/** Beschreibung eines Content-Pakets (Git-Repo oder ZIP). */
export interface PackManifest {
  id: string;
  name: string;
  version: string;
  mode: string;
  levels: { id: string; file: string; name?: string }[];
}
