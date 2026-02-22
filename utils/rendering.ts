import type { ClipItem, Entity } from "./types";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(str: string): string {
  return str.replace(/[&"'<>]/g, (c) =>
    ({ "&": "&amp;", '"': "&quot;", "'": "&#39;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
  );
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hrs = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (hrs < 24) return `${hrs}h`;
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString();
}

function sanitizeCssColor(color: string): string {
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  if (/^[a-zA-Z]{1,20}$/.test(color)) return color;
  if (/^(rgb|hsl)a?\([0-9,.\s%]+\)$/.test(color)) return color;
  return "";
}

function renderEntity(ent: string | Entity): string {
  if (typeof ent === "string") {
    return `<span class="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-[10px] font-medium text-gray-500 dark:text-gray-400">${escapeHtml(ent)}</span>`;
  }
  const safeColor = ent.color ? sanitizeCssColor(ent.color) : "";
  const bg = safeColor ? `background-color: ${safeColor}` : "";
  const emoji = ent.emoji ? `<span class="mr-0.5">${escapeHtml(ent.emoji)}</span>` : "";
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium text-white/90" style="${bg}">${emoji}${escapeHtml(ent.title)}</span>`;
}

export function renderClipCard(
  clip: ClipItem,
  opts: { showAddTag?: boolean; compact?: boolean } = {},
): string {
  const compact = opts.compact ?? true;
  const cached = clip.cached_data;
  const processed = cached?.processed_at;
  const safeGuid = escapeAttr(clip.guid);
  const title = (processed && cached?.title) || clip.original_title || "processing...";
  const entities = (processed && cached?.entities) || [];

  const spinner = processed
    ? ""
    : '<span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse mr-1 align-middle"></span>';

  const addBtn = opts.showAddTag
    ? `<button class="tag-add inline-flex items-center px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 hover:bg-brand-100 dark:hover:bg-brand-500/20 text-gray-400 hover:text-brand-500 text-[10px] transition-colors cursor-pointer" data-guid="${safeGuid}">
        <svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
      </button>`
    : "";

  const entityLimit = compact ? 4 : 8;
  const overflowCount = entities.length > entityLimit
    ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-[9px] text-gray-400 font-medium">+${entities.length - entityLimit}</span>`
    : "";

  const tagsHtml =
    entities.length > 0 || opts.showAddTag
      ? `<div class="flex flex-wrap items-center gap-1 mt-1.5">${entities.slice(0, entityLimit).map(renderEntity).join("")}${overflowCount}${addBtn}</div>`
      : "";

  const escapedTime = escapeHtml(timeAgo(clip.clipped_at));

  if (compact) {
    return `
      <div class="clip-card group px-3 py-2.5 rounded-xl border border-gray-100 dark:border-zinc-800/80 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-all duration-150" data-guid="${safeGuid}">
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-[11px] text-gray-700 dark:text-gray-200 leading-snug font-medium line-clamp-2">${spinner}${escapeHtml(title)}</div>
            ${tagsHtml}
          </div>
          <span class="text-[9px] text-gray-400 dark:text-gray-500 shrink-0 mt-0.5 tabular-nums tracking-tight">${escapedTime}</span>
        </div>
      </div>`;
  }

  return `
    <div class="clip-card group p-4 rounded-xl border border-gray-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-card hover:shadow-card-hover transition-all duration-150" data-guid="${safeGuid}">
      <div class="flex items-start gap-3">
        <div class="flex-1 min-w-0">
          <div class="text-sm text-gray-800 dark:text-gray-100 font-medium leading-snug">${spinner}${escapeHtml(title)}</div>
          ${tagsHtml}
        </div>
        <span class="text-xs text-gray-400 shrink-0 pt-0.5">${escapedTime}</span>
      </div>
    </div>`;
}

export function renderTagInput(guid: string): string {
  const safe = escapeAttr(guid);
  return `
    <div class="flex gap-1.5 mt-2">
      <input type="text" class="tag-input flex-1 h-7 px-2.5 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-[11px] outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-gray-400" data-guid="${safe}" placeholder="tag1, tag2">
      <button class="tag-input-btn h-7 px-3 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-[11px] font-medium transition-colors" data-guid="${safe}">add</button>
    </div>`;
}
