import { ApiClient, fetchToken, LOGIN_URL } from "../utils/api";
import {
  getToken,
  setToken,
  saveClippedItem,
  updateClipData,
  getPendingGuids,
  addPendingGuid,
  removePendingGuid,
} from "../utils/storage";
import { BackgroundMessage, ToastType } from "../utils/types";
import { processFile } from "../utils/files";

export default defineBackground(() => {
  const POLL_INTERVAL = 10_000;

  let apiClient: ApiClient | null = null;
  let isPolling = false;

  // ── Initialisation ──────────────────────────────────────────────────

  async function initApiClient(): Promise<boolean> {
    let token = await getToken();

    if (!token) {
      const result = await fetchToken();
      if (result.ok) {
        token = result.token;
        await setToken(token);
      }
    }

    if (token) {
      apiClient = new ApiClient(token);
      return true;
    }

    return false;
  }

  // ── Context menu ────────────────────────────────────────────────────

  function setupContextMenu(): void {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "clip-to-brainful",
        title: "clip file",
        contexts: ["image", "video", "audio"],
      });
    });
  }

  // ── Toast helper ────────────────────────────────────────────────────
  // Injects a toast directly into the tab via chrome.scripting.executeScript.
  // No always-running content script needed — code only runs on-demand.

  function sendToast(
    tabId: number | undefined,
    text: string,
    toastType: ToastType,
  ): void {
    if (tabId !== undefined) {
      chrome.scripting
        .executeScript({
          target: { tabId },
          args: [text, toastType],
          func: (message: string, type: string) => {
            const TOAST_ID = "brainful-toast";
            const existing = document.getElementById(TOAST_ID);
            if (existing) existing.remove();

            const COLORS: Record<string, string> = {
              success: "#22c55e",
              error: "#ef4444",
              loading: "#3b82f6",
              info: "#3b82f6",
              warning: "#f59e0b",
            };

            const toast = document.createElement("div");
            toast.id = TOAST_ID;
            toast.textContent = message;
            toast.style.cssText = [
              "position:fixed", "bottom:24px", "right:24px",
              "padding:14px 20px",
              `background:${COLORS[type] ?? "#3b82f6"}`,
              "color:white",
              "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif",
              "font-size:14px", "font-weight:500",
              "border-radius:12px",
              "box-shadow:0 4px 20px rgba(0,0,0,0.2)",
              "z-index:2147483647",
              "opacity:0", "transform:translateY(10px)",
              "transition:opacity 0.3s ease,transform 0.3s ease",
            ].join(";");

            document.body.appendChild(toast);
            requestAnimationFrame(() => {
              toast.style.opacity = "1";
              toast.style.transform = "translateY(0)";
            });

            if (type !== "loading") {
              setTimeout(() => {
                toast.style.opacity = "0";
                toast.style.transform = "translateY(10px)";
                setTimeout(() => toast.remove(), 300);
              }, 3000);
            }
          },
        })
        .catch(() => {
          // Injection failed (restricted page like chrome://) — fall back to notification
          chrome.notifications.create({
            type: "basic",
            iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
            title: "brainful clipper",
            message: text,
          });
        });
    } else {
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title: "brainful clipper",
        message: text,
      });
    }
  }

  // ── Clip file from right-click ──────────────────────────────────────

  async function clipFileFromUrl(
    srcUrl: string,
    tabId?: number,
  ): Promise<void> {
    const authed = await initApiClient();
    if (!authed || !apiClient) {
      chrome.tabs.create({ url: LOGIN_URL });
      return;
    }

    sendToast(tabId, "clipping...", "loading");

    try {
      // Validate URL scheme to prevent SSRF (file://, data://, etc.)
      const parsedUrl = new URL(srcUrl);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        throw new Error("unsupported URL scheme");
      }

      const response = await fetch(srcUrl);
      if (!response.ok) {
        throw new Error(`fetch failed (${response.status})`);
      }
      const rawBlob = await response.blob();
      const rawFilename = new URL(srcUrl).pathname.split("/").pop() || "file";

      const processed = await processFile(rawBlob, rawFilename);

      const result = await apiClient.uploadFile(processed.blob, processed.filename);

      if (!result.ok) {
        if (result.status === 413) throw new Error("file too large");
        if (result.status === 429) throw new Error("rate limited");
        throw new Error(result.data?.error || "upload failed");
      }

      const { blockrefs, created_count, existing_count } = result.data;

      if (blockrefs.length === 0) {
        throw new Error("server returned no data");
      }

      for (const blockref of blockrefs) {
        await saveClippedItem({
          guid: blockref.guid,
          url: srcUrl,
          clipped_at: new Date().toISOString(),
          original_title: blockref.title || processed.filename,
          type: "file",
          cached_data: null,
        });
        await addPendingGuid(blockref.guid);
      }

      startPollingIfNeeded();

      if (created_count && created_count > 0) {
        sendToast(tabId, "clipped!", "success");
      } else if (existing_count && existing_count > 0) {
        sendToast(tabId, "already saved", "info");
      } else {
        sendToast(tabId, "clipped!", "success");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "something went wrong";
      sendToast(tabId, message, "error");
    }
  }

  // ── Polling ─────────────────────────────────────────────────────────

  async function pollProcessingStatus(): Promise<void> {
    if (!apiClient) {
      isPolling = false;
      return;
    }

    try {
      const guids = await getPendingGuids();
      if (guids.length === 0) {
        isPolling = false;
        return;
      }

      for (const guid of guids) {
        if (!apiClient) break;
        try {
          const result = await apiClient.getBlockref(guid);

          if (result.status === 401) {
            apiClient = null;
            isPolling = false;
            return;
          }

          if (result.ok && result.data.blockref?.processed_at) {
            await updateClipData(guid, result.data.blockref);
            await removePendingGuid(guid);
          }
        } catch {
          // Skip this guid, continue with others
        }
      }

      setTimeout(pollProcessingStatus, POLL_INTERVAL);
    } catch {
      // Storage or unexpected error — retry after interval
      setTimeout(pollProcessingStatus, POLL_INTERVAL);
    }
  }

  function startPollingIfNeeded(): void {
    if (isPolling) return;
    // Set flag synchronously to prevent race condition
    isPolling = true;

    getPendingGuids().then((guids) => {
      if (guids.length > 0) {
        pollProcessingStatus();
      } else {
        isPolling = false;
      }
    });
  }

  // ── Message listener ────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(
    (message: BackgroundMessage): void => {
      if (message.type === "START_POLLING") {
        addPendingGuid(message.guid).then(() => startPollingIfNeeded());
        return;
      }

      if (message.type === "TOKEN_UPDATED") {
        initApiClient();
      }
    },
  );

  // ── Context menu listener ───────────────────────────────────────────

  chrome.contextMenus.onClicked.addListener(
    (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
      if (info.menuItemId === "clip-to-brainful" && info.srcUrl) {
        clipFileFromUrl(info.srcUrl, tab?.id);
      }
    },
  );

  // ── Startup ─────────────────────────────────────────────────────────

  chrome.runtime.onInstalled.addListener(setupContextMenu);
  setupContextMenu();
  startPollingIfNeeded();
});
