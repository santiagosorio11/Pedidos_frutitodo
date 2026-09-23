/* Short synthesized tones, so the panel needs no audio assets. Browsers only allow audio
   after a user gesture, which is why the panel asks for one click to enable sound. */

export type AlertKind = "order" | "help";

const PATTERNS: Record<AlertKind, Array<[frequency: number, start: number, duration: number]>> = {
  order: [
    [880, 0, 0.14],
    [1175, 0.16, 0.2],
  ],
  // Three insistent beeps: a customer waiting on a person is more urgent than a new order.
  help: [
    [988, 0, 0.16],
    [988, 0.24, 0.16],
    [988, 0.48, 0.24],
  ],
};

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Constructor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  context ??= new Constructor();
  return context;
}

/** Call from a click handler: unlocks audio for the rest of the session. */
export async function unlockAlerts(): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.state === "running";
  } catch {
    return false;
  }
}

export function playAlert(kind: AlertKind): void {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  for (const [frequency, start, duration] of PATTERNS[kind]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.35, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + duration + 0.02);
  }
}
