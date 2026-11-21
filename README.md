# EasyDailyTools — Open-Source Client-Side Browser Utility Engines

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-brightgreen.svg)](#included-engines)
[![100% Client-Side](https://img.shields.io/badge/Privacy-100%25%20Local%20Processing-6366f1.svg)](https://easydailytools.com/)

Zero-dependency, pure JavaScript engines powering key privacy-first photo and print utilities on **[EasyDailyTools.com](https://easydailytools.com/)** — a collection of **72 free client-side browser tools** for photos, print DPI, PDFs, barcodes, audio, and international tax calculations.

Every engine in this repository runs **100% locally in browser memory or Node.js** with **zero server uploads** and **zero external dependencies**.

---

## Included Engines

| Engine | File | Live Web Tool | Capabilities |
| :--- | :--- | :--- | :--- |
| **Lossless Binary DPI Engine** | [`src/dpi-converter-engine.js`](src/dpi-converter-engine.js) | [Image DPI Converter](https://easydailytools.com/image-dpi-converter) | Inspects & patches JPEG (`JFIF APP0` + `EXIF TIFF IFD0`) and PNG (`pHYs` IEEE CRC32) DPI metadata with 0% pixel loss + Print Readiness Matrix |
| **Lossless Binary EXIF/GPS Scrubber** | [`src/exif-scrubber-engine.js`](src/exif-scrubber-engine.js) | [EXIF & GPS Metadata Remover](https://easydailytools.com/remove-exif-metadata) | Inspects & strips EXIF, GPS, XMP, IPTC, C2PA, and PNG AI-prompt chunks from JPEG, PNG, and WebP without re-encoding image pixels |
| **RGB Tone Curves & `.CUBE` LUT Engine** | [`src/photo-curves-engine.js`](src/photo-curves-engine.js) | [Online Photo Curves Editor](https://easydailytools.com/photo-curves-editor) | Monotone cubic spline RGB curves, live 256-bin histogram, Black/Gray/White eyedroppers, Auto-Tone, Clipping Map, and `.CUBE` 1D/3D LUT export/import |

---

## Quick Usage (Node.js & Browser)

All three modules ship in UMD format (`module.exports` in Node.js, `window.*` in browsers).

### 1. Lossless 300 DPI Binary Patching (`DpiConverterEngine`)
```js
const fs = require('fs');
const DpiEngine = require('./src/dpi-converter-engine.js');

const inputBytes = new Uint8Array(fs.readFileSync('photo.jpg'));
const before = DpiEngine.inspectImageDpi(inputBytes);
console.log('Before:', before.xDpi, 'x', before.yDpi, 'DPI');

const patched = DpiEngine.patchImageDpiLossless(inputBytes, 300);
fs.writeFileSync('photo-300dpi.jpg', Buffer.from(patched.bytes));

const after = DpiEngine.inspectImageDpi(patched.bytes);
console.log('After:', after.xDpi, 'x', after.yDpi, 'DPI');
```

### 2. Lossless Binary Metadata Scrubbing (`ExifScrubberEngine`)
```js
const fs = require('fs');
const ExifEngine = require('./src/exif-scrubber-engine.js');

const bytes = new Uint8Array(fs.readFileSync('camera-photo.jpg'));
const report = ExifEngine.inspectMetadata(bytes);
console.log('Has GPS:', report.hasGps, '| Found tags:', report.findings.length);

const clean = ExifEngine.stripMetadataLossless(bytes, { keepColorProfile: true });
fs.writeFileSync('photo-clean.jpg', Buffer.from(clean.bytes));
```

### 3. Monotone Cubic Spline Curves & `.CUBE` 3D LUT Export (`PhotoCurvesEngine`)
```js
const CurvesEngine = require('./src/photo-curves-engine.js');

const luts = CurvesEngine.composeChannelLuts({
  rgb: [{ x: 0, y: 0 }, { x: 64, y: 52 }, { x: 192, y: 206 }, { x: 255, y: 255 }],
  r: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  g: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  b: [{ x: 0, y: 0 }, { x: 255, y: 255 }]
});

const cubeText = CurvesEngine.buildCubeLutText(luts, { title: 'Soft S-Curve', size: 17 });
console.log(cubeText.slice(0, 140));
```

---

## Run Tests Locally

```bash
npm test
```

---

## Live Client-Side Web Suite on EasyDailyTools.com

Explore all **72 free browser utilities** (zero login, zero watermarks, zero server uploads):

- **Photo & Print Tools:** [Image DPI Converter](https://easydailytools.com/image-dpi-converter) · [Photo Curves Editor](https://easydailytools.com/photo-curves-editor) · [Remove EXIF & GPS Metadata](https://easydailytools.com/remove-exif-metadata) · [Privacy Blur Tool](https://easydailytools.com/blur-image) · [Passport Photo Maker](https://easydailytools.com/passport-photo-maker)
- **PDF Tools:** [Merge PDF](https://easydailytools.com/merge-pdf) · [Compress PDF to 500KB](https://easydailytools.com/compress-pdf-to-500kb) · [JPG to PDF](https://easydailytools.com/jpg-to-pdf) · [PDF to JPG](https://easydailytools.com/pdf-to-jpg)
- **Everyday & Finance Utilities:** [Barcode Generator](https://easydailytools.com/barcode-generator) · [UK Tax Calculator](https://easydailytools.com/uk-tax-calculator) · [Australia Tax Calculator](https://easydailytools.com/australia-tax-calculator) · [Canada Tax Calculator](https://easydailytools.com/canada-tax-calculator) · [Online Mic Test](https://easydailytools.com/mic-test)

---

## Embed Any Free Tool on Your Website / Blog

Several EasyDailyTools utilities support clean `?embed=1` iframe embedding out of the box:

```html
<iframe
  src="https://easydailytools.com/image-dpi-converter?embed=1"
  width="100%"
  height="760"
  style="border:1px solid #e2e8f0;border-radius:12px;"
  loading="lazy"
  title="Free Image DPI Converter by EasyDailyTools"
></iframe>
```

Embeddable tools include: `/image-dpi-converter`, `/photo-curves-editor`, `/remove-exif-metadata`, `/barcode-generator`, `/uk-tax-calculator`, `/australia-tax-calculator`, `/canada-tax-calculator`, and `/crocs-shoe-size-converter`.

---

## License

MIT License — see [`LICENSE`](LICENSE). Built & maintained by **[EasyDailyTools](https://easydailytools.com/)**.
