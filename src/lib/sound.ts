// Small synthesized sounds (no audio files to license or download).
let ctx: AudioContext | null = null;
let enabled = true;
export const setSoundEnabled = (on: boolean) => { enabled = on; };

function tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.08, delay = 0) {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur);
  } catch { /* audio unavailable */ }
}

export const sounds = {
  move: () => tone(220, 0.07, "triangle", 0.12),
  capture: () => { tone(160, 0.09, "square", 0.05); tone(320, 0.05, "triangle", 0.08); },
  wrong: () => { tone(196, 0.16, "sawtooth", 0.04); tone(147, 0.22, "sawtooth", 0.04, 0.08); },
  solved: () => { tone(523, 0.12, "sine", 0.07); tone(659, 0.12, "sine", 0.07, 0.09); tone(784, 0.2, "sine", 0.07, 0.18); },
};
