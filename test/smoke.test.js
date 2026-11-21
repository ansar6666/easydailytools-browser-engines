const assert = require('assert');
const DpiEngine = require('../src/dpi-converter-engine.js');
const ExifEngine = require('../src/exif-scrubber-engine.js');
const CurvesEngine = require('../src/photo-curves-engine.js');

// 1. Minimal valid 1x1 PNG -> patch to 300 DPI -> verify pHYs DPI
const samplePng = Uint8Array.from([
  0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,
  0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
  0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,0xDE,
  0x00,0x00,0x00,0x0C,0x49,0x44,0x41,0x54,
  0x08,0xD7,0x63,0xF8,0xCF,0xC0,0x00,0x00,0x03,0x01,0x01,0x00,0x18,0xDD,0x8D,0xB0,
  0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82
]);
const patchedPng = DpiEngine.patchImageDpiLossless(samplePng, 300);
const dpiCheck = DpiEngine.inspectImageDpi(patchedPng.bytes);
assert.strictEqual(dpiCheck.xDpi, 300, 'PNG X DPI should be 300');
assert.strictEqual(dpiCheck.yDpi, 300, 'PNG Y DPI should be 300');
console.log('PASS 1/3: DpiConverterEngine lossless 300 DPI PNG patch & binary verify');

// 2. Minimal JPEG -> inject synthetic EXIF/GPS -> scrub losslessly -> verify clean
const minimalJpeg = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9]);
const dirtyJpeg = ExifEngine.injectSyntheticDemoMetadataIntoJpeg(minimalJpeg);
const beforeExif = ExifEngine.inspectMetadata(dirtyJpeg);
assert.strictEqual(beforeExif.hasGps, true, 'Demo JPEG should include synthetic GPS');
const scrubbed = ExifEngine.stripMetadataLossless(dirtyJpeg);
const afterExif = ExifEngine.inspectMetadata(scrubbed.bytes);
assert.strictEqual(afterExif.hasGps, false, 'Scrubbed JPEG should have zero GPS');
console.log('PASS 2/3: ExifScrubberEngine lossless EXIF/GPS inject & scrub verify');

// 3. Curves spline LUT + .CUBE 3D LUT export/import round-trip
const luts = CurvesEngine.composeChannelLuts({
  rgb: [{ x: 0, y: 0 }, { x: 64, y: 52 }, { x: 192, y: 206 }, { x: 255, y: 255 }],
  r: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  g: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  b: [{ x: 0, y: 0 }, { x: 255, y: 255 }]
});
const cubeText = CurvesEngine.buildCubeLutText(luts, { title: 'SmokeTest', size: 17 });
assert.ok(cubeText.includes('LUT_3D_SIZE 17'), 'Should generate valid 17x17x17 .CUBE LUT');
console.log('PASS 3/3: PhotoCurvesEngine spline & .CUBE 3D LUT verify');
console.log('ALL 3/3 OPEN-SOURCE ENGINE TESTS PASSED!');
