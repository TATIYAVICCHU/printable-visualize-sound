# References

Every source consulted during the research pass that shaped this project's
direction (Route A: printing sound as a phase-aware color image and measuring
what survives the print–scan channel), plus every library the code depends on.
Also listed, with the same links, in the [main README](../README.md#credits-and-sources)
and in [`visualize-sound.html`](visualize-sound.html).

## Prior art and inspiration

1. Nathaniel Newhouse, ["Log complex color for visual pattern recognition of
   total sound"](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10341795),
   US Patent 10,341,795 (2019).
   The digital prior art for phase-as-hue, amplitude-as-brightness encoding,
   and the claim of full reversibility that this project reproduces (§ Digital
   baseline) and then tests under printing (§ Phase collapses first).

2. ["Phase representation based on HSV color model for acoustic classification
   with CNNs"](https://ieeexplore.ieee.org/document/9621891/), IEEE (2021).
   Phase-to-HSV encoding used to feed classifier pipelines — adjacent
   objective (accuracy, not human viewing or print survival), same core
   mapping.

3. Alexander Zolotov, [PhonoPaper](https://warmplace.ru/soft/phonopaper/)
   (2014).
   The closest existing system to Route A: a grayscale spectrogram printed on
   paper and resynthesized live from a phone camera. No phase, no metrics, no
   publication — the primary baseline the `gray` scheme in this repo is
   measured against.

4. Matthew Tancik, Ben Mildenhall, Whitney Wang, Edgar Schmidt, Karen Aggarwal,
   Ren Ng, Jonathan T. Barron, ["StegaStamp: Invisible Hyperlinks in Physical
   Photographs"](https://arxiv.org/abs/1904.05343), CVPR (2019).
   Evidence that the print–scan channel is a serious, citable research
   problem (56-bit hyperlinks robust to real print and capture). Inspiration
   for treating channel robustness as a first-class design variable.

5. O. Bulan, G. Sharma, ["High Capacity Color Barcodes: Per Channel Data
   Encoding via Orientation Modulation in Elliptical Dot
   Arrays"](https://ieeexplore.ieee.org/document/5635329/), IEEE Transactions
   on Image Processing, Vol. 20, No. 5 (2011).
   Capacity baselines for paper as a data medium, and the source of the
   "spend more pixels per value" idea behind the block-size crossover
   experiment (E1b).

6. ["Saving the Sonorine: Photovisual Audio Recovery Using Image Processing
   and Computer Vision Techniques"](https://arxiv.org/pdf/2005.08944), arXiv
   (2020).
   Precedent that recovering audio from physical media via imaging is a
   publishable line of research.

7. ["Audio-to-Image Encoding for Improved Voice Characteristic Detection Using
   Deep Convolutional Neural Networks"](https://arxiv.org/pdf/2503.05929),
   arXiv (2025).
   Recent RGB-channel audio encoding scheme for CNN pipelines.

8. ["Single channel speech enhancement by colored
   spectrograms"](https://arxiv.org/pdf/2310.17142), arXiv (2023).
   Colored spectrograms used inside a speech enhancement pipeline.

9. ["Printed audio format and photograph with encoded
   audio"](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8934032),
   US Patent 8,934,032 (Kodak-era).
   Historical context: encoding audio bitstreams into printed photographs,
   pre-smartphone, pre-deep-learning, never entered research literature.

10. ["SemantiCodec: An Ultra Low Bitrate Semantic Audio
    Codec"](https://arxiv.org/pdf/2405.00233), arXiv (2024).
    The enabling result for the parked "Route B" comparison (neural-codec
    bits packed into a printed color barcode) — discussed in the dossier but
    not built in this codebase.

## Libraries

- [NumPy](https://numpy.org/) — array math throughout.
- [SciPy](https://scipy.org/) — Gaussian blur and zoom/resize filters used in
  the simulated print–scan channel ([`vsound/channel.py`](../vsound/channel.py)).
- [SoundFile](https://python-soundfile.readthedocs.io/) — WAV read/write.
- [Pillow](https://python-pillow.org/) — PNG encode/decode for the color
  images.
- [Matplotlib](https://matplotlib.org/) — HSV↔RGB conversion and every chart
  in this project.
- [pystoi](https://github.com/mpariente/pystoi) — STOI intelligibility
  metric.
- [PESQ](https://github.com/ludlows/PESQ) — Python binding for ITU-T P.862,
  the perceptual quality metric used throughout the results.
- macOS `say` — local text-to-speech, used only to generate the `speech.wav`
  test clip so at least one sample is realistic recorded-style audio rather
  than synthetic tones.
