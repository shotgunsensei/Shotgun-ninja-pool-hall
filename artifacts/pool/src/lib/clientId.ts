// Stable per-browser identifier so the relay can recognise a player who
// briefly disconnects (e.g. screen lock) and reconnects.

const KEY = "snph:clientId";
const LEGACY_KEY = "lan-pool-lite:clientId";

export function getClientId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    // Migrate from the pre-rebrand key so existing in-flight rooms still
    // recognise the same browser.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      id = legacy;
      try {
        window.localStorage.setItem(KEY, id);
        window.localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* ignore */
      }
      return id;
    }
    id = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}
