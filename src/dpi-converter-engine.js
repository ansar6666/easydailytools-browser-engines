/**
 * DpiConverterEngine - Pure Client-Side Binary Image DPI Inspector,
 * Lossless JPEG (JFIF APP0 + EXIF IFD0) & PNG (pHYs CRC32) DPI Patcher,
 * and Print-Size Quality Calculator. Dual Browser / Node.js export.
 * 100% Original Math — Zero External Dependencies — Zero Trademarks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DpiConverterEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PRINT_STANDARDS = [
    { id: '2x2', label: '2×2 in (ID / Passport)', widthIn: 2, heightIn: 2 },
    { id: '4x6', label: '4×6 in (Standard Photo)', widthIn: 4, heightIn: 6 },
    { id: '5x7', label: '5×7 in (Portrait Frame)', widthIn: 5, heightIn: 7 },
    { id: '8x10', label: '8×10 in (Wall Print)', widthIn: 8, heightIn: 10 },
    { id: 'letter', label: '8.5×11 in (US Letter)', widthIn: 8.5, heightIn: 11 },
    { id: 'a4', label: 'A4 (210×297 mm)', widthIn: 8.27, heightIn: 11.69 },
    { id: '11x14', label: '11×14 in (Gallery)', widthIn: 11, heightIn: 14 },
    { id: '16x20', label: '16×20 in (Poster)', widthIn: 16, heightIn: 20 }
  ];

  // Precomputed IEEE CRC32 table for valid PNG pHYs chunks
  const CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[n] = c >>> 0;
  }

  function crc32(bytes, start, length) {
    let c = 0xffffffff;
    const end = start + length;
    for (let i = start; i < end; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function isHeicFile(fileName, mimeType) {
    const m = String(mimeType || '').toLowerCase().trim();
    if (m === 'image/heic' || m === 'image/heif' || m === 'image/heic-sequence' || m === 'image/heif-sequence') return true;
    return /\.(heic|heif)$/i.test(String(fileName || '').trim());
  }

  function isSupportedUploadFile(fileName, mimeType) {
    const m = String(mimeType || '').toLowerCase().trim();
    if (m.startsWith('image/')) return true;
    if (isHeicFile(fileName, m)) return true;
    return /\.(jpe?g|png|webp|bmp|gif|avif|heic|heif)$/i.test(String(fileName || '').trim());
  }

  function detectFormat(bytes, mimeHint) {
    if (bytes && bytes.length >= 4) {
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
      if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
      ) return 'webp';
    }
    const m = String(mimeHint || '').toLowerCase();
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpeg';
    if (m.includes('png')) return 'png';
    if (m.includes('webp')) return 'webp';
    return 'other';
  }

  function readU16(bytes, off, littleEndian) {
    if (off + 1 >= bytes.length) return 0;
    return littleEndian ? (bytes[off] | (bytes[off + 1] << 8)) : ((bytes[off] << 8) | bytes[off + 1]);
  }

  function readU32(bytes, off, littleEndian) {
    if (off + 3 >= bytes.length) return 0;
    if (littleEndian) {
      return ((bytes[off]) | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
    }
    return (((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3])) >>> 0;
  }

  function writeU16(bytes, off, val, littleEndian) {
    const v = val & 0xffff;
    if (littleEndian) {
      bytes[off] = v & 0xff;
      bytes[off + 1] = (v >>> 8) & 0xff;
    } else {
      bytes[off] = (v >>> 8) & 0xff;
      bytes[off + 1] = v & 0xff;
    }
  }

  function writeU32(bytes, off, val, littleEndian) {
    const v = val >>> 0;
    if (littleEndian) {
      bytes[off] = v & 0xff;
      bytes[off + 1] = (v >>> 8) & 0xff;
      bytes[off + 2] = (v >>> 16) & 0xff;
      bytes[off + 3] = (v >>> 24) & 0xff;
    } else {
      bytes[off] = (v >>> 24) & 0xff;
      bytes[off + 1] = (v >>> 16) & 0xff;
      bytes[off + 2] = (v >>> 8) & 0xff;
      bytes[off + 3] = v & 0xff;
    }
  }

  function readAscii(bytes, off, len) {
    let s = '';
    const end = Math.min(bytes.length, off + len);
    for (let i = off; i < end; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function parseExifDpiFromTiff(bytes, tiffStart, segEnd) {
    if (tiffStart + 8 > segEnd) return null;
    const endianTag = readAscii(bytes, tiffStart, 2);
    if (endianTag !== 'II' && endianTag !== 'MM') return null;
    const le = endianTag === 'II';
    if (readU16(bytes, tiffStart + 2, le) !== 42) return null;
    const ifd0Off = readU32(bytes, tiffStart + 4, le);
    const ifdPos = tiffStart + ifd0Off;
    if (ifdPos + 2 > segEnd) return null;
    const count = readU16(bytes, ifdPos, le);
    let xRes = null, yRes = null, unit = 2; // TIFF default unit 2 = inches

    for (let i = 0; i < count; i++) {
      const ent = ifdPos + 2 + i * 12;
      if (ent + 12 > segEnd) break;
      const tag = readU16(bytes, ent, le);
      const type = readU16(bytes, ent + 2, le);
      const valOff = readU32(bytes, ent + 8, le);

      if ((tag === 0x011a || tag === 0x011b) && type === 5) {
        const ratPos = tiffStart + valOff;
        if (ratPos + 8 <= segEnd) {
          const num = readU32(bytes, ratPos, le);
          const den = readU32(bytes, ratPos + 4, le);
          if (den > 0) {
            const val = num / den;
            if (tag === 0x011a) xRes = val;
            else yRes = val;
          }
        }
      } else if (tag === 0x0128) {
        unit = readU16(bytes, ent + 8, le);
      }
    }

    if (xRes === null && yRes === null) return null;
    const mult = unit === 3 ? 2.54 : 1; // unit 3 = pixels/cm -> inches
    const xd = xRes !== null ? Math.round(xRes * mult) : Math.round(yRes * mult);
    const yd = yRes !== null ? Math.round(yRes * mult) : xd;
    if (xd <= 0 || yd <= 0) return null;
    return { xDpi: xd, yDpi: yd, unit };
  }

  /**
   * Inspect real binary DPI headers and pixel dimensions from JPEG, PNG, or WebP bytes.
   */
  function inspectImageDpi(rawBytes, mimeHint) {
    const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes || 0);
    const format = detectFormat(bytes, mimeHint);
    const res = {
      format,
      fileSize: bytes.length,
      width: 0,
      height: 0,
      xDpi: null,
      yDpi: null,
      jfifDpi: null,
      exifDpi: null,
      physDpi: null,
      dpiSource: 'Not Embedded (Defaults to 72/96 DPI)',
      supportsLosslessPatch: format === 'jpeg' || format === 'png'
    };

    if (format === 'jpeg') {
      let pos = 2;
      while (pos + 4 <= bytes.length) {
        if (bytes[pos] !== 0xff) break;
        while (pos < bytes.length && bytes[pos] === 0xff) pos++;
        if (pos >= bytes.length) break;
        const marker = bytes[pos++];
        if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (pos + 2 > bytes.length) break;
        const segLen = readU16(bytes, pos, false);
        const segStart = pos + 2;
        const segEnd = Math.min(bytes.length, pos + segLen);

        if (marker === 0xe0 && segLen >= 16 && readAscii(bytes, segStart, 5) === 'JFIF\x00') {
          const units = bytes[segStart + 7];
          const xd = readU16(bytes, segStart + 8, false);
          const yd = readU16(bytes, segStart + 10, false);
          if (units === 1 && xd > 0 && yd > 0) {
            res.jfifDpi = { xDpi: xd, yDpi: yd };
          } else if (units === 2 && xd > 0 && yd > 0) {
            res.jfifDpi = { xDpi: Math.round(xd * 2.54), yDpi: Math.round(yd * 2.54) };
          }
        } else if (marker === 0xe1 && segLen >= 14 && readAscii(bytes, segStart, 6) === 'Exif\x00\x00') {
          const ex = parseExifDpiFromTiff(bytes, segStart + 6, segEnd);
          if (ex) res.exifDpi = ex;
        } else if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          if (segStart + 5 <= segEnd) {
            res.height = readU16(bytes, segStart + 1, false);
            res.width = readU16(bytes, segStart + 3, false);
          }
        }
        pos = segEnd;
      }

      if (res.jfifDpi && res.exifDpi) {
        res.xDpi = res.jfifDpi.xDpi;
        res.yDpi = res.jfifDpi.yDpi;
        res.dpiSource = 'JFIF APP0 + EXIF IFD0';
      } else if (res.jfifDpi) {
        res.xDpi = res.jfifDpi.xDpi;
        res.yDpi = res.jfifDpi.yDpi;
        res.dpiSource = 'JPEG JFIF APP0 Header';
      } else if (res.exifDpi) {
        res.xDpi = res.exifDpi.xDpi;
        res.yDpi = res.exifDpi.yDpi;
        res.dpiSource = 'JPEG EXIF TIFF Header';
      }
    } else if (format === 'png') {
      let pos = 8;
      while (pos + 12 <= bytes.length) {
        const len = readU32(bytes, pos, false);
        const type = readAscii(bytes, pos + 4, 4);
        const dataStart = pos + 8;
        const nextPos = dataStart + len + 4;
        if (nextPos > bytes.length) break;

        if (type === 'IHDR' && len >= 8) {
          res.width = readU32(bytes, dataStart, false);
          res.height = readU32(bytes, dataStart + 4, false);
        } else if (type === 'pHYs' && len === 9) {
          const ppuX = readU32(bytes, dataStart, false);
          const ppuY = readU32(bytes, dataStart + 4, false);
          const unit = bytes[dataStart + 8];
          if (unit === 1 && ppuX > 0 && ppuY > 0) {
            res.physDpi = {
              xDpi: Math.round(ppuX * 0.0254),
              yDpi: Math.round(ppuY * 0.0254)
            };
            res.xDpi = res.physDpi.xDpi;
            res.yDpi = res.physDpi.yDpi;
            res.dpiSource = 'PNG pHYs Chunk (Meter Density)';
          }
        } else if (type === 'IEND') {
          break;
        }
        pos = nextPos;
      }
    }

    return res;
  }

  /**
   * TRUE Lossless Binary JPEG DPI Patcher (0% pixel re-encoding).
   * Patches existing JFIF APP0 (or injects clean APP0 right after SOI) AND patches EXIF IFD0 XResolution/YResolution if present.
   */
  function patchJpegDpiLossless(rawBytes, targetDpi) {
    const src = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    if (src.length < 4 || src[0] !== 0xff || src[1] !== 0xd8) {
      throw new Error('Invalid JPEG file signature.');
    }
    const dpi = clamp(Math.round(Number(targetDpi) || 300), 1, 2400);
    const out = new Uint8Array(src);
    let patchedJfif = false;

    let pos = 2;
    while (pos + 4 <= out.length) {
      if (out[pos] !== 0xff) break;
      while (pos < out.length && out[pos] === 0xff) pos++;
      if (pos >= out.length) break;
      const marker = out[pos++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (pos + 2 > out.length) break;
      const segLen = readU16(out, pos, false);
      const segStart = pos + 2;
      const segEnd = Math.min(out.length, pos + segLen);

      if (marker === 0xe0 && segLen >= 16 && readAscii(out, segStart, 5) === 'JFIF\x00') {
        out[segStart + 7] = 1; // 1 = dots per inch
        writeU16(out, segStart + 8, dpi, false);
        writeU16(out, segStart + 10, dpi, false);
        patchedJfif = true;
      } else if (marker === 0xe1 && segLen >= 14 && readAscii(out, segStart, 6) === 'Exif\x00\x00') {
        // Patch EXIF TIFF IFD0 XResolution, YResolution & ResolutionUnit in-place if present
        const tiffStart = segStart + 6;
        const endianTag = readAscii(out, tiffStart, 2);
        if (endianTag === 'II' || endianTag === 'MM') {
          const le = endianTag === 'II';
          if (readU16(out, tiffStart + 2, le) === 42) {
            const ifd0Off = readU32(out, tiffStart + 4, le);
            const ifdPos = tiffStart + ifd0Off;
            if (ifdPos + 2 <= segEnd) {
              const count = readU16(out, ifdPos, le);
              for (let i = 0; i < count; i++) {
                const ent = ifdPos + 2 + i * 12;
                if (ent + 12 > segEnd) break;
                const tag = readU16(out, ent, le);
                const type = readU16(out, ent + 2, le);
                const valOff = readU32(out, ent + 8, le);
                if ((tag === 0x011a || tag === 0x011b) && type === 5) {
                  const ratPos = tiffStart + valOff;
                  if (ratPos + 8 <= segEnd) {
                    writeU32(out, ratPos, dpi, le);
                    writeU32(out, ratPos + 4, 1, le);
                  }
                } else if (tag === 0x0128 && type === 3) {
                  writeU16(out, ent + 8, 2, le); // 2 = inches
                }
              }
            }
          }
        }
      }
      pos = segEnd;
    }

    if (patchedJfif) return out;

    // Inject standard 18-byte JFIF APP0 segment right after FF D8
    const app0 = new Uint8Array([
      0xff, 0xe0, 0x00, 0x10,
      0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
      0x01, 0x01,                   // version 1.01
      0x01,                         // units = dots per inch
      (dpi >>> 8) & 0xff, dpi & 0xff,
      (dpi >>> 8) & 0xff, dpi & 0xff,
      0x00, 0x00                    // no thumbnail
    ]);
    const merged = new Uint8Array(out.length + app0.length);
    merged[0] = 0xff;
    merged[1] = 0xd8;
    merged.set(app0, 2);
    merged.set(out.subarray(2), 2 + app0.length);
    return merged;
  }

  /**
   * Build a valid 21-byte PNG pHYs chunk with exact IEEE CRC32 for target DPI.
   */
  function buildPngPhysChunk(targetDpi) {
    const dpi = clamp(Math.round(Number(targetDpi) || 300), 1, 2400);
    const ppm = Math.round(dpi / 0.0254); // pixels per meter (300 DPI => 11811)
    const chunk = new Uint8Array(21);
    writeU32(chunk, 0, 9, false); // chunk data length = 9
    chunk[4] = 0x70; // 'p'
    chunk[5] = 0x48; // 'H'
    chunk[6] = 0x59; // 'Y'
    chunk[7] = 0x73; // 's'
    writeU32(chunk, 8, ppm, false);
    writeU32(chunk, 12, ppm, false);
    chunk[16] = 1; // unit = meter
    const checksum = crc32(chunk, 4, 13);
    writeU32(chunk, 17, checksum, false);
    return chunk;
  }

  /**
   * TRUE Lossless Binary PNG DPI Patcher (0% pixel re-encoding).
   * Replaces existing pHYs chunk or inserts new pHYs chunk right after IHDR.
   */
  function patchPngDpiLossless(rawBytes, targetDpi) {
    const src = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    if (src.length < 33 || src[0] !== 0x89 || src[1] !== 0x50 || src[2] !== 0x4e || src[3] !== 0x47) {
      throw new Error('Invalid PNG file signature.');
    }
    const physChunk = buildPngPhysChunk(targetDpi);
    const parts = [src.subarray(0, 8)];
    let inserted = false;
    let pos = 8;

    while (pos + 12 <= src.length) {
      const len = readU32(src, pos, false);
      const type = readAscii(src, pos + 4, 4);
      const totalChunkLen = 12 + len;
      if (pos + totalChunkLen > src.length) {
        parts.push(src.subarray(pos));
        break;
      }

      if (type === 'pHYs') {
        if (!inserted) {
          parts.push(physChunk);
          inserted = true;
        }
      } else {
        parts.push(src.subarray(pos, pos + totalChunkLen));
        if (type === 'IHDR' && !inserted) {
          // Defer check: keep scanning? Inserting right after IHDR is PNG spec valid; skip any duplicate pHYs later
          parts.push(physChunk);
          inserted = true;
        }
      }
      pos += totalChunkLen;
      if (type === 'IEND') break;
    }

    const totalLen = parts.reduce((acc, a) => acc + a.length, 0);
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], offset);
      offset += parts[i].length;
    }
    return out;
  }

  /**
   * Unified lossless DPI patcher for JPEG and PNG.
   */
  function patchImageDpiLossless(rawBytes, targetDpi, mimeHint) {
    const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    const fmt = detectFormat(bytes, mimeHint);
    if (fmt === 'jpeg') return { format: 'jpeg', mime: 'image/jpeg', bytes: patchJpegDpiLossless(bytes, targetDpi) };
    if (fmt === 'png') return { format: 'png', mime: 'image/png', bytes: patchPngDpiLossless(bytes, targetDpi) };
    throw new Error('Lossless header patching is supported for JPEG and PNG files. Use Print Resample mode to export WebP/HEIC at 300 DPI.');
  }

  /**
   * Calculate exact print dimensions (in inches & cm) at any DPI + quality scores across standard print sizes.
   */
  function computePrintReadiness(widthPx, heightPx, targetDpi) {
    const w = Math.max(1, Math.round(Number(widthPx) || 1));
    const h = Math.max(1, Math.round(Number(heightPx) || 1));
    const dpi = clamp(Math.round(Number(targetDpi) || 300), 1, 2400);

    const widthIn = Number((w / dpi).toFixed(2));
    const heightIn = Number((h / dpi).toFixed(2));
    const widthCm = Number((widthIn * 2.54).toFixed(2));
    const heightCm = Number((heightIn * 2.54).toFixed(2));

    const longPx = Math.max(w, h);
    const shortPx = Math.min(w, h);

    const matrix = PRINT_STANDARDS.map(std => {
      const stdLong = Math.max(std.widthIn, std.heightIn);
      const stdShort = Math.min(std.widthIn, std.heightIn);
      const effDpi = Math.round(Math.min(longPx / stdLong, shortPx / stdShort));
      let rating = 'poor';
      let label = 'Too Low';
      if (effDpi >= 250) { rating = 'excellent'; label = 'Print Ready'; }
      else if (effDpi >= 150) { rating = 'good'; label = 'Acceptable'; }
      return {
        id: std.id,
        name: std.label,
        effectiveDpi: effDpi,
        rating,
        statusLabel: label
      };
    });

    return { widthIn, heightIn, widthCm, heightCm, targetDpi: dpi, matrix };
  }

  /**
   * Compute safe target pixel dimensions for Resample-to-Print-Size mode (capped to protect browser RAM).
   */
  function computeResamplePixels(widthVal, heightVal, unit, targetDpi, maxEdge) {
    const dpi = clamp(Math.round(Number(targetDpi) || 300), 1, 2400);
    const limit = Number(maxEdge) > 0 ? Number(maxEdge) : 8000;
    let wIn = Number(widthVal) || 4;
    let hIn = Number(heightVal) || 6;
    if (unit === 'cm') {
      wIn = wIn / 2.54;
      hIn = hIn / 2.54;
    } else if (unit === 'mm') {
      wIn = wIn / 25.4;
      hIn = hIn / 25.4;
    }
    let pxW = Math.max(16, Math.round(wIn * dpi));
    let pxH = Math.max(16, Math.round(hIn * dpi));
    const maxDim = Math.max(pxW, pxH);
    let capped = false;
    if (maxDim > limit) {
      const sc = limit / maxDim;
      pxW = Math.max(16, Math.round(pxW * sc));
      pxH = Math.max(16, Math.round(pxH * sc));
      capped = true;
    }
    return { width: pxW, height: pxH, capped };
  }

  /**
   * Build a crisp built-in 1800x1200 (6x4 in @ 300 DPI) Sample Print Poster Canvas,
   * then intentionally tag it at 72 DPI so users can test 72 DPI -> 300 DPI conversion in 1 click!
   */
  function buildDemoPrintCanvas(doc) {
    const c = doc.createElement('canvas');
    c.width = 1800;
    c.height = 1200;
    const ctx = c.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, 1800, 1200);
    bg.addColorStop(0, '#0f172a');
    bg.addColorStop(0.55, '#134e4a');
    bg.addColorStop(1, '#0f766e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1800, 1200);

    // Subtle print crop marks
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 4;
    const m = 64;
    ctx.strokeRect(m, m, 1800 - m * 2, 1200 - m * 2);

    ctx.fillStyle = '#ccfbf1';
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.fillText('PRINT STUDIO TEST PHOTO — 1800 × 1200 PIXELS', 120, 180);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 92px system-ui, sans-serif';
    ctx.fillText('CURRENT TAG: 72 DPI', 120, 340);

    ctx.fillStyle = '#99f6e4';
    ctx.font = '600 44px system-ui, sans-serif';
    ctx.fillText('Exact 6 × 4 Inch Print Size at 300 DPI (Zero Pixel Loss)', 120, 430);

    // Crisp calibration bars & typography test
    const colors = ['#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6'];
    colors.forEach((col, idx) => {
      ctx.fillStyle = col;
      ctx.fillRect(120 + idx * 255, 520, 225, 220);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(120, 810, 1560, 260);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.fillText('Test Instant Lossless Binary 300 / 600 DPI Conversion:', 170, 895);
    ctx.fillStyle = '#334155';
    ctx.font = '600 34px system-ui, sans-serif';
    ctx.fillText('1. Notice Current Header = 72 DPI (JFIF APP0).', 170, 965);
    ctx.fillText('2. Click "Convert to 300 DPI & Download" → Verified 300 DPI Binary Proof!', 170, 1025);

    return c;
  }

  return {
    PRINT_STANDARDS,
    crc32,
    clamp,
    isHeicFile,
    isSupportedUploadFile,
    detectFormat,
    inspectImageDpi,
    patchJpegDpiLossless,
    patchPngDpiLossless,
    patchImageDpiLossless,
    buildPngPhysChunk,
    computePrintReadiness,
    computeResamplePixels,
    buildDemoPrintCanvas
  };
}));
