/** Every sound is synthesized on the spot with Web Audio; there are no audio files. */
export function createSound() {
  let ac = null, out = null, muted = false;
  try { muted = localStorage.getItem("feeling-sound") === "off"; } catch {}
  let silenced = false;
  function ready() {
    if (muted || silenced) return false;
    if (!ac) { ac = new AudioContext(); out = ac.createGain(); out.gain.value = 0.7; out.connect(ac.destination); }
    ac.resume();
    return true;
  }
  function blip(freq, peak, length, delay = 0, type = "sine", slide = 0) {
    if (!ac || !ready()) return;
    const osc = ac.createOscillator(), gain = ac.createGain(), at = ac.currentTime + delay;
    osc.type = type; osc.frequency.setValueAtTime(freq, at);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), at + length);
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(peak, at + 0.005); gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(out); osc.start(at); osc.stop(at + length + 0.05);
  }
  function noise(peak, length, cutoff) {
    if (!ac || !ready()) return;
    const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * length), ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = ac.createBufferSource(), filter = ac.createBiquadFilter(), gain = ac.createGain();
    src.buffer = buffer; filter.type = "bandpass"; filter.frequency.value = cutoff; filter.Q.value = 0.8; gain.gain.value = peak;
    src.connect(filter).connect(gain).connect(out); src.start();
  }
  const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
  return {
    get muted() { return muted; },
    wake: () => ready(),
    meaning: (i) => blip(scale[i % scale.length], 0.03, 0.4),
    tick: (level) => blip(440 * 2 ** ((level * 4) / 12), 0.04, 0.07, 0, "triangle"),
    swap: () => { blip(880, 0.02, 0.06); blip(1174.66, 0.02, 0.08, 0.05); },
    plant: (level) => { blip(level ? 196 : 147, 0.08, 0.5); if (level) blip(392 * 2 ** (level / 12), 0.035, 0.9, 0.06); },
    unpin: () => blip(147, 0.05, 0.25, 0, "triangle"),
    save: (count) => { [523.25, 659.25, 783.99, 1046.5].slice(0, Math.min(4, count + 1)).forEach((f, i) => blip(f, 0.035, 0.9, i * 0.07)); },
    charge: (combo) => blip(300 + combo * 90, 0.04, 0.06, 0, "square"),
    crack: () => blip(1600, 0.03, 0.05, 0, "square"),
    shatter: (pieces) => { noise(0.25, 0.35, 2200); noise(0.15, 0.5, 700); blip(220, 0.06, 0.4, 0, "sawtooth", 0.3); },
    grow: () => blip(330, 0.04, 0.35, 0, "sine", 2),
    /** Quiet without changing the saved preference, for when the tour plays by itself. */
    silence(on) { silenced = on; },
    toggle() { muted = !muted; try { localStorage.setItem("feeling-sound", muted ? "off" : "on"); } catch {} },
  };
}
