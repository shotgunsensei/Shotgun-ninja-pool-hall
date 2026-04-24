import { useEffect, useState, useCallback } from "react";
import { DEFAULT_SETTINGS, type Settings } from "./types";

const KEY = "lan-pool-lite:settings";

function load(): Settings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      aimGuide: typeof parsed.aimGuide === "boolean" ? parsed.aimGuide : DEFAULT_SETTINGS.aimGuide,
      tableSpeed: typeof parsed.tableSpeed === "number" ? parsed.tableSpeed : DEFAULT_SETTINGS.tableSpeed,
      sound: typeof parsed.sound === "boolean" ? parsed.sound : DEFAULT_SETTINGS.sound,
      vibration: typeof parsed.vibration === "boolean" ? parsed.vibration : DEFAULT_SETTINGS.vibration,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function save(s: Settings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const listeners = new Set<(s: Settings) => void>();
let cached: Settings | null = null;

function getCached(): Settings {
  if (!cached) cached = load();
  return cached;
}

export function getSettings(): Settings {
  return getCached();
}

export function setSettings(patch: Partial<Settings>): void {
  const next = { ...getCached(), ...patch };
  cached = next;
  save(next);
  for (const l of listeners) l(next);
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [state, setState] = useState<Settings>(getCached);
  useEffect(() => {
    const cb = (s: Settings): void => setState(s);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);
  const update = useCallback((patch: Partial<Settings>) => setSettings(patch), []);
  return [state, update];
}
