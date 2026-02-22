import { ApiClient, fetchToken } from "../../utils/api";
import {
  getToken,
  setToken,
  getClippedItems,
  updateClipData,
} from "../../utils/storage";
import {
  escapeAttr,
  renderClipCard,
} from "../../utils/rendering";
import type { ClipItem } from "../../utils/types";

// ── Helpers ─────────────────────────────────────────────────────────

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing DOM element: #${id}`);
  return el;
}

// ── HistoryManager ──────────────────────────────────────────────────

class HistoryManager {
  private api: ApiClient | null = null;
  private items: ClipItem[] = [];

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    let token = await getToken();

    if (!token) {
      const result = await fetchToken();
      if (result.ok) {
        token = result.token;
        await setToken(token);
      }
    }

    if (token) {
      this.api = new ApiClient(token);
    }

    this.items = await getClippedItems();
    this.render();
    this.pollUnprocessed();
    this.listenForStorageChanges();
    this.bindSearch();
  }

  private listenForStorageChanges(): void {
    chrome.storage.onChanged.addListener(
      (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === "local" && changes["clipped_items"]) {
          this.items = (changes["clipped_items"].newValue as ClipItem[]) || [];
          this.render();
        }
      },
    );
  }

  private bindSearch(): void {
    const searchInput = document.getElementById("searchInput") as HTMLInputElement | null;
    if (!searchInput) return;

    searchInput.oninput = () => {
      const query = searchInput.value.toLowerCase().trim();
      if (!query) {
        this.render();
        return;
      }
      const filtered = this.items.filter((clip) => {
        const title = (
          clip.cached_data?.title ||
          clip.original_title ||
          ""
        ).toLowerCase();
        const tags = (clip.cached_data?.entities || [])
          .map((e) => (typeof e === "string" ? e : e.title).toLowerCase())
          .join(" ");
        return title.includes(query) || tags.includes(query);
      });
      this.renderItems(filtered);
    };
  }

  // ── Rendering ───────────────────────────────────────────────────

  private render(): void {
    this.updateCount();
    this.renderItems(this.items);
  }

  private updateCount(): void {
    const countEl = document.getElementById("clipCount");
    if (countEl) {
      countEl.textContent = this.items.length > 0
        ? `${this.items.length} clip${this.items.length !== 1 ? "s" : ""}`
        : "";
    }
  }

  private renderItems(items: ClipItem[]): void {
    const listEl = $("historyList");
    const emptyEl = $("emptyState");

    if (items.length === 0) {
      listEl.classList.add("hidden");
      emptyEl.classList.remove("hidden");
      return;
    }

    emptyEl.classList.add("hidden");
    listEl.classList.remove("hidden");
    listEl.innerHTML = items
      .map((clip) => renderClipCard(clip, { showAddTag: true, compact: false }))
      .join("");

    this.bindItemEvents();
  }

  private bindItemEvents(): void {
    document
      .querySelectorAll<HTMLButtonElement>(".tag-add")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const guid = btn.dataset["guid"];
          if (guid) this.showInlineTagInput(guid);
        });
      });
  }

  // ── Inline tag input ────────────────────────────────────────────

  private showInlineTagInput(guid: string): void {
    const safeGuid = escapeAttr(guid);
    const card = document.querySelector<HTMLElement>(
      `.clip-card[data-guid="${CSS.escape(guid)}"]`,
    );
    if (!card || card.nextElementSibling?.classList.contains("tag-input-inline")) return;

    const html = `
      <div class="tag-input-inline flex gap-1.5 items-center p-3 pt-0 ml-4 border-l-2 border-brand-200 dark:border-brand-500/30 mt-1">
        <input type="text" placeholder="tag1, tag2" data-guid="${safeGuid}"
               class="flex-1 h-8 px-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-gray-400">
        <button data-guid="${safeGuid}"
                class="h-8 px-3 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-xs font-medium cursor-pointer transition-colors">add</button>
        <button class="cancel-btn h-8 px-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs cursor-pointer transition-colors">\u2715</button>
      </div>`;

    card.insertAdjacentHTML("afterend", html);

    const row = card.nextElementSibling as HTMLElement;
    const input = row.querySelector<HTMLInputElement>("input")!;
    const addBtn = row.querySelector<HTMLButtonElement>("button")!;
    const cancelBtn = row.querySelector<HTMLButtonElement>(".cancel-btn")!;

    input.focus();

    const remove = (): void => {
      row.remove();
    };

    const submit = async (): Promise<void> => {
      const value = input.value.trim();
      if (!value || !this.api) {
        remove();
        return;
      }

      addBtn.disabled = true;
      addBtn.textContent = "...";

      const addResult = await this.api.addEntities(guid, value);
      if (addResult.ok) {
        row.style.transition = "background-color 0.2s, opacity 0.3s";
        row.style.backgroundColor = "rgba(16, 185, 129, 0.1)";
        setTimeout(() => {
          row.style.opacity = "0";
          setTimeout(async () => {
            remove();
            const refResult = await this.api?.getBlockref(guid);
            if (!refResult) return;
            if (refResult.ok) {
              await updateClipData(guid, refResult.data.blockref);
              this.items = await getClippedItems();
              this.render();
            }
          }, 200);
        }, 300);
      } else {
        row.style.transition = "background-color 0.3s";
        row.style.backgroundColor = "rgba(239, 68, 68, 0.1)";
        setTimeout(() => { row.style.backgroundColor = ""; }, 1000);
        addBtn.disabled = false;
        addBtn.textContent = "add";
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") remove();
    });
    addBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", remove);
  }

  // ── Polling unprocessed clips ───────────────────────────────────

  private async pollUnprocessed(): Promise<void> {
    if (!this.api) return;

    const unprocessed = this.items.filter(
      (item) => !item.cached_data?.processed_at,
    );

    if (unprocessed.length === 0) return;

    for (const item of unprocessed) {
      try {
        const result = await this.api.getBlockref(item.guid);
        if (result.ok && result.data.blockref?.processed_at) {
          await updateClipData(item.guid, result.data.blockref);
        }
      } catch {
        // skip failed lookups
      }
    }

    this.items = await getClippedItems();
    this.render();

    const stillPending = this.items.filter(
      (item) => !item.cached_data?.processed_at,
    );
    if (stillPending.length > 0) {
      setTimeout(() => this.pollUnprocessed(), 10_000);
    }
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  new HistoryManager();
});
