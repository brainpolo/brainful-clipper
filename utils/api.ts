import type { ApiResponse, ClipLinkData, AddEntitiesData, BlockrefData, UploadFileData, AddBlockData } from "./types";

const API_BASE = import.meta.env["WXT_API_BASE"] as string;

export const LOGIN_URL = `${API_BASE}/login`;
export const APP_URL = `${API_BASE}/app`;

export async function fetchToken(): Promise<{ ok: true; token: string; username: string } | { ok: false }> {
  try {
    const res = await fetch(`${API_BASE}/api/clip/token/v1`, {
      method: "GET",
      credentials: "include",
    });
    if (res.ok) {
      try {
        const data = await res.json();
        return { ok: true, token: data.token, username: data.username };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export class ApiClient {
  constructor(private token: string) {}

  private async request<T>(method: string, endpoint: string, body?: Record<string, unknown>): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { Authorization: `Token ${this.token}` };
    if (body) headers["Content-Type"] = "application/json";

    const init: RequestInit = { method, headers };
    if (body) init.body = JSON.stringify(body);

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, init);
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        // Non-JSON response (e.g. 502 HTML page from proxy)
        return { ok: false, status: res.status, data: { error: `Server returned ${res.status}` } };
      }
      if (res.ok) {
        return { ok: true, status: res.status, data: data as T };
      }
      return { ok: false, status: res.status, data: data as { error?: string } };
    } catch {
      return { ok: false, status: 0, data: { error: "Network error. Please check your connection." } };
    }
  }

  clipLink(url: string) {
    return this.request<ClipLinkData>("POST", "/api/clip/link/v1", { url });
  }

  addEntities(guid: string, entities: string) {
    return this.request<AddEntitiesData>("POST", "/api/clip/entities/v1", { guid, entities });
  }

  getBlockref(guid: string) {
    return this.request<BlockrefData>("GET", `/api/clip/blockref/v1?guid=${encodeURIComponent(guid)}`);
  }

  addBlock(content: string) {
    return this.request<AddBlockData>("POST", "/blocks/add", { string: content });
  }

  async uploadFile(file: Blob, filename: string): Promise<ApiResponse<UploadFileData>> {
    const form = new FormData();
    form.append("files", file, filename);

    try {
      const res = await fetch(`${API_BASE}/api/clip/file/v1`, {
        method: "POST",
        headers: { Authorization: `Token ${this.token}` },
        body: form,
      });
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        return { ok: false, status: res.status, data: { error: `Server returned ${res.status}` } };
      }
      if (res.ok) {
        return { ok: true, status: res.status, data: data as UploadFileData };
      }
      return { ok: false, status: res.status, data: data as { error?: string } };
    } catch {
      return { ok: false, status: 0, data: { error: "Network error. Please check your connection." } };
    }
  }
}
