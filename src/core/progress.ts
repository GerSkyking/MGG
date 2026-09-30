const PREFIX = "mgg.progress.";

export function getCompleted(packKey: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PREFIX + packKey) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function markCompleted(packKey: string, levelId: string): void {
  const s = new Set(getCompleted(packKey));
  s.add(levelId);
  try {
    localStorage.setItem(PREFIX + packKey, JSON.stringify([...s]));
  } catch {
    /* Speicher voll/gesperrt: Fortschritt geht nur verloren, Spiel läuft weiter */
  }
}

export function getUnlockAll(): boolean {
  try {
    return localStorage.getItem("mgg.unlockAll") === "1";
  } catch {
    return false;
  }
}

export function setUnlockAll(v: boolean): void {
  try {
    localStorage.setItem("mgg.unlockAll", v ? "1" : "0");
  } catch {
    /* ignorieren */
  }
}
