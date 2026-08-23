"use client";

import { useCallback, useRef, useState } from "react";
import { encode, decode, Meta, Scheme, EncodedImage } from "@/lib/codec";
import { printScan, undoGamma, expandBlocks, shrinkBlocks, DAMAGE_PRESETS, Damage } from "@/lib/channel";
import { toHilbertSquare, fromHilbertSquare } from "@/lib/layout";
import { snrDb, correlation } from "@/lib/metrics";
import { floatToWavBlob, decodeAudioFile, fetchSample, SAMPLES } from "@/lib/wav";
import { detectMarkers, computeHomography, layoutPage, sampleBlocksViaHomography, drawMarker, PageLayout } from "@/lib/aruco";

type SampleName = keyof typeof SAMPLES;
type LayoutMode = "strip" | "hilbert";

interface RunResult {
  originalUrl: string;
  decodedUrl: string;
  encodedCanvasUrl: string;
  damagedCanvasUrl: string;
  printableUrl: string;
  snr: number;
  correlation: number;
  imageDims: string;
  seconds: number;
}

/** What a camera capture needs to decode against: the exact settings and
 * dimensions of whatever was actually printed or shown on screen. */
interface PrintSession {
  meta: Meta;
  blockSize: number;
  layoutMode: LayoutMode;
  squareInfo: { side: number; nCells: number } | null;
  encWidth: number;
  encHeight: number;
  codeWidth: number;
  codeHeight: number;
  page: PageLayout;
  originalSamples: Float64Array;
  sr: number;
}

interface CameraResult {
  thumbUrl: string;
  audioUrl: string;
  snr: number;
  correlation: number;
}

/** Shape of the bundled print_target.json, written by scripts/make_print_target.py
 * (Python keeps snake_case field names; converted to Meta below). */
interface PrintTargetFile {
  meta: {
    scheme: Scheme;
    sr: number;
    n_fft: number;
    hop: number;
    ref: number;
    anchor: number;
    n_samples: number;
    block: number;
  };
  code_area_px: [number, number];
  code_corners_px: { top_left: [number, number] };
  marker_centers_px: Record<string, [number, number]>;
}

const SR = 16000;
const N_FFT = 1024;
const HOP = 256;

function printImage(dataUrl: string) {
  const win = window.open("", "_blank", "width=600,height=800");
  if (!win) return;
  win.document.write(`<!doctype html><title>Print</title><style>
    @page { margin: 0.5in; }
    body { margin: 0; display: flex; align-items: center; justify-content: center; }
    img { max-width: 100%; image-rendering: pixelated; }
  </style><img src="${dataUrl}">`);
  win.document.close();
  const img = win.document.querySelector("img");
  const trigger = () => { win.focus(); win.print(); };
  if (img && !img.complete) img.addEventListener("load", trigger);
  else trigger();
}

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

  const scanVideoRef = useRef<HTMLVideoElement>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);
  const [scanOn, setScanOn] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanAspect, setScanAspect] = useState(1464 / 2052);

  const sessionRef = useRef<PrintSession | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraResult, setCameraResult] = useState<CameraResult | null>(null);
  const [codeAspect, setCodeAspect] = useState(1);

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

  const loadRealSpeech = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { samples, sr } = await fetchSample("/samples/speech.wav", SR);
      setUploaded({ samples, sr, name: "speech.wav (real recorded voice)" });
    } catch (e) {
      setError(`could not load sample: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const openScanCamera = useCallback(async () => {
    setScanError(null);
    try {
      try {
        const res = await fetch("/samples/print_target.json");
        if (res.ok) {
          const target: PrintTargetFile = await res.json();
          const [w, h] = target.code_area_px;
          setScanAspect(w / h);
        }
      } catch {
        // guide box keeps its default aspect ratio if this fails
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      scanStreamRef.current = stream;
      if (scanVideoRef.current) {
        scanVideoRef.current.srcObject = stream;
        await scanVideoRef.current.play();
      }
      setScanOn(true);
    } catch (e) {
      setScanError(`could not open camera: ${(e as Error).message}`);
    }
  }, []);

  const closeScanCamera = useCallback(() => {
    scanStreamRef.current?.getTracks().forEach((t) => t.stop());
    scanStreamRef.current = null;
    setScanOn(false);
  }, []);

  const captureAndScan = useCallback(async () => {
    const video = scanVideoRef.current;
    if (!video) return;
    setScanBusy(true);
    setScanError(null);
    try {
      const res = await fetch("/samples/print_target.json");
      if (!res.ok) throw new Error(`could not load print_target.json: ${res.status}`);
      const target: PrintTargetFile = await res.json();
      const [codeWidth, codeHeight] = target.code_area_px;
      const m = target.meta;
      const meta: Meta = {
        scheme: m.scheme,
        sr: m.sr,
        nFft: m.n_fft,
        hop: m.hop,
        ref: m.ref,
        anchor: m.anchor,
        nSamples: m.n_samples,
      };

      const vw = video.videoWidth, vh = video.videoHeight;
      const shot = document.createElement("canvas");
      shot.width = vw;
      shot.height = vh;
      const ctx = shot.getContext("2d")!;
      ctx.drawImage(video, 0, 0, vw, vh);
      const frame = ctx.getImageData(0, 0, vw, vh).data;

      const found = detectMarkers(vw, vh, frame);
      const byId = new Map(found.map((f) => [f.id, f.center]));
      const missing = [0, 1, 2, 3].filter((id) => !byId.has(id));
      if (missing.length) {
        throw new Error(`only found markers [${[...byId.keys()].sort()}], missing [${missing}] — `
          + "hold the page flatter, better lit, and make sure all four corner markers are in frame");
      }

      const srcPts = [0, 1, 2, 3].map((id) => byId.get(id)!);
      const dstPts = [0, 1, 2, 3].map((id) => {
        const [x, y] = target.marker_centers_px[String(id)];
        return { x, y };
      });
      const H = computeHomography(srcPts, dstPts);
      const [x0, y0] = target.code_corners_px.top_left;

      const shrunkData = sampleBlocksViaHomography(vw, vh, new Uint8ClampedArray(frame), H, x0, y0, codeWidth, codeHeight, m.block);
      const binsW = Math.floor(codeWidth / m.block), binsH = Math.floor(codeHeight / m.block);
      const y = decode(binsW, binsH, shrunkData, meta);

      setUploaded({ samples: y, sr: m.sr, name: "scanned printed page (camera)" });
      closeScanCamera();
    } catch (e) {
      setScanError((e as Error).message);
      console.error(e);
    } finally {
      setScanBusy(false);
    }
  }, [closeScanCamera]);

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

      // The printable page adds four corner ArUco markers around the code
      // area so a camera photo of it (crumpled, tilted, any distance) can be
      // located and perspective-corrected before decoding, the same way
      // scripts/make_print_target.py does on the Python side. Without this a
      // camera capture has to assume perfect framing, which fails the
      // moment the shot isn't square-on.
      const page = layoutPage(expanded.width, expanded.height);
      const printableCanvas = document.createElement("canvas");
      printableCanvas.width = page.pageWidth;
      printableCanvas.height = page.pageHeight;
      const pageCtx = printableCanvas.getContext("2d")!;
      pageCtx.fillStyle = "white";
      pageCtx.fillRect(0, 0, page.pageWidth, page.pageHeight);
      pageCtx.putImageData(new ImageData(new Uint8ClampedArray(expanded.data), expanded.width, expanded.height), page.codeX0, page.codeY0);
      for (const id of [0, 1, 2, 3]) {
        const p = page.markerPositions[id];
        drawMarker(pageCtx, id, p.x, p.y, page.markerSize);
      }

      sessionRef.current = {
        meta: enc.meta,
        blockSize,
        layoutMode,
        squareInfo,
        encWidth: enc.width,
        encHeight: enc.height,
        codeWidth: expanded.width,
        codeHeight: expanded.height,
        page,
        originalSamples: x,
        sr,
      };
      setCameraResult(null);
      setCodeAspect(page.pageWidth / page.pageHeight);

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
        printableUrl: printableCanvas.toDataURL(),
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

  const openCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (e) {
      setCameraError(`could not open camera: ${(e as Error).message}`);
    }
  }, []);

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const captureFromCamera = useCallback(() => {
    const session = sessionRef.current;
    const video = videoRef.current;
    if (!session || !video) return;
    setCameraBusy(true);
    setCameraError(null);
    try {
      const { codeWidth, codeHeight, page } = session;
      const vw = video.videoWidth, vh = video.videoHeight;
      const shot = document.createElement("canvas");
      shot.width = vw;
      shot.height = vh;
      const ctx = shot.getContext("2d")!;
      ctx.drawImage(video, 0, 0, vw, vh);
      const frame = ctx.getImageData(0, 0, vw, vh).data;

      const found = detectMarkers(vw, vh, frame);
      const byId = new Map(found.map((f) => [f.id, f.center]));
      const missing = [0, 1, 2, 3].filter((id) => !byId.has(id));
      if (missing.length) {
        throw new Error(`only found markers [${[...byId.keys()].sort()}], missing [${missing}] — `
          + "fill the box with the whole printed page, hold it flatter, or improve lighting");
      }

      const srcPts = [0, 1, 2, 3].map((id) => byId.get(id)!);
      const dstPts = [0, 1, 2, 3].map((id) => page.markerCenters[id]);
      const H = computeHomography(srcPts, dstPts);

      const shrunkData = sampleBlocksViaHomography(vw, vh, new Uint8ClampedArray(frame), H, page.codeX0, page.codeY0, codeWidth, codeHeight, session.blockSize);
      let finalData = shrunkData;
      let finalWidth = Math.floor(codeWidth / session.blockSize);
      let finalHeight = Math.floor(codeHeight / session.blockSize);
      if (session.layoutMode === "hilbert" && session.squareInfo) {
        finalData = fromHilbertSquare(session.squareInfo.side, shrunkData, session.encWidth, session.encHeight, session.squareInfo.nCells);
        finalWidth = session.encWidth;
        finalHeight = session.encHeight;
      }

      const y = decode(finalWidth, finalHeight, finalData, session.meta);
      const audioUrl = URL.createObjectURL(floatToWavBlob(y, session.sr));

      setCameraResult({
        thumbUrl: shot.toDataURL(),
        audioUrl,
        snr: snrDb(session.originalSamples, y),
        correlation: correlation(session.originalSamples, y),
      });
    } catch (e) {
      setCameraError((e as Error).message);
      console.error(e);
    } finally {
      setCameraBusy(false);
    }
  }, []);

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
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-neutral-400">synthetic (instant)</p>
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
              <p className="mt-3 mb-1.5 text-[10px] uppercase tracking-wide text-neutral-400">real recorded audio</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={loadRealSpeech}
                  className={`rounded-full px-3 py-1.5 text-sm ${
                    uploaded?.name.startsWith("speech.wav")
                      ? "bg-rose-600 text-white"
                      : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  speech (voice, 5.9s)
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-rose-400 dark:border-neutral-700 dark:text-neutral-400"
                >
                  {uploaded ? `✓ ${uploaded.name}` : "or upload your own audio file…"}
                </button>
                <button
                  onClick={scanOn ? closeScanCamera : openScanCamera}
                  title="Scan the printed page you already have (artifacts/print_target.png) with your camera"
                  className="rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-rose-400 dark:border-neutral-700 dark:text-neutral-400"
                >
                  📷
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />

              <div className={`mt-2 space-y-2 ${scanOn ? "" : "hidden"}`}>
                <div className="relative overflow-hidden rounded-lg bg-black">
                  <video ref={scanVideoRef} muted playsInline className="w-full" />
                  <div
                    className="pointer-events-none absolute inset-4 border-2 border-dashed border-rose-400/80"
                    style={{ aspectRatio: scanAspect }}
                  />
                </div>
                <p className="text-xs text-neutral-500">
                  Fill the box with the printed page (the one sent from this project — speech,
                  hsv, 4&times;4 blocks), then scan. Decodes it as your source audio.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={captureAndScan}
                    disabled={scanBusy}
                    className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    {scanBusy ? "decoding…" : "Scan"}
                  </button>
                  <button
                    onClick={closeScanCamera}
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
                  >
                    Close
                  </button>
                </div>
              </div>
              {scanError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{scanError}</p>}
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

                <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">
                      Printable page (no simulated damage)
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => printImage(result.printableUrl)}
                        className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
                      >
                        Print
                      </button>
                      <a
                        href={result.printableUrl}
                        download="visualize-sound-page.png"
                        className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
                      >
                        Download PNG
                      </a>
                    </div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.printableUrl} alt="full-resolution printable page" className="mx-auto max-h-72 rounded border border-neutral-200 dark:border-neutral-800" style={{ imageRendering: "pixelated" }} />
                  <p className="mt-2 text-xs text-neutral-500">
                    Print this, or show it on another screen, then use the camera below to test it for real —
                    no simulated damage involved, whatever the camera actually sees.
                  </p>
                </div>

                <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <p className="mb-2 font-mono text-xs uppercase tracking-wide text-neutral-500">
                    Live camera test
                  </p>
                  <button
                    onClick={openCamera}
                    className={`w-full rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-rose-400 dark:border-neutral-700 dark:text-neutral-400 ${cameraOn ? "hidden" : ""}`}
                  >
                    📷 Open camera
                  </button>
                  <div className={`space-y-3 ${cameraOn ? "" : "hidden"}`}>
                    <div className="relative overflow-hidden rounded-lg bg-black">
                      <video ref={videoRef} muted playsInline className="w-full" />
                      <div
                        className="pointer-events-none absolute inset-6 border-2 border-dashed border-rose-400/80"
                        style={{ aspectRatio: codeAspect }}
                      />
                    </div>
                    <p className="text-xs text-neutral-500">
                      Fill the dashed box with the printed or on-screen page, hold steady, then capture.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={captureFromCamera}
                        disabled={cameraBusy}
                        className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                      >
                        {cameraBusy ? "decoding…" : "Capture & decode"}
                      </button>
                      <button
                        onClick={closeCamera}
                        className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  {cameraError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{cameraError}</p>}

                  {cameraResult && (
                    <div className="mt-4 space-y-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                      <div className="flex gap-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cameraResult.thumbUrl} alt="captured frame" className="h-24 w-24 flex-none rounded border border-neutral-200 object-cover dark:border-neutral-800" />
                        <div className="flex-1 space-y-2">
                          <audio controls src={cameraResult.audioUrl} className="w-full" />
                          <div className="flex gap-4 text-xs text-neutral-600 dark:text-neutral-400">
                            <span>SNR: <strong>{Number.isFinite(cameraResult.snr) ? `${cameraResult.snr.toFixed(1)} dB` : "∞"}</strong></span>
                            <span>Correlation: <strong>{cameraResult.correlation.toFixed(3)}</strong></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
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
