import { strFromU8, unzipSync } from "fflate";
import { hasMode, validateLevel } from "../core/registry";
import type { PackManifest } from "../core/types";

export interface LoadedPack {
  /** Eindeutiger Schlüssel für den Fortschritt, z.B. "builtin:classic" */
  key: string;
  source: "builtin" | "imported";
  manifest: PackManifest;
  /** Download-URL des Archivs (nur bei importierten Paketen aus dem Netz), für Updates */
  sourceUrl?: string;
  loadLevel(file: string): Promise<unknown>;
}

interface StoredPack {
  id: string;
  manifest: PackManifest;
  files: Record<string, string>;
  sourceUrl?: string;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const PATH_RE = /^[A-Za-z0-9_\-./]+$/;
const MAX_ZIP = 20 * 1024 * 1024;

function isSafePath(p: string): boolean {
  return PATH_RE.test(p) && !p.includes("..") && !p.startsWith("/");
}

export function parseManifest(raw: unknown): PackManifest {
  const bad = (m: string): never => {
    throw new Error("manifest.json ungültig: " + m);
  };
  if (typeof raw !== "object" || raw === null) bad("kein Objekt");
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID_RE.test(r.id)) bad("id");
  if (typeof r.name !== "string" || !r.name || r.name.length > 100) bad("name");
  if (typeof r.version !== "string" || r.version.length > 32) bad("version");
  if (typeof r.mode !== "string" || !hasMode(r.mode)) bad(`unbekannter Modus '${String(r.mode)}'`);
  if (!Array.isArray(r.levels) || r.levels.length < 1 || r.levels.length > 500) bad("levels");
  const levels = (r.levels as unknown[]).map((l) => {
    const ll = l as Record<string, unknown> | null;
    if (
      typeof ll !== "object" ||
      ll === null ||
      typeof ll.id !== "string" ||
      !ID_RE.test(ll.id) ||
      typeof ll.file !== "string" ||
      !isSafePath(ll.file)
    )
      return bad("Level-Eintrag");
    const entry: { id: string; file: string; name?: string } = { id: ll.id, file: ll.file };
    if (typeof ll.name === "string") entry.name = ll.name.slice(0, 100);
    return entry;
  });
  return { id: r.id as string, name: r.name as string, version: r.version as string, mode: r.mode as string, levels };
}

// ---------- eingebaute Pakete (liegen im Build unter content/) ----------

export async function loadBuiltinPacks(): Promise<LoadedPack[]> {
  const res = await fetch("content/packs.json");
  if (!res.ok) throw new Error(`packs.json: HTTP ${res.status}`);
  const ids: unknown = await res.json();
  if (!Array.isArray(ids)) throw new Error("packs.json ungültig");
  const out: LoadedPack[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !ID_RE.test(id)) continue;
    const mr = await fetch(`content/${id}/manifest.json`);
    if (!mr.ok) continue;
    const manifest = parseManifest(await mr.json());
    out.push({
      key: `builtin:${manifest.id}`,
      source: "builtin",
      manifest,
      async loadLevel(file: string) {
        if (!isSafePath(file)) throw new Error("Ungültiger Dateipfad");
        const r = await fetch(`content/${id}/${file}`);
        if (!r.ok) throw new Error(`Level-Datei nicht ladbar (HTTP ${r.status})`);
        return r.json();
      },
    });
  }
  return out;
}

// ---------- importierte Pakete (IndexedDB) ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("mgg", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("packs", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction("packs", mode).objectStore("packs"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadImportedPacks(): Promise<LoadedPack[]> {
  const all = await withStore<StoredPack[]>("readonly", (s) => s.getAll() as IDBRequest<StoredPack[]>);
  return all.map((p) => ({
    key: `imported:${p.id}`,
    source: "imported" as const,
    manifest: p.manifest,
    sourceUrl: p.sourceUrl,
    async loadLevel(file: string) {
      const text = p.files[file];
      if (text === undefined) throw new Error(`Level-Datei fehlt: ${file}`);
      return JSON.parse(text);
    },
  }));
}

export async function deleteImportedPack(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

const baseName = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/** Liest nur die manifest.json aus einem ZIP (Git-Archive haben oft einen Top-Ordner). */
export function readManifest(data: Uint8Array): { manifest: PackManifest; prefix: string } {
  if (data.length > MAX_ZIP) throw new Error("ZIP zu groß (max. 20 MB)");
  let found: Record<string, Uint8Array>;
  try {
    found = unzipSync(data, {
      filter: (f) => !f.name.startsWith("__MACOSX/") && baseName(f.name) === "manifest.json" && f.originalSize < 200_000,
    });
  } catch {
    throw new Error("Keine gültige ZIP-Datei");
  }
  const names = Object.keys(found).sort((a, b) => a.split("/").length - b.split("/").length);
  if (!names.length) throw new Error("manifest.json nicht im ZIP gefunden");
  const mpath = names[0];
  const prefix = mpath.slice(0, mpath.length - "manifest.json".length);
  try {
    return { manifest: parseManifest(JSON.parse(strFromU8(found[mpath]))), prefix };
  } catch (e) {
    throw e instanceof SyntaxError ? new Error("manifest.json ist kein gültiges JSON") : e;
  }
}

/** Vergleicht Versionen wie "1.2.10" numerisch. >0: a ist neuer als b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ---------- Download (Git/Gitea) ----------

/** Nur diese Gitea-Instanz läuft über den nginx-Proxy /gitproxy/ (umgeht fehlendes CORS). */
const PROXY_HOST = "git.jensr.de";
const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/;

/** Macht aus einer Repo-URL (https://host/user/repo) + Branch/Tag eine Archiv-URL; ZIP-URLs bleiben unverändert. */
export function toArchiveUrl(input: string, ref: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new Error("Ungültige URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Bitte eine http(s)-URL angeben");
  if (/\.zip$/i.test(u.pathname)) return u.toString();
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) throw new Error("URL nicht erkannt: Repo-URL (…/user/repo) oder ZIP-Link angeben");
  const r = ref.trim() || "main";
  if (!REF_RE.test(r) || r.includes("..")) throw new Error("Ungültiger Branch/Tag");
  const repo = parts[1].replace(/\.git$/i, "");
  return `${u.origin}/${parts[0]}/${repo}/archive/${r}.zip`;
}

const isNative = (): boolean =>
  !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

/** Leitet Downloads von der eigenen Gitea über den Proxy, alle anderen direkt. */
export function resolveFetchUrl(url: string): string {
  const u = new URL(url);
  if (u.protocol === "https:" && u.host === PROXY_HOST && !isNative()) return "gitproxy" + u.pathname + u.search;
  return url;
}

export async function downloadZip(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(resolveFetchUrl(url));
  } catch {
    throw new Error("Download fehlgeschlagen (Netzwerk oder CORS des Servers)");
  }
  if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_ZIP) throw new Error("ZIP zu groß (max. 20 MB)");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_ZIP) throw new Error("ZIP zu groß (max. 20 MB)");
  return buf;
}

async function getStored(id: string): Promise<StoredPack | undefined> {
  return withStore<StoredPack | undefined>("readonly", (s) => s.get(id) as IDBRequest<StoredPack | undefined>);
}

/** Liest ein ZIP (Git-Archiv oder eigenes Paket), validiert und speichert es. */
export async function importZip(data: Uint8Array, sourceUrl?: string): Promise<PackManifest> {
  const { manifest, prefix } = readManifest(data);

  const wanted = new Map<string, string>();
  for (const l of manifest.levels) wanted.set(prefix + l.file, l.file);
  const lv = unzipSync(data, { filter: (f) => wanted.has(f.name) && f.originalSize < 1_000_000 });

  const files: Record<string, string> = {};
  for (const [zipName, file] of wanted) {
    const d = lv[zipName];
    if (!d) throw new Error(`Level-Datei fehlt im ZIP: ${file}`);
    const text = strFromU8(d);
    try {
      validateLevel(manifest.mode, JSON.parse(text));
    } catch (e) {
      throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
    files[file] = text;
  }

  const old = await getStored(manifest.id).catch(() => undefined);
  const rec: StoredPack = { id: manifest.id, manifest, files, sourceUrl: sourceUrl ?? old?.sourceUrl };
  await withStore("readwrite", (s) => s.put(rec));
  return manifest;
}
