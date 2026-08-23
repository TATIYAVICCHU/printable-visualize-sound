# Visualize Sound — interactive lab

A browser-based lab for the encoding tested in the [root project](../README.md):
sound → phase-aware color spectrogram → optional Hilbert-curve square fold →
simulated print-scan damage → decode → listen. Everything runs client-side, in
TypeScript ports of the Python reference implementation in
[`../vsound/`](../vsound/) — no backend, one static bundle.

## Develop

```bash
npm install
npm run dev
```

## Deploy

Static output, zero server functions — point a Vercel project at this
directory (`web/` as the project root) and deploy. No environment variables,
no API routes, no backend to configure.

```bash
npm run build   # verifies the production build locally first
```

## What's ported from the Python code

| File | Ports |
| --- | --- |
| `lib/fft.ts` | radix-2 FFT, used by `stft.ts` (no equivalent Python file — NumPy provides this) |
| `lib/stft.ts` | `vsound/stft.py` — STFT/ISTFT, Griffin-Lim |
| `lib/codec.ts` | `vsound/codec.py` — hsv / ifreq / gray encode-decode |
| `lib/layout.ts` | `vsound/layout.py` — Hilbert curve square fold |
| `lib/channel.ts` | `vsound/channel.py` — simulated print-scan damage, block resolution |
| `lib/metrics.ts` | `vsound/metrics.py` — SNR, correlation (PESQ/STOI have no lightweight JS port and are omitted here; use the Python scripts for those) |
| `lib/wav.ts` | `scripts/make_samples.py` — synthetic test clips, plus WAV encode/decode for the browser |

Numbers were spot-checked against the Python `e0_baseline.py` output and match
(chirp, `hsv` scheme, digital round trip: 46.2 dB here vs. 46.16 dB in Python).
