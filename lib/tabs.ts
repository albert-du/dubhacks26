/** Bottom-bar screens. The address bar keeps the open one so a reload stays there. */
export const TAB_IDS = ["drop", "dump", "fire", "map", "pack", "me"] as const;

export type Tab = (typeof TAB_IDS)[number];

const TAB_SET = new Set<string>(TAB_IDS);

export function tabFromParam(value: string | null | undefined): Tab | null {
  if (!value || !TAB_SET.has(value)) return null;
  return value as Tab;
}

/**
 * Which screen a reload should open.
 * An explicit `tab` wins. Otherwise a "your shots" link opens dump,
 * and a brand-new or still-empty dumpster opens Drop.
 */
export function initialTab(opts: {
  requested: string | null | undefined;
  showMine: boolean;
  isNew: boolean;
  hasMedia: boolean;
}): Tab {
  const requested = tabFromParam(opts.requested);
  if (requested) return requested;
  if (opts.showMine) return "dump";
  if (opts.isNew || !opts.hasMedia) return "drop";
  return "dump";
}

/** Search string with `tab` set. Other params stay. Includes the leading `?`. */
export function withTab(search: string, tab: Tab): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  params.set("tab", tab);
  const q = params.toString();
  return q ? `?${q}` : "";
}
