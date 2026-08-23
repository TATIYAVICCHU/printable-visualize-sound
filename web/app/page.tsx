"use client";

import { useCallback, useRef, useState } from "react";
import { encode, decode, Scheme, EncodedImage } from "@/lib/codec";
import { printScan, undoGamma, expandBlocks, shrinkBlocks, DAMAGE_PRESETS, Damage } from "@/lib/channel";
import { toHilbertSquare, fromHilbertSquare } from "@/lib/layout";
import { snrDb, correlation } from "@/lib/metrics";
import { floatToWavBlob, decodeAudioFile, SAMPLES } from "@/lib/wav";

type SampleName = keyof typeof SAMPLES;
type LayoutMode = "strip" | "hilbert";

interface RunResult {
  originalUrl: string;
  decodedUrl: string;
  encodedCanvasUrl: string;
  damagedCanvasUrl: string;
  snr: number;
  correlation: number;
  imageDims: string;
  seconds: number;
}

const SR = 16000;
const N_FFT = 1024;
const HOP = 256;

function drawToCanvas(width: number, height: number, data: Uint8ClampedArray): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

export default function Home() {
  const [sample, setSample] = useState<SampleName>("chirp");
  const [uploaded, setUploaded] = useState<{ samples: Float64Array; sr: number; name: string } | null>(null);
  const [scheme, setScheme] = useState<Scheme>("hsv");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("strip");
  const [blockSize, setBlockSize] = useState(1);
  const [damagePreset, setDamagePreset] = useState<keyof typeof DAMAGE_PRESETS>("clean");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { samples, sr } = await decodeAudioFile(file, SR);
      setUploaded({ samples, sr, name: file.name });
    } catch (e) {
      setError(`could not decode audio file: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const x = uploaded ? uploaded.samples : SAMPLES[sample](SR);
      const sr = uploaded ? uploaded.sr : SR;

      const enc: EncodedImage = encode(x, sr, scheme, N_FFT, HOP, scheme === "ifreq" ? 8 : 0);
      let { width, height, data } = enc;

      let squareInfo: { side: number; nCells: number } | null = null;
      if (layoutMode === "hilbert") {
        const sq = toHilbertSquare(width, height, data);
        squareInfo = { side: sq.side, nCells: sq.nCells };
        width = sq.side; height = sq.side; data = sq.data;
      }

      const encodedCanvas = drawToCanvas(width, height, data);

      const damage: Damage = DAMAGE_PRESETS[damagePreset];
      const expanded = expandBlocks(width, height, data, blockSize);
      const damagedRaw = printScan(expanded.width, expanded.height, expanded.data, damage);
      const shrunk = shrinkBlocks(expanded.width, expanded.height, damagedRaw, blockSize);
      const damagedData = undoGamma(shrunk.width, shrunk.height, shrunk.data, damage.gamma);

      const damagedCanvas = drawToCanvas(shrunk.width, shrunk.height, damagedData);

      let finalData = damagedData;
      let finalWidth = shrunk.width;
      let finalHeight = shrunk.height;
      if (layoutMode === "hilbert" && squareInfo) {
        finalData = fromHilbertSquare(squareInfo.side, damagedData, enc.width, enc.height, squareInfo.nCells);
        finalWidth = enc.width;
        finalHeight = enc.height;
      }

      const y = decode(finalWidth, finalHeight, finalData, enc.meta);

      const originalUrl = URL.createObjectURL(floatToWavBlob(x, sr));
      const decodedUrl = URL.createObjectURL(floatToWavBlob(y, sr));

      setResult({
        originalUrl,
        decodedUrl,
        encodedCanvasUrl: encodedCanvas.toDataURL(),
        damagedCanvasUrl: damagedCanvas.toDataURL(),
        snr: snrDb(x, y),
        correlation: correlation(x, y),
        imageDims: `${enc.width}×${enc.height} → page ${expanded.width}×${expanded.height}px (${blockSize}×${blockSize} block)`,
        seconds: x.length / sr,
      });
    } catch (e) {
      setError((e as Error).message);
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [uploaded, sample, scheme, layoutMode, blockSize, damagePreset]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <p className="font-mono text-xs uppercase tracking-widest text-rose-600 dark:text-rose-400">
          Visualize Sound &middot; interactive lab
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Encode sound as color, damage the page, listen to what survives
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-600 dark:text-neutral-400">
          Runs entirely in your browser &mdash; the same STFT / phase-as-hue / Hilbert-curve /
          simulated print-scan pipeline as the Python research code, ported to TypeScript so it can
          run live, no server involved.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[320px_1fr]">
          {/* Controls */}
          <div className="space-y-6 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Source audio
              </label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(SAMPLES) as SampleName[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => { setSample(s); setUploaded(null); }}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      !uploaded && sample === s
                        ? "bg-rose-600 text-white"
                        : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 w-full rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-rose-400 dark:border-neutral-700 dark:text-neutral-400"
              >
                {uploaded ? `✓ ${uploaded.name}` : "or upload your own audio file…"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Color scheme
              </label>
              <div className="flex flex-wrap gap-2">
                {(["hsv", "ifreq", "gray"] as Scheme[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScheme(s)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      scheme === s
                        ? "bg-rose-600 text-white"
                        : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                hsv = raw phase as hue &middot; ifreq = phase derivative &middot; gray = magnitude only
              </p>
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Page layout
              </label>
              <div className="flex gap-2">
                {(["strip", "hilbert"] as LayoutMode[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLayoutMode(l)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      layoutMode === l
                        ? "bg-rose-600 text-white"
                        : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Pixels per bin: {blockSize}&times;{blockSize}
              </label>
              <input
                type="range"
                min={1}
                max={8}
                value={blockSize}
                onChange={(e) => setBlockSize(Number(e.target.value))}
                className="w-full accent-rose-600"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Simulated print-scan damage
              </label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(DAMAGE_PRESETS) as (keyof typeof DAMAGE_PRESETS)[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDamagePreset(d)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      damagePreset === d
                        ? "bg-rose-600 text-white"
                        : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={run}
              disabled={busy}
              className="w-full rounded-lg bg-rose-600 px-4 py-2.5 font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              {busy ? "running…" : "Encode → damage → decode"}
            </button>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>

          {/* Results */}
          <div className="space-y-6">
            {!result && (
              <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-neutral-300 text-neutral-400 dark:border-neutral-700">
                Pick a clip and settings, then run the pipeline.
              </div>
            )}
            {result && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                    <p className="mb-2 font-mono text-xs uppercase tracking-wide text-neutral-500">
                      Encoded (clean)
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={result.encodedCanvasUrl} alt="clean encoded image" className="w-full rounded border border-neutral-200 dark:border-neutral-800" style={{ imageRendering: "pixelated" }} />
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                    <p className="mb-2 font-mono text-xs uppercase tracking-wide text-neutral-500">
                      After simulated print + scan
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={result.damagedCanvasUrl} alt="damaged encoded image" className="w-full rounded border border-neutral-200 dark:border-neutral-800" style={{ imageRendering: "pixelated" }} />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                    <p className="mb-2 font-mono text-xs uppercase tracking-wide text-neutral-500">Original audio</p>
                    <audio controls src={result.originalUrl} className="w-full" />
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                    <p className="mb-2 font-mono text-xs uppercase tracking-wide text-neutral-500">Recovered audio</p>
                    <audio controls src={result.decodedUrl} className="w-full" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="SNR" value={Number.isFinite(result.snr) ? `${result.snr.toFixed(1)} dB` : "∞"} />
                  <Stat label="Correlation" value={result.correlation.toFixed(3)} />
                  <Stat label="Duration" value={`${result.seconds.toFixed(1)}s`} />
                  <Stat label="Image size" value={result.imageDims} small />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <p className="font-mono text-[10px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-1 font-semibold ${small ? "text-xs" : "text-lg"}`}>{value}</p>
    </div>
  );
}
