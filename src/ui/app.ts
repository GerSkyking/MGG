import {
  compareVersions,
  deleteImportedPack,
  downloadZip,
  importZip,
  loadBuiltinPacks,
  loadImportedPacks,
  readManifest,
  toArchiveUrl,
  type LoadedPack,
} from "../content/packs";
import type { Engine } from "../core/engine";
import { getCompleted, getUnlockAll, markCompleted, setUnlockAll } from "../core/progress";
import { createMode, validateLevel } from "../core/registry";
import type { LevelData } from "../core/types";

const MAX_DOWNLOAD = 20 * 1024 * 1024;

interface PendingUpdate {
  data: Uint8Array;
  version: string;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = h("button", cls, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class App {
  private packs: LoadedPack[] = [];
  private menu = h("div", "screen");
  private hud = h("div", "hud hidden");
  private hudTitle = h("span", "hud-title");
  private overlay = h("div", "overlay hidden");
  private current: { pack: LoadedPack; index: number } | null = null;
  private msg: { text: string; error: boolean } | null = null;
  private loadError = "";
  private packMsg = new Map<string, { text: string; error: boolean }>();
  private pending = new Map<string, PendingUpdate>();

  constructor(
    root: HTMLElement,
    private canvas: HTMLCanvasElement,
    private engine: Engine,
  ) {
    const back = button("←", "btn icon", () => this.showMenu());
    back.setAttribute("aria-label", "Zurück zum Menü");
    const restart = button("↻", "btn icon", () => {
      if (this.current) void this.startLevel(this.current.pack, this.current.index);
    });
    restart.setAttribute("aria-label", "Level neu starten");
    this.hud.append(back, this.hudTitle, restart);
    root.append(this.menu, this.hud, this.overlay);
  }

  async init(): Promise<void> {
    await this.reloadPacks();
    this.showMenu();
  }

  private async reloadPacks(): Promise<void> {
    this.loadError = "";
    let builtin: LoadedPack[] = [];
    let imported: LoadedPack[] = [];
    try {
      builtin = await loadBuiltinPacks();
    } catch (e) {
      this.loadError = "Eingebaute Pakete nicht ladbar: " + errText(e);
    }
    try {
      imported = await loadImportedPacks();
    } catch {
      /* IndexedDB nicht verfügbar */
    }
    this.packs = [...builtin, ...imported];
  }

  private setMsg(text: string, error: boolean): void {
    this.msg = { text, error };
  }

  showMenu(): void {
    this.engine.stop();
    this.canvas.style.display = "none";
    this.hud.classList.add("hidden");
    this.overlay.classList.add("hidden");
    this.menu.classList.remove("hidden");
    this.renderMenu();
  }

  private renderMenu(): void {
    const wrap = h("div", "menu-inner");
    wrap.append(h("h1", "logo", "MGG"), h("p", "sub", "Puzzle-Spiele – offline spielbar"));
    if (this.loadError) wrap.append(h("p", "msg error", this.loadError));

    const unlockAll = getUnlockAll();
    for (const pack of this.packs) {
      const done = new Set(getCompleted(pack.key));
      const sec = h("section", "pack");
      const head = h("div", "pack-head");
      head.append(
        h("h2", "", pack.manifest.name),
        h("span", "tag", `v${pack.manifest.version} · ${pack.manifest.mode}${pack.source === "imported" ? " · importiert" : ""}`),
      );
      sec.append(head);

      const grid = h("div", "levels");
      pack.manifest.levels.forEach((lv, i) => {
        const isDone = done.has(lv.id);
        const unlocked = unlockAll || i === 0 || done.has(pack.manifest.levels[i - 1].id);
        const b = h("button", "level" + (isDone ? " done" : ""));
        b.type = "button";
        b.disabled = !unlocked;
        b.textContent = unlocked ? String(i + 1) + (isDone ? " ✓" : "") : "🔒";
        b.title = lv.name ?? "";
        b.setAttribute("aria-label", `Level ${i + 1}${lv.name ? " " + lv.name : ""}`);
        b.addEventListener("click", () => void this.startLevel(pack, i));
        grid.append(b);
      });
      sec.append(grid);
      if (pack.source === "imported") {
        const acts = h("div", "row");
        if (pack.sourceUrl) {
          acts.append(button("Auf Update prüfen", "btn small", () => void this.checkUpdate(pack)));
          const up = this.pending.get(pack.manifest.id);
          if (up) acts.append(button(`Auf v${up.version} aktualisieren`, "btn small primary", () => void this.applyUpdate(pack)));
        }
        acts.append(button("Paket löschen", "btn small danger", () => void this.removePack(pack)));
        sec.append(acts);
        const pm = this.packMsg.get(pack.manifest.id);
        if (pm) sec.append(h("p", "msg" + (pm.error ? " error" : ""), pm.text));
      }
      wrap.append(sec);
    }

    // Pakete laden
    const imp = h("section", "pack");
    imp.append(h("h2", "", "Pakete laden"));
    imp.append(h("p", "note", "ZIP-Datei, ZIP-Link oder Git-Repo (https://git.jensr.de/user/repo + Branch/Tag) mit manifest.json."));

    const file = h("input", "file");
    file.type = "file";
    file.accept = ".zip,application/zip";
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      if (f) void this.importFile(f);
    });
    imp.append(file);

    const row = h("div", "row");
    const url = h("input", "input");
    url.type = "url";
    url.placeholder = "https://git.jensr.de/user/repo";
    url.setAttribute("aria-label", "Repo- oder ZIP-URL");
    const ref = h("input", "input");
    ref.placeholder = "main";
    ref.style.maxWidth = "7rem";
    ref.setAttribute("aria-label", "Branch oder Tag");
    try {
      url.value = localStorage.getItem("mgg.lastUrl") ?? "";
      ref.value = localStorage.getItem("mgg.lastRef") ?? "";
    } catch {
      /* ignorieren */
    }
    row.append(url, ref, button("Laden", "btn primary", () => void this.importUrl(url.value.trim(), ref.value.trim())));
    imp.append(row);
    if (this.msg) imp.append(h("p", "msg" + (this.msg.error ? " error" : ""), this.msg.text));
    wrap.append(imp);

    const opt = h("label", "check");
    const cb = h("input");
    cb.type = "checkbox";
    cb.checked = unlockAll;
    cb.addEventListener("change", () => {
      setUnlockAll(cb.checked);
      this.renderMenu();
    });
    opt.append(cb, document.createTextNode(" Alle Level freischalten (Test)"));
    wrap.append(opt);

    this.menu.replaceChildren(wrap);
  }

  private async importFile(f: File): Promise<void> {
    if (f.size > MAX_DOWNLOAD) {
      this.setMsg("ZIP zu groß (max. 20 MB)", true);
      this.renderMenu();
      return;
    }
    await this.doImport(new Uint8Array(await f.arrayBuffer()));
  }

  private async importUrl(input: string, ref: string): Promise<void> {
    let zipUrl: string;
    try {
      zipUrl = toArchiveUrl(input, ref);
    } catch (e) {
      this.setMsg(errText(e), true);
      this.renderMenu();
      return;
    }
    try {
      localStorage.setItem("mgg.lastUrl", input);
      localStorage.setItem("mgg.lastRef", ref);
    } catch {
      /* ignorieren */
    }
    this.setMsg("Lade …", false);
    this.renderMenu();
    try {
      await this.doImport(await downloadZip(zipUrl), zipUrl);
    } catch (e) {
      this.setMsg(errText(e), true);
      this.renderMenu();
    }
  }

  /** Lädt das Archiv der Quelle und vergleicht die Manifest-Version mit der installierten. */
  private async checkUpdate(pack: LoadedPack): Promise<void> {
    const id = pack.manifest.id;
    this.pending.delete(id);
    this.packMsg.set(id, { text: "Prüfe …", error: false });
    this.renderMenu();
    try {
      const data = await downloadZip(pack.sourceUrl as string);
      const { manifest } = readManifest(data);
      if (manifest.id !== id) throw new Error(`Quelle enthält ein anderes Paket ('${manifest.id}')`);
      if (compareVersions(manifest.version, pack.manifest.version) > 0) {
        this.pending.set(id, { data, version: manifest.version });
        this.packMsg.set(id, { text: `Update verfügbar: v${manifest.version} (installiert: v${pack.manifest.version})`, error: false });
      } else {
        this.packMsg.set(id, { text: `Bereits aktuell (v${pack.manifest.version})`, error: false });
      }
    } catch (e) {
      this.packMsg.set(id, { text: errText(e), error: true });
    }
    this.renderMenu();
  }

  private async applyUpdate(pack: LoadedPack): Promise<void> {
    const id = pack.manifest.id;
    const up = this.pending.get(id);
    if (!up) return;
    try {
      const m = await importZip(up.data, pack.sourceUrl);
      this.pending.delete(id);
      await this.reloadPacks();
      this.packMsg.set(id, { text: `Aktualisiert auf v${m.version} (${m.levels.length} Level)`, error: false });
    } catch (e) {
      this.packMsg.set(id, { text: errText(e), error: true });
    }
    this.renderMenu();
  }

  private async doImport(data: Uint8Array, sourceUrl?: string): Promise<void> {
    try {
      const m = await importZip(data, sourceUrl);
      this.pending.delete(m.id);
      this.packMsg.delete(m.id);
      await this.reloadPacks();
      this.setMsg(`Importiert: ${m.name} v${m.version} (${m.levels.length} Level)`, false);
    } catch (e) {
      this.setMsg(errText(e), true);
    }
    this.renderMenu();
  }

  private async removePack(pack: LoadedPack): Promise<void> {
    await deleteImportedPack(pack.manifest.id);
    this.pending.delete(pack.manifest.id);
    this.packMsg.delete(pack.manifest.id);
    await this.reloadPacks();
    this.setMsg(`Gelöscht: ${pack.manifest.name}`, false);
    this.renderMenu();
  }

  async startLevel(pack: LoadedPack, index: number): Promise<void> {
    const entry = pack.manifest.levels[index];
    try {
      const raw = await pack.loadLevel(entry.file);
      validateLevel(pack.manifest.mode, raw);
      const mode = createMode(pack.manifest.mode);
      this.current = { pack, index };
      this.menu.classList.add("hidden");
      this.overlay.classList.add("hidden");
      this.hud.classList.remove("hidden");
      this.hudTitle.textContent = `${index + 1}. ${entry.name ?? (raw as LevelData).name}`;
      this.canvas.style.display = "block";
      this.engine.start(mode, raw as LevelData, { finish: (r) => this.onFinish(r) });
    } catch (e) {
      this.setMsg(`Level ${index + 1}: ${errText(e)}`, true);
      this.showMenu();
    }
  }

  private onFinish(result: "win" | "lose"): void {
    const cur = this.current;
    if (!cur) return;
    const { pack, index } = cur;
    const card = h("div", "card");
    if (result === "win") {
      markCompleted(pack.key, pack.manifest.levels[index].id);
      card.append(h("h2", "", "Geschafft! 🎉"), h("p", "", "Alle Pixel sind weg."));
      if (index + 1 < pack.manifest.levels.length) {
        card.append(button("Nächstes Level", "btn primary", () => void this.startLevel(pack, index + 1)));
      }
      card.append(button("Nochmal", "btn", () => void this.startLevel(pack, index)));
    } else {
      card.append(h("h2", "", "Festgefahren"), h("p", "", "Kein Zug mehr möglich: Slots blockiert oder Munition falsch verteilt."));
      card.append(button("Nochmal", "btn primary", () => void this.startLevel(pack, index)));
    }
    card.append(button("Menü", "btn", () => this.showMenu()));
    this.overlay.replaceChildren(card);
    this.overlay.classList.remove("hidden");
  }
}
