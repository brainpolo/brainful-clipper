// ── Toast types ─────────────────────────────────────────────────────
export type ToastType = "success" | "error" | "loading" | "info" | "warning";

// ── Clip data ───────────────────────────────────────────────────────
export interface Entity {
  title: string;
  color?: string;
  emoji?: string;
}

export interface CachedData {
  processed_at: string;
  title: string;
  entities: (string | Entity)[];
}

export interface ClipItem {
  guid: string;
  url: string;
  clipped_at: string;
  original_title: string;
  type?: "file";
  thumbnail_url?: string | null;
  cached_data: CachedData | null;
}

// ── API responses ───────────────────────────────────────────────────
export type ApiResponse<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; data: { error?: string } };

export interface ClipLinkData {
  guid: string;
  created: boolean;
}

export interface AddEntitiesData {
  added: string[];
}

export interface BlockrefData {
  blockref: CachedData;
}

export interface UploadFileData {
  blockrefs: { guid: string; title?: string }[];
  created_count?: number;
  existing_count?: number;
}

export interface AddBlockData {
  luid: string;
  slug: string;
  remaining_daily_quota: number;
}

// ── Messages (popup → background) ────────────────────────────────────
export interface StartPollingMessage {
  type: "START_POLLING";
  guid: string;
}

export interface TokenUpdatedMessage {
  type: "TOKEN_UPDATED";
}

export type BackgroundMessage =
  | StartPollingMessage
  | TokenUpdatedMessage;
