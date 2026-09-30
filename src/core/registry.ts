import type { GameMode } from "./types";

type ModeFactory = () => GameMode;
type Validator = (raw: unknown) => void;

const modes = new Map<string, { factory: ModeFactory; validate: Validator }>();

export function registerMode(id: string, factory: ModeFactory, validate: Validator = () => {}): void {
  modes.set(id, { factory, validate });
}

export function hasMode(id: string): boolean {
  return modes.has(id);
}

export function createMode(id: string): GameMode {
  const m = modes.get(id);
  if (!m) throw new Error(`Unbekannter Spielmodus: ${id}`);
  return m.factory();
}

/** Wirft einen Fehler, wenn das Level für den Modus ungültig ist. */
export function validateLevel(modeId: string, raw: unknown): void {
  const m = modes.get(modeId);
  if (!m) throw new Error(`Unbekannter Spielmodus: ${modeId}`);
  m.validate(raw);
}
