/** Names are unique within a dumpster, ignoring case and spacing, so the name alone finds you again. */
export function nameKey(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
