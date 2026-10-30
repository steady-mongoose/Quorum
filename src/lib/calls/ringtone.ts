/**
 * Sound and buzz for an incoming call, where the browser allows it. No files,
 * no outside service: a short two-tone beep from Web Audio and a vibration
 * pattern, repeated every few seconds until the ring is answered, declined,
 * or runs out. Anything the browser refuses is skipped quietly.
 */
export const RING_EVERY_MS = 3000;
/** Never ring longer than a ring lasts on the server. */
export const RING_FOR_MS = 60_000;
export const VIBRATE_PATTERN = [400, 200, 400];

export type RingtoneEnv = {
  beep?: () => void;
  vibrate?: (pattern: number | number[]) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  /** Called on stop, e.g. to close the audio context. */
  release?: () => void;
};

type AudioCtor = new () => AudioContext;

export function browserRingtoneEnv(): RingtoneEnv {
  const w = globalThis as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
    navigator?: { vibrate?: (pattern: number | number[]) => boolean };
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  let ctx: AudioContext | null = null;
  const beep = Ctor
    ? () => {
        try {
          ctx ??= new Ctor();
          void ctx.resume?.().catch(() => undefined);
          const start = ctx.currentTime;
          for (const [offset, freq] of [
            [0, 880],
            [0.25, 660],
          ] as const) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, start + offset);
            gain.gain.exponentialRampToValueAtTime(0.2, start + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
            osc.connect(gain).connect(ctx.destination);
            osc.start(start + offset);
            osc.stop(start + offset + 0.22);
          }
        } catch {
          // No sound on this browser. The prompt is still on screen.
        }
      }
    : undefined;
  const nav = w.navigator;
  const vibrate =
    nav && typeof nav.vibrate === "function"
      ? (pattern: number | number[]) => {
          try {
            nav.vibrate?.(pattern);
          } catch {
            // Not allowed here.
          }
        }
      : undefined;
  return {
    beep,
    vibrate,
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
    release: () => {
      void ctx?.close?.().catch(() => undefined);
      ctx = null;
    },
  };
}

/** Starts ringing now. The returned function stops it; calling it twice is fine. */
export function startRinging(env: RingtoneEnv = browserRingtoneEnv()): () => void {
  let stopped = false;
  const once = () => {
    if (stopped) return;
    env.beep?.();
    env.vibrate?.(VIBRATE_PATTERN);
  };
  once();
  const every = env.setInterval(once, RING_EVERY_MS);
  const cap = env.setTimeout(() => stop(), RING_FOR_MS);
  function stop() {
    if (stopped) return;
    stopped = true;
    env.clearInterval(every);
    env.clearTimeout(cap);
    env.vibrate?.(0);
    env.release?.();
  }
  return stop;
}
