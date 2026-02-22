import imageCompression from "browser-image-compression";

// ── Accepted file types ─────────────────────────────────────────────
// Single source of truth — imported by popup, background, and clips.

const COMPRESSIBLE = new Set(["image/jpeg", "image/png"]);

const SUPPORTED = new Set([
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/mpeg",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "application/pdf",
]);

export function isAcceptedType(mime: string): boolean {
  return COMPRESSIBLE.has(mime) || SUPPORTED.has(mime);
}

// ── Ensure filename has a proper extension based on MIME type ────────

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/mpeg": ".mpeg",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
};

function ensureExtension(name: string, mime: string): string {
  if (/\.[a-zA-Z0-9]{1,5}$/.test(name)) return name;
  return name + (MIME_TO_EXT[mime] ?? "");
}

// ── File processing (compress if possible, validate otherwise) ──────

export async function processFile(
  file: Blob,
  filename: string,
): Promise<{ blob: Blob; filename: string }> {
  const safeName = ensureExtension(filename, file.type);

  if (COMPRESSIBLE.has(file.type)) {
    try {
      const input = new File([file], safeName, { type: file.type });
      const compressed = await imageCompression(input, {
        maxSizeMB: 1,
        maxWidthOrHeight: 4096,
        useWebWorker: false,
        fileType: "image/webp",
        initialQuality: 0.85,
      });
      if (compressed.size === 0) {
        return { blob: file, filename: safeName };
      }
      return {
        blob: compressed,
        filename: safeName.replace(/\.[^.]+$/, ".webp"),
      };
    } catch {
      // Compression may fail in service worker (no DOM).
      // Fall through to upload raw file.
      return { blob: file, filename: safeName };
    }
  }

  if (!SUPPORTED.has(file.type)) {
    throw new Error(file.type ? `unsupported format: ${file.type}` : "unsupported file type");
  }

  return { blob: file, filename: safeName };
}
