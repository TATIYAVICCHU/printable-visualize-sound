/** Minimal WAV encode/decode and a few synthetic test clips, browser-side. */

export function floatToWavBlob(samples: Float64Array | Float32Array, sr: number): Blob {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, n * 2, true);

  let offset = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export async function decodeAudioBuffer(arrayBuffer: ArrayBuffer, targetSr = 16000): Promise<{ samples: Float64Array; sr: number }> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const decoded = await ctx.decodeAudioData(arrayBuffer);

  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSr), targetSr);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  await ctx.close();
  return { samples: Float64Array.from(rendered.getChannelData(0)), sr: targetSr };
}

export async function decodeAudioFile(file: File, targetSr = 16000): Promise<{ samples: Float64Array; sr: number }> {
  return decodeAudioBuffer(await file.arrayBuffer(), targetSr);
}

/** Fetch a bundled sample (e.g. from /public/samples/) and decode it. */
export async function fetchSample(url: string, targetSr = 16000): Promise<{ samples: Float64Array; sr: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url}: ${res.status}`);
  return decodeAudioBuffer(await res.arrayBuffer(), targetSr);
}

function normalize(x: Float64Array, peak = 0.9): Float64Array {
  let max = 0;
  for (const v of x) max = Math.max(max, Math.abs(v));
  const scale = max > 1e-9 ? peak / max : 1;
  return Float64Array.from(x, (v) => v * scale);
}

export function makeChirp(sr = 16000, duration = 2): Float64Array {
  const n = Math.round(sr * duration);
  const out = new Float64Array(n);
  let phase = 0;
  const f0 = 80, f1 = 4000;
  for (let i = 0; i < n; i++) {
    const tt = i / (n - 1);
    const f = f0 * Math.pow(f1 / f0, tt);
    phase += (2 * Math.PI * f) / sr;
    out[i] = Math.sin(phase);
  }
  return normalize(out);
}

export function makeMusic(sr = 16000, duration = 4): Float64Array {
  const n = Math.round(sr * duration);
  const out = new Float64Array(n);
  const chords = [
    [261.63, 329.63, 392.0],
    [220.0, 277.18, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
  ];
  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    for (let j = 0; j < chord.length; j++) {
      const f0 = chord[j];
      const onset = i * 1.0 + j * 0.12;
      const harmonics = [1.0, 0.5, 0.28, 0.14];
      for (let k = 0; k < n; k++) {
        const t = k / sr;
        if (t < onset) continue;
        const env = Math.exp(-(t - onset) * 2.2);
        for (let h = 0; h < harmonics.length; h++) {
          out[k] += harmonics[h] * env * Math.sin(2 * Math.PI * f0 * (h + 1) * t);
        }
      }
    }
  }
  return normalize(out);
}

export function makeEnvironment(sr = 16000, duration = 3): Float64Array {
  const n = Math.round(sr * duration);
  const out = new Float64Array(n);
  let s = 7;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand());
  for (let i = 0; i < n; i++) out[i] = 0.15 * Math.sin((2 * Math.PI * 120 * i) / sr);
  for (const onset of [0.3, 1.1, 1.9, 2.4]) {
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if (t < onset) continue;
      const env = Math.exp(-(t - onset) * 12.0);
      out[i] += env * gauss();
    }
  }
  return normalize(out);
}

export const SAMPLES = {
  chirp: makeChirp,
  music: makeMusic,
  environment: makeEnvironment,
};
