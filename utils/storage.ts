import type { ClipItem, CachedData } from "./types";

// ── Mutex for atomic read-modify-write operations ───────────────────
// Chrome storage has no atomic update — concurrent get+set can lose
// writes. This serialises all mutating operations on each key.
const locks = new Map<string, Promise<void>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run fn even if prev rejected
  locks.set(key, next.then(() => {}, () => {})); // swallow so chain continues
  return next;
}

// ── Shared (popup + background + history) ───────────────────────────
export async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(["auth_token"]);
  return result["auth_token"] ?? null;
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ auth_token: token });
}

export async function getClippedItems(): Promise<ClipItem[]> {
  const result = await chrome.storage.local.get(["clipped_items"]);
  return result["clipped_items"] || [];
}

export function saveClippedItem(item: ClipItem): Promise<void> {
  return withLock("clipped_items", async () => {
    const items = await getClippedItems();
    // Remove existing entry with same GUID to avoid duplicates
    const filtered = items.filter((i) => i.guid !== item.guid);
    filtered.unshift(item);
    if (filtered.length > 1000) filtered.pop();
    await chrome.storage.local.set({ clipped_items: filtered });
  });
}

export function updateClipData(guid: string, cachedData: CachedData): Promise<void> {
  return withLock("clipped_items", async () => {
    const items = await getClippedItems();
    const idx = items.findIndex((i) => i.guid === guid);
    const item = idx !== -1 ? items[idx] : undefined;
    if (item) {
      item.cached_data = cachedData;
      await chrome.storage.local.set({ clipped_items: items });
    }
  });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ clipped_items: [] });
}

// ── Username ─────────────────────────────────────────────────────────
export async function getUsername(): Promise<string | null> {
  const result = await chrome.storage.local.get(["username"]);
  return result["username"] ?? null;
}

export async function setUsername(username: string): Promise<void> {
  await chrome.storage.local.set({ username });
}

// ── Note draft ───────────────────────────────────────────────────────
export async function getNoteDraft(): Promise<string> {
  const result = await chrome.storage.local.get(["note_draft"]);
  return result["note_draft"] ?? "";
}

export async function setNoteDraft(text: string): Promise<void> {
  await chrome.storage.local.set({ note_draft: text });
}

// ── Background-only (pending GUIDs for polling) ─────────────────────
export async function getPendingGuids(): Promise<string[]> {
  const result = await chrome.storage.local.get(["pending_guids"]);
  return result["pending_guids"] || [];
}

export function addPendingGuid(guid: string): Promise<void> {
  return withLock("pending_guids", async () => {
    const guids = await getPendingGuids();
    if (!guids.includes(guid)) {
      guids.push(guid);
      await chrome.storage.local.set({ pending_guids: guids });
    }
  });
}

export function removePendingGuid(guid: string): Promise<void> {
  return withLock("pending_guids", async () => {
    const guids = await getPendingGuids();
    await chrome.storage.local.set({
      pending_guids: guids.filter((g) => g !== guid),
    });
  });
}
