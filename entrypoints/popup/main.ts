import { ApiClient, fetchToken, LOGIN_URL, APP_URL } from "../../utils/api";
import {
  getToken,
  setToken,
  getUsername,
  setUsername,
  getClippedItems,
  saveClippedItem,
  updateClipData,
  clearHistory,
  getNoteDraft,
  setNoteDraft,
} from "../../utils/storage";
import {
  escapeAttr,
  renderClipCard,
  renderTagInput,
} from "../../utils/rendering";
import { ClipItem, ToastType } from "../../utils/types";
import { isAcceptedType, processFile } from "../../utils/files";

// ── Helpers ─────────────────────────────────────────────────────────

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing DOM element: #${id}`);
  return el;
}

// ── Constants ───────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  "URL is required": "please provide a valid url",
  "This link type is not supported yet": "only youtube videos are supported",
  "BlockRef not found": "this clip was not found",
  "Maximum 20 entities per request": "too many tags, try fewer",
};

const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * 8; // ~50.27

// ── PopupUI class ───────────────────────────────────────────────────

class PopupUI {
  private api: ApiClient | null = null;
  private currentGuid: string | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private countdownValue: number = 5;
  private currentUrl: string | null = null;
  private currentTitle: string | null = null;
  private historyItems: ClipItem[] = [];
  private username: string | null = null;
  private noteSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.init();
  }

  // ── Initialisation ──────────────────────────────────────────────

  private async init(): Promise<void> {
    let token = await getToken();

    if (!token) {
      const result = await fetchToken();
      if (result.ok) {
        token = result.token;
        await setToken(token);
        await setUsername(result.username);
        chrome.runtime.sendMessage({ type: "TOKEN_UPDATED" });
      }
    }

    if (!token) {
      this.showView("authView");
      this.bindAuthEvents();
      return;
    }

    this.api = new ApiClient(token);
    this.username = await getUsername();

    // Backfill username if we have a token but no stored username
    if (!this.username) {
      const result = await fetchToken();
      if (result.ok) {
        this.username = result.username;
        await setUsername(result.username);
      }
    }
    $("mainContent").classList.remove("hidden");

    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = tabs[0];
    this.currentUrl = tab?.url ?? null;
    this.currentTitle = tab?.title ?? null;

    if (this.currentUrl && this.isYouTubeVideo(this.currentUrl)) {
      const existing = await this.getExistingClip(this.currentUrl);
      if (existing) {
        this.showExistingClipView(existing);
      } else {
        this.showClipView(this.currentUrl, this.currentTitle ?? "");
      }
    } else {
      this.showView("notSupportedView");
    }

    this.bindEvents();
    this.setupDropZone();
    await this.loadHistory();
  }

  // ── History ─────────────────────────────────────────────────────

  private async loadHistory(): Promise<void> {
    this.historyItems = await getClippedItems();
    this.renderHistory();
  }

  private renderHistory(filtered?: ClipItem[]): void {
    const listEl = $("historyList");
    const emptyEl = $("historyEmpty");
    const countEl = document.getElementById("historyCount");
    const clearBtn = document.getElementById("clearHistoryBtn");
    const items = filtered ?? this.historyItems;

    if (countEl) {
      countEl.textContent =
        this.historyItems.length > 0
          ? `(${this.historyItems.length})`
          : "";
    }

    if (clearBtn) {
      if (this.historyItems.length > 0) {
        clearBtn.classList.remove("hidden");
      } else {
        clearBtn.classList.add("hidden");
      }
    }

    if (items.length === 0) {
      listEl.classList.add("hidden");
      emptyEl.classList.remove("hidden");
    } else {
      emptyEl.classList.add("hidden");
      listEl.classList.remove("hidden");
      listEl.innerHTML = items
        .map((clip) => renderClipCard(clip, { showAddTag: true, compact: true }))
        .join("");
      this.bindHistoryEvents();
    }
  }

  private bindHistoryEvents(): void {
    document
      .querySelectorAll<HTMLButtonElement>("#historyList .tag-add")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const guid = btn.dataset["guid"];
          if (guid) this.showHistoryTagInput(guid);
        });
      });
  }

  private showHistoryTagInput(guid: string): void {
    const card = document.querySelector<HTMLElement>(
      `#historyList .clip-card[data-guid="${CSS.escape(guid)}"]`,
    );
    if (!card || card.nextElementSibling?.classList.contains("tag-input-inline")) return;

    const safeGuid = escapeAttr(guid);
    const html = `
      <div class="tag-input-inline flex gap-1.5 items-center px-3 py-1.5 border-l-2 border-brand-200 dark:border-brand-500/30 ml-3 mt-0.5">
        <input type="text" placeholder="tag1, tag2" data-guid="${safeGuid}"
               class="flex-1 h-6 px-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-[10px] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-gray-400">
        <button data-guid="${safeGuid}"
                class="h-6 px-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-[10px] font-medium transition-colors">add</button>
        <button class="cancel-btn h-6 px-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-[10px] transition-colors">\u2715</button>
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
            }
            await this.loadHistory();
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

  private switchTab(tab: "clip" | "history" | "note"): void {
    const panels = ["tabContentClip", "tabContentHistory", "tabContentNote"] as const;
    const buttons = ["tabClip", "tabHistory", "tabNote"] as const;
    const activeMap = { clip: 0, history: 1, note: 2 } as const;
    const activeIdx = activeMap[tab];

    for (let i = 0; i < panels.length; i++) {
      const panel = document.getElementById(panels[i] as string);
      const btn = document.getElementById(buttons[i] as string);
      if (i === activeIdx) {
        panel?.classList.remove("hidden");
        btn?.classList.add("tab-btn-active");
      } else {
        panel?.classList.add("hidden");
        btn?.classList.remove("tab-btn-active");
      }
    }
  }

  // ── YouTube helpers ─────────────────────────────────────────────

  private isYouTubeVideo(url: string): boolean {
    return /youtube\.com\/watch|youtu\.be\//.test(url);
  }

  private async getExistingClip(url: string): Promise<ClipItem | null> {
    const items = await getClippedItems();
    const normalised = this.normalizeYouTubeUrl(url);
    return items.find((i) => this.normalizeYouTubeUrl(i.url) === normalised) ?? null;
  }

  private normalizeYouTubeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.searchParams.get("v") || parsed.pathname.split("/").pop() || url;
    } catch {
      return url;
    }
  }

  // ── View management ─────────────────────────────────────────────

  private showView(id: string): void {
    document.querySelectorAll<HTMLElement>(".view").forEach((el) => {
      el.classList.add("hidden");
      el.classList.remove("view-enter");
    });
    const target = $(id);
    target.classList.remove("hidden");
    target.classList.add("view-enter");
  }

  private showClipView(_url: string, title: string): void {
    $("videoTitle").textContent = title || "YouTube Video";
    this.showView("clipView");
  }

  private showExistingClipView(clip: ClipItem): void {
    this.currentGuid = clip.guid;
    // Create a display copy to avoid mutating the original
    const displayClip: ClipItem = {
      ...clip,
      original_title: clip.original_title || this.currentTitle || "",
    };

    const container = $("existingClipContent");
    container.innerHTML = renderClipCard(displayClip) + renderTagInput(clip.guid);

    const tagInput = container.querySelector<HTMLInputElement>(".tag-input");
    const tagBtn = container.querySelector<HTMLButtonElement>(".tag-input-btn");

    if (tagInput) {
      tagInput.onkeydown = (e) => {
        if (e.key === "Enter") this.handleAddExistingEntities();
      };
    }
    if (tagBtn) {
      tagBtn.onclick = () => this.handleAddExistingEntities();
    }

    this.showView("existingClipView");
  }

  // ── Auth events ─────────────────────────────────────────────────

  private bindAuthEvents(): void {
    const loginBtn = $("loginBtn") as HTMLButtonElement;
    loginBtn.onclick = () => {
      chrome.tabs.create({ url: LOGIN_URL });
    };

    this.bindOpenAppButton("openAppAuth");
  }

  // ── Main event bindings ─────────────────────────────────────────

  private bindOpenAppButton(id: string): void {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) {
      btn.onclick = () => chrome.tabs.create({ url: APP_URL });
    }
  }

  private bindEvents(): void {
    this.bindOpenAppButton("openAppTab");

    // Tab switching
    const tabClip = document.getElementById("tabClip") as HTMLButtonElement | null;
    const tabHistory = document.getElementById("tabHistory") as HTMLButtonElement | null;
    const tabNote = document.getElementById("tabNote") as HTMLButtonElement | null;
    if (tabClip) tabClip.onclick = () => this.switchTab("clip");
    if (tabHistory) tabHistory.onclick = () => this.switchTab("history");
    if (tabNote) tabNote.onclick = () => this.switchTab("note");

    const clipBtn = document.getElementById("clipBtn") as HTMLButtonElement | null;
    if (clipBtn) {
      clipBtn.onclick = () => this.handleClip();
    }

    const entityInput = document.getElementById("entityInput") as HTMLInputElement | null;
    if (entityInput) {
      entityInput.onkeydown = (e) => {
        if (e.key === "Enter") this.handleAddEntities();
      };
      entityInput.onfocus = () => this.pauseCountdown();
    }

    const entitySubmit = document.getElementById("entitySubmit") as HTMLButtonElement | null;
    if (entitySubmit) {
      entitySubmit.onclick = () => this.handleAddEntities();
    }

    const clearHistoryBtn = document.getElementById("clearHistoryBtn") as HTMLButtonElement | null;
    if (clearHistoryBtn) {
      clearHistoryBtn.onclick = async () => {
        await clearHistory();
        this.historyItems = [];
        this.renderHistory();
      };
    }

    const historySearch = document.getElementById("historySearch") as HTMLInputElement | null;
    if (historySearch) {
      historySearch.oninput = () => {
        const query = historySearch.value.toLowerCase().trim();
        if (!query) {
          this.renderHistory();
          return;
        }
        const filtered = this.historyItems.filter((clip) => {
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
        this.renderHistory(filtered);
      };
    }

    this.bindNoteEvents();
  }

  // ── Note (scratchpad) ─────────────────────────────────────────

  private async bindNoteEvents(): Promise<void> {
    const textarea = document.getElementById("noteTextarea") as HTMLTextAreaElement | null;
    const pushBtn = document.getElementById("notePushBtn") as HTMLButtonElement | null;
    const charCount = document.getElementById("noteCharCount");
    if (!textarea || !pushBtn) return;

    // Load saved draft
    const draft = await getNoteDraft();
    if (draft) {
      textarea.value = draft;
      pushBtn.disabled = false;
      if (charCount) charCount.textContent = `${draft.length}`;
    }

    textarea.oninput = () => {
      const text = textarea.value;
      pushBtn.disabled = text.trim().length === 0;
      if (charCount) charCount.textContent = text.length > 0 ? `${text.length}` : "";

      // Debounced save
      if (this.noteSaveTimer) clearTimeout(this.noteSaveTimer);
      this.noteSaveTimer = setTimeout(() => setNoteDraft(text), 300);
    };

    pushBtn.onclick = () => this.handlePushNote();
  }

  private async handlePushNote(): Promise<void> {
    if (!this.api) return;

    const textarea = $("noteTextarea") as HTMLTextAreaElement;
    const pushBtn = $("notePushBtn") as HTMLButtonElement;
    const charCount = document.getElementById("noteCharCount");
    const content = textarea.value.trim();
    if (!content) return;

    pushBtn.disabled = true;
    pushBtn.textContent = "pushing...";

    const result = await this.api.addBlock(content);

    if (result.ok) {
      // Build block URL
      const baseUrl = APP_URL.replace(/\/app$/, "");
      const blockUrl = this.username
        ? `${baseUrl}/@${this.username}/${result.data.luid}`
        : baseUrl;

      // Copy to clipboard
      let copied = false;
      try {
        await navigator.clipboard.writeText(blockUrl);
        copied = true;
      } catch {
        // Clipboard may fail in some contexts
      }

      // Clear textarea and draft
      textarea.value = "";
      await setNoteDraft("");
      pushBtn.disabled = true;
      pushBtn.textContent = "push to brainful";
      if (charCount) charCount.textContent = "";

      this.showToast(copied ? "pushed — link copied" : "pushed", "success");
    } else {
      pushBtn.disabled = false;
      pushBtn.textContent = "push to brainful";
      this.showError(this.getErrorMessage(result));
    }
  }

  // ── Clipping ────────────────────────────────────────────────────

  private async handleClip(): Promise<void> {
    if (!this.api || !this.currentUrl) return;

    const clipBtn = $("clipBtn") as HTMLButtonElement;
    const clipView = $("clipView");
    const progressBar = $("progressBar");

    clipBtn.disabled = true;
    clipBtn.innerHTML = `<span class="inline-flex items-center gap-1.5"><svg class="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>clipping...</span>`;
    clipView.classList.add("clipping");
    progressBar.classList.remove("hidden");
    progressBar.classList.add("active");

    const result = await this.api.clipLink(this.currentUrl);

    if (result.ok) {
      this.currentGuid = result.data.guid;

      if (result.data.created) {
        await saveClippedItem({
          guid: this.currentGuid,
          url: this.currentUrl,
          clipped_at: new Date().toISOString(),
          original_title: this.currentTitle ?? "",
          cached_data: null,
        });
        chrome.runtime.sendMessage({
          type: "START_POLLING",
          guid: this.currentGuid,
        });

        progressBar.classList.remove("active");
        progressBar.classList.add("complete");

        setTimeout(() => {
          this.showSuccessAnimation();
          this.loadHistory();
        }, 300);
      } else {
        progressBar.classList.add("hidden");
        clipView.classList.remove("clipping");

        const refResult = await this.api.getBlockref(this.currentGuid);
        const clip: ClipItem = {
          guid: this.currentGuid,
          url: this.currentUrl,
          original_title: this.currentTitle ?? "",
          clipped_at: new Date().toISOString(),
          cached_data: refResult.ok ? refResult.data.blockref : null,
        };
        await saveClippedItem(clip);
        this.showToast("already saved", "info");
        this.showExistingClipView(clip);
        await this.loadHistory();
      }
    } else {
      clipView.classList.remove("clipping");
      progressBar.classList.add("hidden");
      progressBar.classList.remove("active");
      clipBtn.disabled = false;
      clipBtn.textContent = "clip";
      this.showError(this.getErrorMessage(result));
    }
  }

  // ── Success animation & countdown ───────────────────────────────

  private showSuccessAnimation(): void {
    const animation = $("successAnimation");
    const entitySection = $("entitySection");

    animation.classList.remove("fade-out", "hidden");
    entitySection.classList.add("hidden");

    this.showView("successView");

    setTimeout(() => {
      animation.classList.add("fade-out");
      setTimeout(() => {
        animation.classList.add("hidden");
        entitySection.classList.remove("hidden");
        this.startCountdown();
        const input = document.getElementById("entityInput") as HTMLInputElement | null;
        input?.focus();
      }, 300);
    }, 1200);
  }

  private startCountdown(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownValue = 5;
    this.updateCountdown();
    this.countdownTimer = setInterval(() => {
      this.countdownValue--;
      this.updateCountdown();
      if (this.countdownValue <= 0) {
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        window.close();
      }
    }, 1000);
  }

  private updateCountdown(): void {
    const el = document.getElementById("countdown");
    const ring = document.getElementById("countdownRing");
    if (el) {
      el.textContent = `${this.countdownValue}`;
    }
    if (ring) {
      const offset = COUNTDOWN_CIRCUMFERENCE * (1 - this.countdownValue / 5);
      ring.style.strokeDashoffset = `${offset}`;
    }
  }

  private pauseCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    const el = document.getElementById("countdown");
    const label = document.getElementById("countdownLabel");
    const ring = document.getElementById("countdownRing");
    if (el) el.textContent = "\u221E";
    if (label) label.textContent = "paused";
    if (ring) ring.style.strokeDashoffset = "0";
  }

  // ── Entity (tag) management ─────────────────────────────────────

  private async handleAddEntities(): Promise<void> {
    const input = $("entityInput") as HTMLInputElement;
    const value = input.value.trim();
    if (!value || !this.currentGuid || !this.api) return;

    const submitBtn = $("entitySubmit") as HTMLButtonElement;
    submitBtn.disabled = true;

    const result = await this.api.addEntities(this.currentGuid, value);
    if (result.ok) {
      input.value = "";
      input.placeholder = `added: ${result.data.added.join(", ")}`;
      await this.loadHistory();
    } else {
      this.showError(this.getErrorMessage(result));
    }

    submitBtn.disabled = false;
  }

  private async handleAddExistingEntities(): Promise<void> {
    const container = $("existingClipContent");
    const input = container.querySelector<HTMLInputElement>(".tag-input");
    const value = input?.value.trim();
    if (!value || !this.currentGuid || !this.api) return;

    const btn = container.querySelector<HTMLButtonElement>(".tag-input-btn");
    if (btn) btn.disabled = true;

    const result = await this.api.addEntities(this.currentGuid, value);
    if (result.ok) {
      const refResult = await this.api.getBlockref(this.currentGuid);
      if (refResult.ok && refResult.data.blockref) {
        const clip: ClipItem = {
          guid: this.currentGuid,
          url: this.currentUrl ?? "",
          original_title: this.currentTitle ?? "",
          clipped_at: new Date().toISOString(),
          cached_data: refResult.data.blockref,
        };
        await saveClippedItem(clip);
        this.showExistingClipView(clip);
        this.showToast("tags added", "success");
        await this.loadHistory();
      } else {
        // Tags were added server-side but we couldn't refresh the view
        this.showToast("tags added", "success");
        if (btn) btn.disabled = false;
      }
    } else {
      this.showError(this.getErrorMessage(result));
      if (btn) btn.disabled = false;
    }
  }

  // ── Error handling ──────────────────────────────────────────────

  private getErrorMessage(res: { ok: false; status: number; data: { error?: string } }): string {
    if (res.status === 401) return "invalid token, please re-enter";
    if (res.status === 429) return "too many requests, please wait";
    if (res.status >= 500) return "something went wrong, try again";

    const serverError = res.data?.error;
    if (serverError && ERROR_MESSAGES[serverError]) {
      return ERROR_MESSAGES[serverError];
    }
    return serverError?.toLowerCase() || "failed to clip";
  }

  private showError(msg: string): void {
    this.showToast(msg, "error");
  }

  private showToast(text: string, type: ToastType = "error"): void {
    const toast = $("toast");
    const message = $("toastMessage");
    message.textContent = text;
    toast.className = `toast toast-${type}`;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.add("hidden");
      this.toastTimer = null;
    }, 2500);
  }

  // ── Drop zone (file upload) ─────────────────────────────────────

  private setupDropZone(): void {
    this.initDrop("dropZone", "fileInput", "uploadProgress");
    this.initDrop("clipDropZone", "clipFileInput", "clipUploadProgress");
  }

  private initDrop(zoneId: string, inputId: string, progressId: string): void {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!zone || !input) return;

    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });

    zone.addEventListener("dragleave", () => {
      zone.classList.remove("drag-over");
    });

    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      if (e.dataTransfer?.files.length) {
        this.handleFiles(e.dataTransfer.files, progressId);
      }
    });

    zone.addEventListener("click", () => {
      input.click();
    });

    input.addEventListener("change", () => {
      if (input.files?.length) {
        this.handleFiles(input.files, progressId);
      }
      input.value = "";
    });
  }

  private async handleFiles(fileList: FileList, progressId: string): Promise<void> {
    if (!this.api) return;

    const progressEl = document.getElementById(progressId);
    if (!progressEl) return;

    progressEl.innerHTML = "";
    progressEl.classList.remove("hidden");

    const files = Array.from(fileList);

    for (const file of files) {
      const row = document.createElement("div");
      row.className = "flex items-center gap-2 px-3 py-1.5 text-[11px] rounded-lg transition-colors";

      const dot = document.createElement("span");
      dot.className = "inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0";

      const nameEl = document.createElement("span");
      nameEl.className = "flex-1 min-w-0 truncate text-gray-600 dark:text-gray-300 font-medium";
      nameEl.textContent = file.name;

      const statusEl = document.createElement("span");
      statusEl.className = "shrink-0 text-gray-400 text-[10px]";
      statusEl.textContent = "processing";

      row.appendChild(dot);
      row.appendChild(nameEl);
      row.appendChild(statusEl);
      progressEl.appendChild(row);

      if (!isAcceptedType(file.type)) {
        this.setUploadError(dot, statusEl, "unsupported format");
        continue;
      }

      try {
        // Compress + validate via shared utility, then upload directly
        const processed = await processFile(file, file.name);

        statusEl.textContent = "uploading";

        const result = await this.api.uploadFile(processed.blob, processed.filename);

        if (result.ok) {
          dot.className = "inline-block w-2 h-2 rounded-full bg-green-500 shrink-0";
          statusEl.textContent = "done";
          statusEl.className = "shrink-0 text-green-600 dark:text-green-400 text-[10px] font-medium";
          row.style.backgroundColor = "rgba(16, 185, 129, 0.05)";

          for (const blockref of result.data.blockrefs) {
            await saveClippedItem({
              guid: blockref.guid,
              url: "",
              clipped_at: new Date().toISOString(),
              original_title: blockref.title || processed.filename,
              type: "file",
              cached_data: null,
            });
            chrome.runtime.sendMessage({ type: "START_POLLING", guid: blockref.guid });
          }
        } else {
          const msg = result.status === 413 ? "file too large"
            : result.status === 429 ? "rate limited"
            : result.data?.error || "upload failed";
          this.setUploadError(dot, statusEl, msg);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "upload failed";
        this.setUploadError(dot, statusEl, msg);
      }
    }

    await this.loadHistory();
  }

  private setUploadError(dot: Element, statusEl: Element, message: string): void {
    (dot as HTMLElement).className = "inline-block w-2 h-2 rounded-full bg-red-500 shrink-0";
    statusEl.textContent = message;
    (statusEl as HTMLElement).className = "shrink-0 text-red-500 text-[10px]";
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  new PopupUI();
});
