// Procedural audio — no external sound files needed.
// We synthesize short clicks/thumps with the Web Audio API on demand.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const Klass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Klass) return null;
    ctx = new Klass();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Resume the audio context. Browsers require a user gesture before audio
 * will play; call this from a touch/click handler at app start.
 */
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    void c.resume();
  }
}

interface PlayOpts {
  freq: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
  noise?: boolean;
}

function play(opts: PlayOpts, enabled: boolean): void {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime;
  const gain = c.createGain();
  gain.gain.setValueAtTime(opts.volume ?? 0.18, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);
  gain.connect(c.destination);

  if (opts.noise) {
    const bufferSize = Math.floor(c.sampleRate * opts.duration);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    src.start(t0);
    src.stop(t0 + opts.duration);
  } else {
    const osc = c.createOscillator();
    osc.type = opts.type ?? "triangle";
    osc.frequency.setValueAtTime(opts.freq, t0);
    osc.frequency.exponentialRampToValueAtTime(opts.freq * 0.6, t0 + opts.duration);
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + opts.duration);
  }
}

export function sfxCue(power: number, enabled: boolean): void {
  play({ freq: 300 + power * 250, duration: 0.12, type: "triangle", volume: 0.22 }, enabled);
}

export function sfxClack(intensity: number, enabled: boolean): void {
  play({
    freq: 700 + Math.random() * 300,
    duration: 0.06,
    type: "square",
    volume: Math.min(0.18, 0.05 + intensity * 0.15),
  }, enabled);
}

export function sfxPocket(enabled: boolean): void {
  play({ freq: 180, duration: 0.18, type: "sine", volume: 0.2 }, enabled);
  setTimeout(() => play({ freq: 90, duration: 0.22, noise: true, volume: 0.14 }, enabled), 60);
}

export function sfxWin(enabled: boolean): void {
  play({ freq: 523, duration: 0.18, type: "triangle", volume: 0.2 }, enabled);
  setTimeout(() => play({ freq: 659, duration: 0.18, type: "triangle", volume: 0.2 }, enabled), 140);
  setTimeout(() => play({ freq: 784, duration: 0.28, type: "triangle", volume: 0.22 }, enabled), 280);
}

export function sfxLose(enabled: boolean): void {
  play({ freq: 330, duration: 0.18, type: "sawtooth", volume: 0.2 }, enabled);
  setTimeout(() => play({ freq: 220, duration: 0.32, type: "sawtooth", volume: 0.2 }, enabled), 160);
}

export function vibrate(pattern: number | number[], enabled: boolean): void {
  if (!enabled) return;
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
