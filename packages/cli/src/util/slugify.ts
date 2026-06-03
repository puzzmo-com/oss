/**
 * Converts a string to a URL-friendly slug. Mirrors packages/shared/slugify.ts —
 * the CLI is standalone and does not depend on @puzzmo-com/shared, so the host's
 * slug derivation is replicated here. Keep in sync with the shared version: the
 * server derives a new game's slug from its displayName the same way, and
 * `upload` uses this to refuse creating a game whose puzzmo.json slug wouldn't match.
 */
export const slugify = (text: string): string =>
  text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
