// Stable per-browser identifier so the relay can recognise a player who
// briefly disconnects (e.g. screen lock) and reconnects.

const KEY = "lan-pool-lite:clientId";

export function getClientId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}
