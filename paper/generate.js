const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  ImageRun, Header, Footer, PageNumber, LevelFormat, convertInchesToTwip,
  Tab, TabStopType, TabStopPosition, VerticalAlign,
} = require("docx");

const ROOT = path.resolve(__dirname, "..");
const FIG = (name) => path.join(ROOT, "assets", "figures", name);
const PRINT_TARGET = path.join(ROOT, "artifacts", "print_target.png");

const FONT = "Times New Roman";
const BODY_SIZE = 24; // half-points -> 12pt
const SMALL_SIZE = 20; // 10pt

function imgDims(file, maxWidthPx) {
  const sizeOf = require("image-size").default || require("image-size");
  const dim = sizeOf(fs.readFileSync(file));
  const scale = Math.min(1, maxWidthPx / dim.width);
  return { width: Math.round(dim.width * scale), height: Math.round(dim.height * scale) };
}

function body(text, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.JUSTIFIED,
    spacing: { after: 160, line: 288 }, // 1.2x line spacing
    indent: opts.firstLine ? { firstLine: convertInchesToTwip(0.3) } : undefined,
    children: Array.isArray(text) ? text : [new TextRun({ text, font: FONT, size: BODY_SIZE, italics: opts.italics, bold: opts.bold })],
  });
}

function rich(parts) {
  // parts: array of {text, bold, italics}
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 160, line: 288 },
    children: parts.map((p) => new TextRun({ text: p.text, font: FONT, size: BODY_SIZE, bold: p.bold, italics: p.italics, superScript: p.sup })),
  });
}

function h1(num, text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text: `${num}. ${text}`, font: FONT, bold: true, size: 28, color: "000000" })],
  });
}

function h2(num, text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text: `${num} ${text}`, font: FONT, bold: true, size: 26, color: "000000" })],
  });
}

function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 240 },
    children: [new TextRun({ text, font: FONT, size: SMALL_SIZE, italics: true })],
  });
}

function figure(file, maxWidthPx, capText) {
  const dims = imgDims(file, maxWidthPx);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 0 },
      children: [
        new ImageRun({
          type: "png",
          data: fs.readFileSync(file),
          transformation: { width: dims.width, height: dims.height },
        }),
      ],
    }),
    caption(capText),
  ];
}

// ---- table helper -----------------------------------------------------
function cell(text, opts = {}) {
  return new TableCell({
    width: { size: opts.width || 1000, type: WidthType.DXA },
    shading: opts.header ? { type: ShadingType.CLEAR, fill: "D9D9D9" } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.CENTER,
      children: [new TextRun({ text, font: FONT, size: SMALL_SIZE, bold: opts.header || opts.bold })],
    })],
  });
}

function dataTable(columnWidthsDxa, headerRow, rows) {
  const totalWidth = columnWidthsDxa.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: columnWidthsDxa,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "999999" },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headerRow.map((t, i) => cell(t, { header: true, width: columnWidthsDxa[i] })),
      }),
      ...rows.map((r) => new TableRow({
        children: r.map((t, i) => cell(t, { width: columnWidthsDxa[i], bold: i === 0 })),
      })),
    ],
  });
}

function tableCaption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text, font: FONT, size: SMALL_SIZE, bold: true })],
  });
}

function refItem(num, text) {
  return new Paragraph({
    spacing: { after: 140, line: 264 },
    indent: { left: convertInchesToTwip(0.4), hanging: convertInchesToTwip(0.4) },
    children: [new TextRun({ text: `[${num}] `, font: FONT, size: SMALL_SIZE }), new TextRun({ text, font: FONT, size: SMALL_SIZE })],
  });
}

// ---- document -----------------------------------------------------------

const children = [];

// Title block
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: "When Does Color Help?", font: FONT, bold: true, size: 32 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: "A Resolution-Dependent Study of Phase Encoding for Printed Audio", font: FONT, bold: true, size: 28 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: "Abhishek Tomar", font: FONT, size: 24 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: "Independent Research", font: FONT, size: 22, italics: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 320 },
    children: [new TextRun({ text: "Draft — not yet submitted or peer reviewed. Working title.", font: FONT, size: SMALL_SIZE, italics: true, color: "555555" })],
  }),
);

// Abstract
children.push(
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [new TextRun({ text: "Abstract", font: FONT, bold: true, size: 26 })],
  }),
  body(
    "We study whether encoding an audio signal's phase as image hue — alongside the well-known magnitude-as-brightness spectrogram encoding — improves the recoverability of sound printed on paper and re-captured by camera. Prior work (Newhouse, US Patent 10,341,795) shows phase-as-hue encoding is digitally near-lossless, and prior systems (PhonoPaper) show a magnitude-only, phase-discarded encoding survives printing and phone-camera capture, but no published work has tested whether the more informative phase-carrying encoding actually survives the same physical channel, or quantified when it does. We show that at native resolution (one color pixel per time–frequency bin), phase-as-hue is dramatically worse than magnitude-only under simulated print-and-recapture damage (PESQ 1.06 vs. 2.59), inverting its clean digital advantage (PESQ 4.59 vs. 3.69). We then show this inversion is resolution-dependent: spending more printed pixels per bin (up to 8×8) lets the phase-carrying encoding recover and exceed the magnitude-only ceiling (PESQ 4.35 vs. 3.66), because magnitude-only is fundamentally capped by blind phase reconstruction while phase-carrying color is not. We further address a practical barrier to testing any such encoding physically — locating an unregistered printed page in an arbitrary photograph — with a fiducial-marker (ArUco) pipeline that recovers geometry robustly under simulated rotation, skew, blur, sensor noise, and JPEG compression (PESQ 3.01, STOI 0.96, vs. near-total failure under a naive center-crop). We release the encoding pipeline, the simulated-channel harness, and an in-browser interactive replication (TypeScript, no backend) alongside this draft.",
    { indent: false },
  ),
);

// 1. Introduction
children.push(h1(1, "Introduction"));
children.push(body(
  "A sound recording is a one-dimensional sequence of amplitude samples. An image is a two-dimensional grid of color. Converting one into the other in a principled way — not by an arbitrary reshaping, but by a transform whose axes and reversibility are well-defined — is a solved problem: the Short-Time Fourier Transform (STFT) produces a complex-valued matrix X[f, t], one row per frequency bin, one column per time frame, invertible by construction. What is not settled is what to do with the resulting matrix as a color image, and specifically, whether the extra information in that matrix — each cell's phase, not just its magnitude — is worth keeping once the image has to survive being printed on paper and photographed back.",
));
children.push(body(
  "This question has a directly useful motivation: a color image that encodes sound and degrades gracefully under printing would let audio be embedded in any printed medium — a book, a poster, a physical archive — and recovered with an ordinary camera, no barcode reader or specialized hardware required. It also has a purely descriptive one: a color spectrogram is a plausible way to look at a sound (Figure 1 shows example renderings of speech, music, and noise), and understanding what visually distinguishes different sounds under such an encoding is of independent interest.",
));
children.push(body(
  "The existing literature answers half the question. Newhouse's 2019 patent demonstrates that encoding magnitude as brightness and phase as hue is digitally reversible — image in, sound out, with negligible loss. Separately, PhonoPaper (2014), an app with no accompanying publication, demonstrates that a magnitude-only grayscale spectrogram survives being printed and recaptured by a phone camera, at the cost of needing to statistically guess the discarded phase on the way back (via Griffin–Lim reconstruction), producing recognizable but degraded audio. No published work we are aware of tests whether the phase-carrying encoding — strictly more informative, digitally superior — actually survives the same physical channel PhonoPaper was built for, or explains why every such system in practice reaches for grayscale.",
));
children.push(body(
  "We fill that gap. Our central finding is that the answer depends entirely on spatial resolution: how many printed pixels are spent per encoded value. Below a resolution threshold, phase-carrying color is worse than useless — it is actively harmful, destroying its own extra information under the very degradation any color image experiences in print. Above that threshold, it wins outright, and keeps improving where the magnitude-only approach cannot, because magnitude-only's ceiling is set by guessing a phase it never had. This is, to our knowledge, the first quantified account of that crossover, and it explains — after the fact — why prior printed-audio systems chose grayscale: PhonoPaper's own resolution never crossed the threshold.",
));

children.push(h2("1.1", "Contributions"));
const contribs = [
  "A quantified digital baseline confirming phase-as-hue encoding is near-transparent (PESQ 4.59, STOI 1.000) versus a magnitude-only, Griffin–Lim-reconstructed baseline (PESQ 3.69).",
  "A simulated print-and-recapture channel (ink spread, chroma subsampling, tone-curve shift, sensor noise) showing this advantage inverts at native resolution: phase-as-hue collapses to PESQ 1.06, worse than magnitude-only's 2.59.",
  "A resolution sweep (1×1 to 8×8 printed pixels per encoded value) showing the inversion is resolution-dependent and locating the crossover, with the phase-carrying encoding reaching PESQ 4.35 at 8×8 against magnitude-only's resolution-independent ceiling of ~3.7.",
  "A working fiducial-marker (ArUco) pipeline for locating an unregistered printed page in an arbitrary photograph, without which any physical test of a printed encoding is unreliable — validated on a synthetic photograph with realistic rotation, skew, blur, sensor noise, and JPEG compression (PESQ 3.01, STOI 0.96).",
  "A public, from-scratch reference implementation: the encoder/decoder, channel simulator, and experiment scripts in Python, and a feature-complete, backend-free, in-browser reimplementation in TypeScript for interactive replication.",
];
contribs.forEach((t, i) => children.push(new Paragraph({
  numbering: { reference: "contrib-list", level: 0 },
  spacing: { after: 140, line: 276 },
  children: [new TextRun({ text: t, font: FONT, size: BODY_SIZE })],
})));

children.push(h2("1.2", "Scope and honesty about what is not yet shown"));
children.push(body(
  "Every quantitative result above except the physical-test methodology (Section 5) is measured on a simulated print-and-recapture channel, not a real printed page and a real camera. The simulation models known, individually well-studied degradations (Gaussian blur for ink spread, chroma subsampling matching JPEG/print colorant behavior, a gamma-curve tone shift, additive sensor noise), but it is a model, not a measurement. A real physical trial — print, photograph, decode — using the fiducial marker pipeline described in Section 5 is in progress at the time of this draft and is the immediate next step, not a completed part of this paper. We flag this prominently rather than let a reader infer real-world validation from simulated numbers.",
));

// 2. Related Work
children.push(h1(2, "Related Work"));
children.push(rich([
  { text: "Digital phase-as-hue encoding. ", bold: true },
  { text: "Newhouse (US Patent 10,341,795, “Log complex color for visual pattern recognition of total sound”, 2019) describes exactly the encoding at the center of this paper — amplitude as brightness, phase as hue — and claims full digital reversibility. It is the closest prior art to our encoding itself. It does not test, or discuss, print or camera recapture; every claim in it is digital-only." },
]));
children.push(rich([
  { text: "Printed, camera-recovered audio (magnitude only). ", bold: true },
  { text: "PhonoPaper (Zolotov, 2014) is an app, not a publication, that prints a grayscale (magnitude-only) spectrogram and resynthesizes audio live from a phone camera pointed at the page. It is the closest prior system to the physical half of our work, and the natural magnitude-only baseline our experiments compare against. It reports no formal quality metric, no resolution study, and no explanation for the grayscale design choice; our resolution sweep (Section 4.3) supplies that explanation retroactively." },
]));
children.push(rich([
  { text: "Phase-to-color encodings for machine listening. ", bold: true },
  { text: "A 2021 IEEE paper on HSV-model phase representation for CNN-based acoustic classification uses the same phase-to-hue mapping we do, but for a different objective (classifier accuracy on clean digital images) with no printing or degradation study. Several 2023–2025 arXiv works on audio-to-image encodings for CNN pipelines are adjacent for the same reason: color channels carry audio features for a machine classifier, not for human viewing or physical-channel survival." },
]));
children.push(rich([
  { text: "Print–scan-robust encodings for other data. ", bold: true },
  { text: "StegaStamp (Tancik et al., CVPR 2019) demonstrates that a deep-learned encoding can survive real printing and phone-camera capture at unpredictable position, rotation, and lighting, embedding a 56-bit hyperlink into an otherwise-ordinary photograph. It establishes the print–scan channel as a serious, citable research target and is the direct inspiration for treating channel robustness — not just digital reversibility — as a first-class design variable in this work, though its payload (56 bits) is not comparable in kind to an audio signal. Separately, high-capacity color barcode work (Bulan & Sharma, IEEE TIP 2011) established that spending more printed pixels per encoded value predictably buys back capacity lost to print degradation, via CMY-channel orientation modulation; our resolution sweep is the same idea applied to a continuous, perceptually-graded signal (audio) rather than discrete bits." },
]));
children.push(rich([
  { text: "Physical-medium audio recovery, historical. ", bold: true },
  { text: "Work on recovering audio from century-old sonorine cards via multi-angle photography and computer vision (2020) establishes that recovering sound from a physical, imaged medium is a legitimate, publishable line of research, independent of the specific encoding. Kodak-era patents (e.g., US 8,934,032) describe printed-audio bitstream formats predating both modern deep learning and smartphone cameras; they were never evaluated against a modern metric or entered the research literature, and we treat them as historical context only." },
]));
children.push(rich([
  { text: "Positioning. ", bold: true },
  { text: "No work we found combines: (a) a phase-carrying color encoding, (b) a real or realistically simulated print–scan channel, and (c) a quantified account of when phase-carrying color helps versus hurts relative to a magnitude-only baseline. That combination is this paper's contribution." },
]));

// 3. Method
children.push(h1(3, "Method"));
children.push(h2("3.1", "From waveform to complex spectrogram"));
children.push(body(
  "We compute the Short-Time Fourier Transform of the input signal with a 1024-sample Hann window and 256-sample hop (75% overlap), producing a complex matrix X[f, t] with 513 frequency bins. This is a standard, information-preserving transform: the overlap-add inverse recovers the original waveform exactly (measured control condition, Section 4.1, recovers speech at SNR 74.4 dB — floor set by floating-point precision, not the transform).",
));

children.push(h2("3.2", "Three color encodings"));
children.push(body(
  "Each STFT cell X[f, t] is a complex number, decomposable into magnitude |X| and phase ∠X. We compare three ways of turning this matrix into an 8-bit RGB image, all sharing the same magnitude-to-brightness mapping (log-magnitude, mapped to an 80 dB dynamic range, HSV value channel):",
));
[
  ["hsv: ", "raw phase directly as hue (∠X / 2π mapped to hue's [0, 1) range). Fully information-preserving; decode is a direct algebraic inverse."],
  ["ifreq: ", "hue carries the deviation of each bin's phase from the advance a steady tone at that frequency would produce, periodically re-anchored to absolute phase. Motivated by the phase-vocoder literature's observation that this quantity is smoother than raw phase for tonal content; tested as a candidate fix for hsv's print fragility (Section 4.2) and found not to help enough to matter."],
  ["gray: ", "magnitude only; hue and saturation are discarded (or, equivalently, the image is rendered in grayscale). Decoding requires reconstructing phase from magnitude alone via Griffin–Lim iteration (32 iterations, matching common practice). This is the PhonoPaper-equivalent baseline."],
].forEach(([lead, rest]) => {
  children.push(new Paragraph({
    numbering: { reference: "scheme-list", level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 140, line: 276 },
    children: [new TextRun({ text: lead, font: FONT, bold: true, size: BODY_SIZE }), new TextRun({ text: rest, font: FONT, size: BODY_SIZE })],
  }));
});

children.push(...figure(FIG("gallery.png"), 520, "Figure 1. The same four clips (chirp, music, speech, environmental noise) under phase-as-hue (left column) and magnitude-only (right column) encoding. Raw phase-as-hue is information-complete but reads as pixel-level color speckle rather than a legible pattern — the visual signature of exactly the fragility quantified in Section 4.2."));

children.push(h2("3.3", "From strip to square: a Hilbert-curve fold"));
children.push(body(
  "A spectrogram's natural layout — frequency rows, time columns — produces a long thin strip, not a square picture; the second axis is still time, so this is visually indistinguishable from any conventional spectrogram viewer and defeats the goal of a genuine 2D visual encoding. We fold the sequence of spectrogram cells (read time-frame-major, so a whole instant of sound stays contiguous in the sequence) onto a square page along a Hilbert space-filling curve, which visits every cell of a 2ⁿ×2ⁿ square exactly once with no jumps — consecutive sequence entries are always spatially adjacent. We verified this property holds by construction for curve orders up to 1024 cells (every step moves to a laterally or vertically adjacent cell, zero exceptions) and confirmed the fold is a lossless permutation empirically: decoded audio from the square layout is numerically identical (PESQ 4.59, matching to two decimal places) to the un-folded strip layout. A simpler serpentine (text-wrap) fold is implemented for comparison; it is also lossless but cuts the sequence at fixed row boundaries, placing sequence-neighbors on opposite sides of the page at each cut, unlike the Hilbert fold.",
));
children.push(...figure(FIG("square_layouts.png"), 520, "Figure 2. The same 5.9 s of speech folded onto a square page two ways. Left: serpentine wrap, with cuts visible as clean horizontal bands where each row ends. Right: Hilbert curve, continuous, no cut points. Both decode to bit-identical audio."));

children.push(h2("3.4", "Simulated print-and-recapture channel"));
children.push(body(
  "To evaluate physical-channel survival without requiring a physical trial for every parameter combination, we implement a channel simulator applying, in sequence: Gaussian blur (ink spread), YCbCr chroma subsampling (modeling the disproportionate loss of fine color detail relative to fine brightness detail under printing and lossy compression — the same effect JPEG's chroma subsampling exploits), a gamma tone-curve shift (printed midtones read darker than specified), and additive Gaussian sensor noise. Four severity presets (clean, light, moderate, harsh) parameterize these four effects together. We treat this as a stand-in for, not a replacement of, physical measurement (Sections 1.2 and 5.3).",
));

children.push(h2("3.5", "Spending resolution: block expansion"));
children.push(body(
  "To test whether printed pixel budget changes the outcome, each encoded value (one spectrogram bin, one pixel at native resolution) can be expanded to occupy a b×b block of identical pixels before the channel simulation is applied, then reduced back to one value by averaging the block's interior after damage (trimming the outer ring for b ≥ 4, where bleed from neighboring blocks is concentrated) — analogous to how high-capacity color barcodes trade printed area for per-cell robustness.",
));

children.push(h2("3.6", "Physical-channel localization: fiducial markers"));
children.push(body(
  "Any real photograph of a printed page arrives at an unknown position, rotation, scale, and viewing angle. We locate the page using four ArUco fiducial markers (DICT_ARUCO_ORIGINAL, IDs 0–3 placed clockwise from the top-left corner) printed at the page's corners — the standard technique robotics and augmented-reality systems use for exactly this localization problem. Markers are detected in the photograph (OpenCV's ArUco detector on the Python side; a from-scratch TypeScript reimplementation, js-aruco2, verified bit-for-bit compatible — hamming distance 0 — against the Python-generated markers, on the browser side), giving four point correspondences between detected marker centers and their known positions on the printed page layout. A homography computed from these correspondences maps page coordinates to photograph coordinates; each spectrogram bin's known center position on the page is mapped through the inverse homography and sampled directly from the photograph via bilinear interpolation.",
));
children.push(body(
  "This last detail — sampling each bin's position directly from the original photograph, rather than warping the whole photograph into page coordinates first and then averaging an integer pixel grid over the result — is a correction for a failure mode we discovered empirically during development: the two-step warp-then-average approach compounds enough rounding error (from the warp's own resampling, plus the pixel grid landing a few pixels off true block boundaries) that even a distortion-free synthetic re-photograph decoded to noise. Because hue encodes phase circularly, averaging across a block boundary blends two unrelated phase values into a meaningless color; single-point sampling at each bin's exact known location avoids this second rounding step entirely.",
));
children.push(...figure(PRINT_TARGET, 320, "Figure 3. The physical test page used for Section 5: speech content, hsv scheme, 4×4 pixel blocks, with four ArUco fiducial markers at the corners for automatic localization in an arbitrary photograph."));

// 4. Experiments
children.push(h1(4, "Experiments and Results"));
children.push(body(
  "All experiments use four test clips: real recorded speech (macOS text-to-speech, 5.85 s), a synthetic four-chord arpeggio (“music”, 4.0 s), filtered noise bursts over a low hum (“environment”, 3.0 s), and a linear frequency sweep (“chirp”, 2.0 s, 80–4000 Hz), at 16 kHz sample rate, 1024-sample STFT window, 256-sample hop.",
));

children.push(h2("4.1", "Digital baseline (no channel simulation)"));
children.push(body("Round-tripped through a real 8-bit PNG file with no print simulation involved:"));
children.push(tableCaption("Table 1. Digital round-trip quality, no printing involved."));
children.push(dataTable(
  [1600, 1600, 1800, 1600, 1600],
  ["Clip", "Scheme", "SNR (dB)", "STOI", "PESQ"],
  [
    ["speech", "hsv", "45.3", "1.000", "4.59"],
    ["speech", "gray", "−2.9", "0.991", "3.69"],
    ["music", "hsv", "44.3", "0.965", "4.62"],
    ["music", "gray", "−3.3", "0.770", "1.87"],
    ["chirp", "hsv", "46.2", "0.981", "4.63"],
    ["chirp", "gray", "−3.3", "0.532", "2.34"],
  ],
));
children.push(body(
  "Phase-carrying color is close to transparent; magnitude-only is capped by how well Griffin–Lim can guess the discarded phase, which varies sharply by content — near-perfect for a pure tone sweep is not the case here because chirp's fast-changing frequency makes blind phase estimation harder, not easier, illustrating that the magnitude-only ceiling is content-dependent as well as fixed.",
));

children.push(h2("4.2", "Channel damage at native resolution (1×1)"));
children.push(body("Speech, four damage severities, one spectrogram bin per printed pixel:"));
children.push(tableCaption("Table 2. PESQ of recovered speech across simulated damage severities, 1×1 resolution."));
children.push(dataTable(
  [3400, 1400, 1400, 1600, 1400],
  ["Scheme", "clean", "light", "moderate", "harsh"],
  [
    ["hsv", "4.59", "1.17", "1.06", "1.05"],
    ["ifreq (re-anchor / 8)", "3.14", "1.27", "1.16", "1.10"],
    ["ifreq (no re-anchor)", "1.64", "1.39", "1.33", "1.17"],
    ["gray", "3.69", "3.33", "2.59", "1.62"],
  ],
));
children.push(...figure(FIG("channel_survival.png"), 460, "Figure 4. PESQ of recovered speech across four levels of simulated channel damage, 1×1 resolution. Phase-carrying schemes collapse under even light damage; magnitude-only degrades gracefully."));
children.push(body(
  "The digital ranking inverts under even the lightest simulated damage. hsv collapses immediately; the derivative encoding ifreq, despite measurably smoother hue (a custom hue-roughness metric — mean angular difference between neighboring pixels on the color wheel, weighted by brightness — drops from 0.304 to 0.172 with no re-anchoring), does not recover enough quality to matter, because the decoder must integrate the derivative back into absolute phase and small per-frame errors accumulate forward through time. gray degrades gracefully because it never depended on fine color detail to begin with.",
));

children.push(h2("4.3", "The resolution sweep: locating the crossover"));
children.push(body("Speech, fixed “moderate” damage, varying pixels spent per spectrogram bin:"));
children.push(tableCaption("Table 3. PESQ vs. pixels spent per spectrogram bin, moderate simulated damage."));
children.push(dataTable(
  [2200, 2200, 2200, 2600],
  ["Pixels per bin", "hsv PESQ", "gray PESQ", "Winner"],
  [
    ["1×1", "1.06", "2.59", "gray"],
    ["2×2", "1.73", "3.30", "gray"],
    ["4×4", "3.30", "3.53", "near tie"],
    ["8×8", "4.35", "3.66", "hsv"],
  ],
));
children.push(...figure(FIG("block_size.png"), 460, "Figure 5. PESQ against pixels spent per spectrogram bin. gray plateaus near PESQ 3.7 regardless of resolution; hsv keeps climbing and crosses it between 4×4 and 8×8."));
children.push(body(
  "gray plateaus near PESQ 3.7 regardless of resolution — its ceiling is set by blind phase reconstruction, which more pixels cannot improve. hsv has no such ceiling and keeps climbing toward the clean digital numbers of Section 4.1 as resolution increases, crossing gray's plateau between 4×4 and 8×8 pixels per bin. This is the paper's central quantitative claim: the correct encoding choice for printed audio is resolution-dependent, not universal, and the crossover point is measurable, not assumed.",
));
children.push(body(
  "The price of resolution is printed capacity. At 300 dpi on an A4 page (with the 513-bin STFT configuration used throughout): roughly four minutes of audio per page at 1×1, falling to about ten seconds at 4×4, before any error-correction overhead; 8×8 exceeds a single A4 page's height at this STFT configuration and would require either a smaller FFT window (fewer frequency bins, shorter strips) or a multi-page layout.",
));

children.push(h2("4.4", "Physical-channel localization validation"));
children.push(body(
  "We validated the fiducial-marker pipeline (Section 3.6) against a synthetically generated “bad photograph” — the clean printed-page image subjected to a perspective warp (simulating an off-axis camera angle), a 4° rotation, Gaussian blur, additive sensor noise, and JPEG compression at quality 90, composited onto a gray “desk” background — using the hsv scheme at 4×4 resolution (the crossover region identified in Section 4.3, chosen as the most informative test point):",
));
children.push(tableCaption("Table 4. Localization + decode quality on a synthetic worst-case photograph."));
children.push(dataTable(
  [4600, 2000, 2000],
  ["Condition", "PESQ", "STOI"],
  [
    ["Geometry only (rotation + skew)", "4.56", "0.9999"],
    ["Full damage (geometry + blur + noise + JPEG)", "3.01", "0.965"],
  ],
));
children.push(body(
  "The geometry-only result confirms the marker-based localization and homography correction themselves introduce negligible error — matching the clean digital baseline (Section 4.1's hsv PESQ 4.59) almost exactly, after we corrected the direct-sampling failure mode described in Section 3.6. (Before that correction, even the geometry-only, zero-photometric-damage case decoded to noise — PESQ 1.1–1.3 — which is how the failure mode was discovered.) The full-damage result, PESQ 3.01 with STOI 0.965 (indicating recovered speech remains highly intelligible despite imperfect signal quality), is broadly consistent with the simulated moderate-damage, 4×4-resolution prediction from Section 4.3 (PESQ 3.30 for hsv), which is some evidence the simulated channel of Section 3.4 is a reasonable proxy for a real one — though it is evidence from one more layer of simulation, not yet a real camera.",
));

// 5. Toward a Real Physical Trial
children.push(h1(5, "Toward a Real Physical Trial"));
children.push(body(
  "A physical print-and-recapture trial — an actual printed page, photographed with an actual camera, decoded with no synthetic shortcuts — is the logical next step and, at the time of this draft, is in progress: a test page (speech content, hsv scheme, 4×4 resolution, chosen for the same crossover-informativeness reason as Section 4.4) has been generated and handed off for printing and photographing outside the development environment. Section 4.4 establishes that the decoding pipeline this trial will use is correct on synthetic inputs closely modeling the expected real-world degradation; it does not yet establish that the real world matches that model. This paper will be updated with the physical result once available, and the result — whichever direction it points — is reportable: a physical PESQ substantially below the simulated prediction would itself be a finding about the limits of the simulated channel.",
));

// 6. Discussion
children.push(h1(6, "Discussion"));
children.push(rich([
  { text: "Why the crossover happens. ", bold: true },
  { text: "The mechanism is asymmetric. Magnitude-only encoding throws away real information (phase) and replaces it with a statistical guess (Griffin–Lim); no amount of printed resolution improves a guess that was never informed by the true phase. Phase-carrying encoding keeps real information, but that information is encoded as fine-grained color variation — adjacent time-frequency bins routinely differ by large phase jumps, producing pixel-level hue speckle (visible directly in Figure 1) — which is precisely the spatial frequency content that print and camera degradation destroys first (ink spread and chroma subsampling are both low-pass operations on exactly this scale). Spending more pixels per bin does not change what information is encoded, only how finely it must be resolved to survive — which is why it rescues the phase-carrying encoding but cannot rescue the magnitude-only one; the latter's problem was never about resolution." },
]));
children.push(rich([
  { text: "Practical implication. ", bold: true },
  { text: "A system designer choosing between these encodings should first ask what resolution budget the target medium affords, not which encoding is “more correct” in principle. Below roughly 4 pixels per bin (in our specific window/hop configuration), grayscale is the right choice, exactly as PhonoPaper and the historical printed-audio patents converged on independently. Above it, phase-carrying color is strictly better and keeps improving." },
]));
children.push(rich([
  { text: "Limitations. ", bold: true },
  { text: "All quantitative claims except the localization validation in Section 4.4 rest on the simulated channel of Section 3.4, which models known degradation mechanisms individually but has not been validated end-to-end against real print-and-camera measurements — that validation is Section 5's open item. The digital-content sweep is broad (speech, music, noise, a synthetic sweep) but the full damage-level and resolution sweeps (Sections 4.2–4.3) were run on speech only; content-type interactions with the crossover point are not yet characterized. The capacity figures (Section 4.3) assume a fixed STFT configuration (1024/256) and A4 paper; both are tunable and the true achievable capacity–robustness frontier is not fully mapped. The ifreq derivative encoding was tested as one candidate fix for hsv's fragility and found insufficient; other candidates (error-correcting redundancy in an unused alpha-equivalent channel, perceptually-weighted hue quantization) are unexplored." },
]));

// 7. Reproducibility
children.push(h1(7, "Reproducibility"));
children.push(body(
  "The complete implementation — STFT, all three encoding schemes, the Hilbert-curve layout, the channel simulator, the resolution sweep, and the ArUco localization pipeline — is implemented from scratch in Python (vsound/) with no dependency on prior sound-to-image code, plus a parallel, dependency-light TypeScript reimplementation (web/) that runs entirely client-side in a browser with no backend, letting a reader reproduce every non-physical result in this paper interactively. All figures, tables, and numbers in this draft are generated by scripts in the accompanying repository (scripts/e0_baseline.py through scripts/decode_scan.py) and are regenerable exactly.",
));

// References
children.push(new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 360, after: 160 },
  children: [new TextRun({ text: "References", font: FONT, bold: true, size: 28 })],
}));
[
  "N. Newhouse. Log complex color for visual pattern recognition of total sound. US Patent 10,341,795, 2019.",
  "A. Zolotov. PhonoPaper. 2014. https://warmplace.ru/soft/phonopaper/",
  "M. Tancik, B. Mildenhall, R. Ng. StegaStamp: Invisible Hyperlinks in Physical Photographs. CVPR, 2019.",
  "O. Bulan, G. Sharma. High Capacity Color Barcodes: Per Channel Data Encoding via Orientation Modulation in Elliptical Dot Arrays. IEEE Transactions on Image Processing, 20(5), 2011.",
  "Phase representation based on HSV color model for acoustic classification with convolutional neural networks. IEEE, 2021.",
  "Saving the Sonorine: Photovisual Audio Recovery Using Image Processing and Computer Vision Techniques. arXiv:2005.08944, 2020.",
  "Audio-to-Image Encoding for Improved Voice Characteristic Detection Using Deep Convolutional Neural Networks. arXiv:2503.05929, 2025.",
  "Single channel speech enhancement by colored spectrograms. arXiv:2310.17142, 2023.",
  "Printed audio format and photograph with encoded audio. US Patent 8,934,032.",
  "SemantiCodec: An Ultra Low Bitrate Semantic Audio Codec. arXiv:2405.00233, 2024.",
].forEach((t, i) => children.push(refItem(i + 1, t)));

children.push(new Paragraph({
  spacing: { before: 300 },
  border: { top: { style: BorderStyle.SINGLE, size: 6, space: 6, color: "999999" } },
  children: [new TextRun({
    text: "Draft status: Sections 1–4 and 6–7 are supported by completed, reproducible experiments in this repository. Section 5 (real physical trial) is in progress and not yet completed — treat every number in this draft as simulated-channel evidence unless stated otherwise. Not yet peer reviewed, not yet submitted anywhere.",
    font: FONT, size: SMALL_SIZE, italics: true, color: "555555",
  })],
}));

// ---- assemble document --------------------------------------------------

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "contrib-list",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } }],
      },
      {
        reference: "scheme-list",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.START, style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } }],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: FONT, size: BODY_SIZE } },
      heading1: { run: { font: FONT, bold: true, size: 28, color: "000000" }, paragraph: { spacing: { before: 360, after: 160 } } },
      heading2: { run: { font: FONT, bold: true, size: 26, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 } } },
    },
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // US Letter
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: "Visualize Sound — Draft", font: FONT, size: 16, color: "888888" })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "", font: FONT, size: 18 }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 }),
            ],
          })],
        }),
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, "visualize-sound-draft.docx");
  fs.writeFileSync(out, buf);
  console.log("wrote", out, buf.length, "bytes");
});
