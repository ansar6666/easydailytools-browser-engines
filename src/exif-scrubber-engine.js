/**
 * ExifScrubberEngine - Zero-Upload Binary EXIF, GPS, XMP, IPTC, C2PA & PNG AI-Prompt
 * Inspector + True Lossless Binary Metadata Scrubber (JPEG, PNG, WebP) + Demo Generator.
 * Runs cleanly in both Browser (window.ExifScrubberEngine) and Node.js (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ExifScrubberEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ORIENTATION_LABELS = {
    1: '1 — Normal (Horizontal)',
    2: '2 — Flipped Horizontal',
    3: '3 — Rotated 180°',
    4: '4 — Flipped Vertical',
    5: '5 — Mirrored + 90° CCW',
    6: '6 — Rotated 90° CW (Portrait)',
    7: '7 — Mirrored + 90° CW',
    8: '8 — Rotated 90° CCW (Portrait)'
  };

  function toUint8(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return new Uint8Array(0);
  }

  function readU16(bytes, off, little) {
    if (off < 0 || off + 2 > bytes.length) return 0;
    return little
      ? (bytes[off] | (bytes[off + 1] << 8))
      : ((bytes[off] << 8) | bytes[off + 1]);
  }

  function readU32(bytes, off, little) {
    if (off < 0 || off + 4 > bytes.length) return 0;
    return little
      ? ((bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0)
      : (((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0);
  }

  function readS32(bytes, off, little) {
    return readU32(bytes, off, little) | 0;
  }

  function readFourCC(bytes, start) {
    if (start < 0 || start + 4 > bytes.length) return '';
    return String.fromCharCode(bytes[start], bytes[start + 1], bytes[start + 2], bytes[start + 3]);
  }

  function readAscii(bytes, start, len) {
    const end = Math.min(bytes.length, start + Math.max(0, len));
    let out = '';
    for (let i = start; i < end; i++) {
      const c = bytes[i];
      if (c === 0) break;
      if (c >= 32 && c <= 126) out += String.fromCharCode(c);
      else if (c === 10 || c === 13 || c === 9) out += ' ';
    }
    return out.trim();
  }

  function readUtf8Slice(bytes, start, len) {
    const slice = bytes.subarray(start, Math.min(bytes.length, start + len));
    if (typeof TextDecoder !== 'undefined') {
      try {
        return new TextDecoder('utf-8', { fatal: false }).decode(slice).replace(/\0+$/, '').trim();
      } catch (_e) {}
    }
    return readAscii(bytes, start, len);
  }

  function isHeicFile(fileName, mimeType) {
    const mime = String(mimeType || '').toLowerCase().trim();
    if (mime === 'image/heic' || mime === 'image/heif' || mime === 'image/heic-sequence' || mime === 'image/heif-sequence') {
      return true;
    }
    return /\.(heic|heif)$/i.test(String(fileName || '').trim());
  }

  function isSupportedUploadFile(fileName, mimeType) {
    const mime = String(mimeType || '').toLowerCase().trim();
    if (mime.startsWith('image/')) return true;
    if (isHeicFile(fileName, mime)) return true;
    return /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(String(fileName || '').trim());
  }

  function formatFileSize(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatGpsDms(decimal, isLat) {
    if (!Number.isFinite(decimal)) return '';
    const hemi = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
    const abs = Math.abs(decimal);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = ((minFloat - min) * 60).toFixed(2);
    return `${deg}° ${min}' ${sec}" ${hemi}`;
  }

  /**
   * Parse TIFF IFD structure (IFD0 + ExifSubIFD + GPS IFD) for both Little-Endian (II) and Big-Endian (MM).
   */
  function parseTiffBlock(bytes, tiffStart, blockEnd, report) {
    if (tiffStart + 8 > blockEnd) return;
    const isII = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
    const isMM = bytes[tiffStart] === 0x4D && bytes[tiffStart + 1] === 0x4D;
    if (!isII && !isMM) return;
    if (readU16(bytes, tiffStart + 2, isII) !== 42) return;

    const firstIfdRel = readU32(bytes, tiffStart + 4, isII);
    const ifd0 = tiffStart + firstIfdRel;
    if (ifd0 + 2 > blockEnd) return;

    let exifSubIfdOff = 0;
    let gpsIfdOff = 0;

    function readTagValue(type, count, valOff) {
      const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      const unitSize = typeSizes[type] || 1;
      const totalBytes = unitSize * count;
      const dataOff = totalBytes <= 4 ? valOff : (tiffStart + readU32(bytes, valOff, isII));
      if (dataOff < tiffStart || dataOff + totalBytes > blockEnd) return null;

      if (type === 2) {
        return readAscii(bytes, dataOff, Math.min(totalBytes, 512));
      }
      if (type === 3) {
        if (count === 1) return readU16(bytes, dataOff, isII);
        const arr = [];
        for (let i = 0; i < Math.min(count, 16); i++) arr.push(readU16(bytes, dataOff + i * 2, isII));
        return arr;
      }
      if (type === 4) {
        if (count === 1) return readU32(bytes, dataOff, isII);
        const arr = [];
        for (let i = 0; i < Math.min(count, 16); i++) arr.push(readU32(bytes, dataOff + i * 4, isII));
        return arr;
      }
      if (type === 5 || type === 10) {
        const arr = [];
        for (let i = 0; i < Math.min(count, 8); i++) {
          const num = type === 10 ? readS32(bytes, dataOff + i * 8, isII) : readU32(bytes, dataOff + i * 8, isII);
          const den = type === 10 ? readS32(bytes, dataOff + i * 8 + 4, isII) : readU32(bytes, dataOff + i * 8 + 4, isII);
          arr.push(den ? (num / den) : 0);
        }
        return count === 1 ? arr[0] : arr;
      }
      if (type === 1) {
        return count === 1 ? bytes[dataOff] : Array.from(bytes.subarray(dataOff, dataOff + Math.min(count, 16)));
      }
      return null;
    }

    function walkIfd(ifdOff, mapFn) {
      if (ifdOff < tiffStart || ifdOff + 2 > blockEnd) return;
      const numEntries = Math.min(readU16(bytes, ifdOff, isII), 128);
      for (let i = 0; i < numEntries; i++) {
        const eOff = ifdOff + 2 + i * 12;
        if (eOff + 12 > blockEnd) break;
        const tag = readU16(bytes, eOff, isII);
        const type = readU16(bytes, eOff + 2, isII);
        const count = readU32(bytes, eOff + 4, isII);
        const val = readTagValue(type, count, eOff + 8);
        mapFn(tag, val, eOff + 8);
      }
    }

    const gpsRaw = {};

    walkIfd(ifd0, (tag, val) => {
      if (tag === 0x010F && val) { report.camera.make = String(val); report.fields.push({ group: 'Camera', name: 'Camera Make', value: String(val), risk: 'medium' }); }
      else if (tag === 0x0110 && val) { report.camera.model = String(val); report.fields.push({ group: 'Camera', name: 'Camera Model', value: String(val), risk: 'medium' }); }
      else if (tag === 0x0112 && typeof val === 'number') {
        report.orientation = val;
        report.fields.push({ group: 'Image', name: 'EXIF Orientation', value: ORIENTATION_LABELS[val] || String(val), risk: 'low' });
      }
      else if (tag === 0x0131 && val) { report.camera.software = String(val); report.fields.push({ group: 'Device', name: 'Software / OS', value: String(val), risk: 'medium' }); }
      else if (tag === 0x0132 && val) { report.timestamps.modified = String(val); report.fields.push({ group: 'Timestamp', name: 'Date/Time Modified', value: String(val), risk: 'medium' }); }
      else if (tag === 0x013B && val) { report.fields.push({ group: 'Identity', name: 'Artist / Author', value: String(val), risk: 'high' }); }
      else if (tag === 0x8298 && val) { report.fields.push({ group: 'Identity', name: 'Copyright Notice', value: String(val), risk: 'low' }); }
      else if (tag === 0x8769 && typeof val === 'number') { exifSubIfdOff = tiffStart + val; }
      else if (tag === 0x8825 && typeof val === 'number') { gpsIfdOff = tiffStart + val; }
    });

    if (exifSubIfdOff) {
      walkIfd(exifSubIfdOff, (tag, val) => {
        if (tag === 0x9003 && val) { report.timestamps.original = String(val); report.fields.push({ group: 'Timestamp', name: 'Date/Time Taken (Original)', value: String(val), risk: 'medium' }); }
        else if (tag === 0x9004 && val) { report.fields.push({ group: 'Timestamp', name: 'Date/Time Digitized', value: String(val), risk: 'low' }); }
        else if (tag === 0x829A && typeof val === 'number' && val > 0) {
          const shutter = val < 1 ? `1/${Math.round(1 / val)} s` : `${val.toFixed(2)} s`;
          report.camera.exposure = shutter;
          report.fields.push({ group: 'Exposure', name: 'Shutter Speed', value: shutter, risk: 'low' });
        }
        else if (tag === 0x829D && typeof val === 'number' && val > 0) {
          const fn = `f/${val.toFixed(1)}`;
          report.camera.fNumber = fn;
          report.fields.push({ group: 'Exposure', name: 'Aperture', value: fn, risk: 'low' });
        }
        else if (tag === 0x8827 && val !== null && val !== undefined) {
          const iso = Array.isArray(val) ? val[0] : val;
          report.camera.iso = String(iso);
          report.fields.push({ group: 'Exposure', name: 'ISO Speed', value: `ISO ${iso}`, risk: 'low' });
        }
        else if (tag === 0x920A && typeof val === 'number' && val > 0) {
          const fl = `${val.toFixed(1)} mm`;
          report.camera.focalLength = fl;
          report.fields.push({ group: 'Exposure', name: 'Focal Length', value: fl, risk: 'low' });
        }
        else if (tag === 0xA431 && val) { report.fields.push({ group: 'Identity', name: 'Body Serial Number', value: String(val), risk: 'high' }); }
        else if (tag === 0xA434 && val) { report.camera.lens = String(val); report.fields.push({ group: 'Camera', name: 'Lens Model', value: String(val), risk: 'low' }); }
      });
    }

    if (gpsIfdOff) {
      report.hasGps = true;
      walkIfd(gpsIfdOff, (tag, val) => {
        if (tag === 0x0001 && val) gpsRaw.latRef = String(val).toUpperCase();
        else if (tag === 0x0002 && Array.isArray(val) && val.length >= 3) gpsRaw.lat = val;
        else if (tag === 0x0003 && val) gpsRaw.lonRef = String(val).toUpperCase();
        else if (tag === 0x0004 && Array.isArray(val) && val.length >= 3) gpsRaw.lon = val;
        else if (tag === 0x0005 && typeof val === 'number') gpsRaw.altRef = val;
        else if (tag === 0x0006 && typeof val === 'number') gpsRaw.alt = val;
        else if (tag === 0x001D && val) gpsRaw.dateStamp = String(val);
      });

      if (gpsRaw.lat && gpsRaw.lon) {
        let lat = gpsRaw.lat[0] + gpsRaw.lat[1] / 60 + gpsRaw.lat[2] / 3600;
        let lon = gpsRaw.lon[0] + gpsRaw.lon[1] / 60 + gpsRaw.lon[2] / 3600;
        if (gpsRaw.latRef === 'S') lat = -Math.abs(lat);
        if (gpsRaw.lonRef === 'W') lon = -Math.abs(lon);
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          report.gps = {
            lat: Number(lat.toFixed(6)),
            lon: Number(lon.toFixed(6)),
            latDms: formatGpsDms(lat, true),
            lonDms: formatGpsDms(lon, false),
            altitudeM: typeof gpsRaw.alt === 'number' ? Number((gpsRaw.altRef === 1 ? -gpsRaw.alt : gpsRaw.alt).toFixed(1)) : null,
            dateStamp: gpsRaw.dateStamp || null,
            osmUrl: `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`,
            googleMapsUrl: `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`
          };
          report.fields.unshift({
            group: 'GPS Location',
            name: 'Exact GPS Coordinates',
            value: `${report.gps.lat}, ${report.gps.lon} (${report.gps.latDms}, ${report.gps.lonDms})`,
            risk: 'critical'
          });
          if (report.gps.altitudeM !== null) {
            report.fields.push({ group: 'GPS Location', name: 'GPS Altitude', value: `${report.gps.altitudeM} m`, risk: 'high' });
          }
        }
      } else {
        report.fields.unshift({ group: 'GPS Location', name: 'GPS IFD Header', value: 'Present (Location container detected)', risk: 'critical' });
      }
    }
  }

  /**
   * Inspect full binary metadata across JPEG, PNG, WebP, and HEIC containers.
   */
  function inspectMetadata(input, mimeHint) {
    const bytes = toUint8(input);
    const report = {
      format: 'unknown',
      fileSizeBytes: bytes.length,
      metadataBytes: 0,
      losslessSupported: false,
      hasExif: false,
      hasGps: false,
      hasXmp: false,
      hasIptc: false,
      hasC2pa: false,
      hasAiPrompts: false,
      hasIccProfile: false,
      hasComments: false,
      orientation: 1,
      gps: null,
      camera: {},
      timestamps: {},
      detectedContainers: [],
      fields: [],
      riskLevel: 'CLEAN',
      riskLabel: 'Clean File — 0 Hidden Metadata Detected'
    };

    if (bytes.length < 12) return report;

    // 1. JPEG (FF D8)
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      report.format = 'image/jpeg';
      report.losslessSupported = true;
      let offset = 2;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xFF) break;
        while (offset < bytes.length && bytes[offset] === 0xFF) offset++;
        if (offset >= bytes.length) break;
        const marker = bytes[offset++];
        if (marker === 0xDA || marker === 0xD9) break; // SOS / EOI
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
        if (offset + 2 > bytes.length) break;
        const segLen = readU16(bytes, offset, false);
        if (segLen < 2 || offset + segLen > bytes.length) break;
        const dataStart = offset + 2;
        const dataEnd = offset + segLen;
        const totalSegSize = segLen + 2;

        if (marker === 0xE1) {
          const sig6 = readAscii(bytes, dataStart, 6);
          const sig29 = readAscii(bytes, dataStart, 29);
          if (sig6 === 'Exif') {
            report.hasExif = true;
            report.metadataBytes += totalSegSize;
            if (!report.detectedContainers.includes('EXIF (APP1)')) report.detectedContainers.push('EXIF (APP1)');
            parseTiffBlock(bytes, dataStart + 6, dataEnd, report);
          } else if (sig29.includes('http://ns.adobe.com/xap/')) {
            report.hasXmp = true;
            report.metadataBytes += totalSegSize;
            if (!report.detectedContainers.includes('XMP XML (APP1)')) report.detectedContainers.push('XMP XML (APP1)');
            const xmlPreview = readUtf8Slice(bytes, dataStart + 29, Math.min(dataEnd - (dataStart + 29), 300));
            const creatorMatch = xmlPreview.match(/CreatorTool[^>]*>([^<]+)/i) || xmlPreview.match(/xmp:CreatorTool="([^"]+)"/i);
            report.fields.push({
              group: 'XMP / Editing History',
              name: 'Adobe XMP Container',
              value: creatorMatch ? `Tool: ${creatorMatch[1]} (${formatFileSize(totalSegSize)})` : `Embedded XML block (${formatFileSize(totalSegSize)})`,
              risk: 'medium'
            });
          } else {
            report.metadataBytes += totalSegSize;
            if (!report.detectedContainers.includes('APP1 Metadata')) report.detectedContainers.push('APP1 Metadata');
          }
        } else if (marker === 0xE2) {
          const iccSig = readAscii(bytes, dataStart, 11);
          if (iccSig === 'ICC_PROFILE') {
            report.hasIccProfile = true;
          }
        } else if (marker === 0xEB) {
          // APP11 - JUMBF / C2PA Content Credentials
          const preview = readUtf8Slice(bytes, dataStart, Math.min(dataEnd - dataStart, 128)).toLowerCase();
          report.hasC2pa = true;
          report.metadataBytes += totalSegSize;
          if (!report.detectedContainers.includes('C2PA / JUMBF (APP11)')) report.detectedContainers.push('C2PA / JUMBF (APP11)');
          report.fields.push({
            group: 'AI / Content Credentials',
            name: 'C2PA / JUMBF Manifest (APP11)',
            value: preview.includes('c2pa') ? `C2PA Content Credentials (${formatFileSize(totalSegSize)})` : `JUMBF Metadata Box (${formatFileSize(totalSegSize)})`,
            risk: 'high'
          });
        } else if (marker === 0xED) {
          // APP13 - Photoshop / IPTC
          report.hasIptc = true;
          report.metadataBytes += totalSegSize;
          if (!report.detectedContainers.includes('IPTC / Photoshop (APP13)')) report.detectedContainers.push('IPTC / Photoshop (APP13)');
          report.fields.push({
            group: 'IPTC / Publishing',
            name: 'Photoshop / IPTC Block (APP13)',
            value: `Embedded IPTC/IRB metadata (${formatFileSize(totalSegSize)})`,
            risk: 'medium'
          });
        } else if (marker === 0xFE) {
          report.hasComments = true;
          report.metadataBytes += totalSegSize;
          if (!report.detectedContainers.includes('JPEG Comment (COM)')) report.detectedContainers.push('JPEG Comment (COM)');
          const commentTxt = readUtf8Slice(bytes, dataStart, Math.min(dataEnd - dataStart, 180));
          report.fields.push({
            group: 'Comments',
            name: 'JPEG Text Comment',
            value: commentTxt || `${formatFileSize(totalSegSize)} hidden comment`,
            risk: 'medium'
          });
        }

        offset += segLen;
      }
    }
    // 2. PNG (89 50 4E 47 0D 0A 1A 0A)
    else if (
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
      bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A
    ) {
      report.format = 'image/png';
      report.losslessSupported = true;
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const len = readU32(bytes, offset, false);
        const type = readAscii(bytes, offset + 4, 4);
        const dataStart = offset + 8;
        const nextOff = offset + 12 + len;
        if (nextOff > bytes.length) break;
        const chunkBytes = 12 + len;

        if (type === 'eXIf') {
          report.hasExif = true;
          report.metadataBytes += chunkBytes;
          if (!report.detectedContainers.includes('PNG eXIf')) report.detectedContainers.push('PNG eXIf');
          parseTiffBlock(bytes, dataStart, dataStart + len, report);
        } else if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
          report.metadataBytes += chunkBytes;
          const kw = readAscii(bytes, dataStart, Math.min(len, 80));
          const kwLower = kw.toLowerCase();
          let valPreview = '';
          if (type === 'tEXt' && kw.length + 1 < len) {
            valPreview = readUtf8Slice(bytes, dataStart + kw.length + 1, Math.min(len - kw.length - 1, 160));
          } else if (type === 'iTXt') {
            valPreview = readUtf8Slice(bytes, dataStart, Math.min(len, 160));
          } else {
            valPreview = `Compressed text chunk (${formatFileSize(len)})`;
          }
          if (kwLower === 'parameters' || kwLower === 'prompt' || kwLower === 'workflow' || kwLower.includes('stable diffusion') || kwLower.includes('comfy')) {
            report.hasAiPrompts = true;
            if (!report.detectedContainers.includes('AI Prompt Chunk')) report.detectedContainers.push('AI Prompt Chunk');
            report.fields.push({
              group: 'AI / Content Credentials',
              name: `PNG ${type}: ${kw}`,
              value: valPreview || `AI generation prompt (${formatFileSize(len)})`,
              risk: 'high'
            });
          } else if (kwLower.includes('xmp')) {
            report.hasXmp = true;
            if (!report.detectedContainers.includes('PNG XMP')) report.detectedContainers.push('PNG XMP');
            report.fields.push({ group: 'XMP / Editing History', name: `PNG ${type}: ${kw}`, value: `${formatFileSize(chunkBytes)} XMP XML`, risk: 'medium' });
          } else {
            report.hasComments = true;
            if (!report.detectedContainers.includes(`PNG ${type}`)) report.detectedContainers.push(`PNG ${type}`);
            report.fields.push({ group: 'PNG Metadata', name: `${type}: ${kw || 'Text'}`, value: valPreview || formatFileSize(len), risk: 'medium' });
          }
        } else if (type === 'tIME') {
          report.metadataBytes += chunkBytes;
          if (!report.detectedContainers.includes('PNG tIME')) report.detectedContainers.push('PNG tIME');
          if (len >= 7) {
            const yr = readU16(bytes, dataStart, false);
            const mo = String(bytes[dataStart + 2]).padStart(2, '0');
            const dy = String(bytes[dataStart + 3]).padStart(2, '0');
            const hr = String(bytes[dataStart + 4]).padStart(2, '0');
            const mn = String(bytes[dataStart + 5]).padStart(2, '0');
            report.timestamps.modified = `${yr}-${mo}-${dy} ${hr}:${mn} UTC`;
            report.fields.push({ group: 'Timestamp', name: 'PNG Modification Time (tIME)', value: report.timestamps.modified, risk: 'medium' });
          }
        } else if (type === 'caBX') {
          report.hasC2pa = true;
          report.metadataBytes += chunkBytes;
          if (!report.detectedContainers.includes('C2PA (caBX)')) report.detectedContainers.push('C2PA (caBX)');
          report.fields.push({ group: 'AI / Content Credentials', name: 'PNG C2PA Box (caBX)', value: formatFileSize(chunkBytes), risk: 'high' });
        } else if (type === 'iCCP') {
          report.hasIccProfile = true;
        } else if (type === 'IEND') {
          break;
        }

        offset = nextOff;
      }
    }
    // 3. WebP (RIFF .... WEBP)
    else if (readFourCC(bytes, 0) === 'RIFF' && readFourCC(bytes, 8) === 'WEBP') {
      report.format = 'image/webp';
      report.losslessSupported = true;
      let offset = 12;
      while (offset + 8 <= bytes.length) {
        const fourcc = readFourCC(bytes, offset);
        const cSize = readU32(bytes, offset + 4, true);
        const padded = cSize + (cSize & 1);
        const dataStart = offset + 8;
        const nextOff = dataStart + padded;
        if (dataStart + cSize > bytes.length) break;

        if (fourcc === 'EXIF') {
          report.hasExif = true;
          report.metadataBytes += 8 + padded;
          if (!report.detectedContainers.includes('WebP EXIF')) report.detectedContainers.push('WebP EXIF');
          const tiffOff = readAscii(bytes, dataStart, 4) === 'Exif' ? dataStart + 6 : dataStart;
          parseTiffBlock(bytes, tiffOff, dataStart + cSize, report);
        } else if (fourcc === 'XMP ') {
          report.hasXmp = true;
          report.metadataBytes += 8 + padded;
          if (!report.detectedContainers.includes('WebP XMP')) report.detectedContainers.push('WebP XMP');
          report.fields.push({ group: 'XMP / Editing History', name: 'WebP XMP Chunk', value: formatFileSize(8 + padded), risk: 'medium' });
        } else if (fourcc === 'ICCP') {
          report.hasIccProfile = true;
        }
        offset = nextOff;
      }
    }
    // 4. HEIC / HEIF (ISO BMFF ftyp)
    else if (readAscii(bytes, 4, 4) === 'ftyp') {
      const brand = readAscii(bytes, 8, 4).toLowerCase();
      if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif'].includes(brand) || isHeicFile('', mimeHint)) {
        report.format = brand === 'avif' ? 'image/avif' : 'image/heic';
        report.losslessSupported = false; // Decoded locally -> Clean JPG/PNG export
        // Fast scan for embedded Exif / XMP signatures inside ISO BMFF boxes
        const scanLimit = Math.min(bytes.length, 262144);
        const sample = readUtf8Slice(bytes, 0, scanLimit);
        if (sample.includes('Exif')) {
          report.hasExif = true;
          report.detectedContainers.push('HEIC EXIF Box');
          report.fields.push({ group: 'Camera', name: 'HEIC Embedded EXIF', value: 'Detected inside Apple HEIF container (auto-wiped on clean export)', risk: 'high' });
        }
        if (sample.includes('http://ns.adobe.com/xap/')) {
          report.hasXmp = true;
          report.detectedContainers.push('HEIC XMP');
        }
      }
    } else if (mimeHint) {
      report.format = mimeHint;
    }

    // Compute Privacy Risk Rating
    if (report.hasGps) {
      report.riskLevel = 'CRITICAL';
      report.riskLabel = 'CRITICAL PRIVACY RISK — Exact GPS Location Exposed!';
    } else if (report.hasC2pa || report.hasAiPrompts || report.fields.some(f => f.risk === 'high')) {
      report.riskLevel = 'HIGH';
      report.riskLabel = 'HIGH PRIVACY RISK — Identity / AI / C2PA Metadata Found';
    } else if (report.hasExif || report.hasXmp || report.hasIptc || report.hasComments || report.fields.length > 0) {
      report.riskLevel = 'MEDIUM';
      report.riskLabel = 'METADATA FOUND — Camera, Timestamp, or Editing History Present';
    } else {
      report.riskLevel = 'CLEAN';
      report.riskLabel = '100% CLEAN — Zero EXIF, GPS, XMP, or AI Metadata Found';
    }

    return report;
  }

  /**
   * Surgically scrub ONLY the GPS IFD (tag 0x8825) + all GPS coordinate bytes from a TIFF EXIF block,
   * preserving Camera Make/Model, Lens, ISO, Aperture, Shutter, and Orientation intact (both II & MM).
   */
  function scrubGpsOnlyFromTiff(tiffBytes) {
    const out = tiffBytes.slice();
    if (out.length < 16) return { bytes: out, scrubbed: false };
    const isII = out[0] === 0x49 && out[1] === 0x49;
    const isMM = out[0] === 0x4D && out[1] === 0x4D;
    if (!isII && !isMM) return { bytes: out, scrubbed: false };
    if (readU16(out, 2, isII) !== 42) return { bytes: out, scrubbed: false };

    const writeU16 = (off, val) => {
      if (isII) { out[off] = val & 0xFF; out[off + 1] = (val >> 8) & 0xFF; }
      else { out[off] = (val >> 8) & 0xFF; out[off + 1] = val & 0xFF; }
    };

    const ifd0 = readU32(out, 4, isII);
    if (ifd0 + 2 > out.length) return { bytes: out, scrubbed: false };
    const count = readU16(out, ifd0, isII);
    const entriesStart = ifd0 + 2;
    const entriesEnd = entriesStart + count * 12;
    if (entriesEnd + 4 > out.length) return { bytes: out, scrubbed: false };

    let gpsIdx = -1;
    let gpsIfdOff = 0;
    for (let i = 0; i < count; i++) {
      const eOff = entriesStart + i * 12;
      if (readU16(out, eOff, isII) === 0x8825) {
        gpsIdx = i;
        gpsIfdOff = readU32(out, eOff + 8, isII);
        break;
      }
    }
    if (gpsIdx === -1) return { bytes: out, scrubbed: false };

    // 1. Zero out every GPS IFD entry & all out-of-line GPS rational/ASCII payloads
    if (gpsIfdOff > 0 && gpsIfdOff + 2 <= out.length) {
      const gCount = Math.min(readU16(out, gpsIfdOff, isII), 64);
      const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      for (let i = 0; i < gCount; i++) {
        const ge = gpsIfdOff + 2 + i * 12;
        if (ge + 12 > out.length) break;
        const gType = readU16(out, ge + 2, isII);
        const gValCount = readU32(out, ge + 4, isII);
        const totalBytes = (typeSizes[gType] || 1) * gValCount;
        if (totalBytes > 4) {
          const dOff = readU32(out, ge + 8, isII);
          if (dOff > 0 && dOff + totalBytes <= out.length) {
            out.fill(0, dOff, dOff + totalBytes);
          }
        }
      }
      const gpsBlockEnd = Math.min(out.length, gpsIfdOff + 2 + gCount * 12 + 4);
      out.fill(0, gpsIfdOff, gpsBlockEnd);
    }

    // 2. Remove tag 0x8825 cleanly from IFD0 (shift remaining entries + nextIFD pointer up by 12 bytes)
    const removeStart = entriesStart + gpsIdx * 12;
    const afterEntry = removeStart + 12;
    const tailEnd = entriesEnd + 4; // includes 4-byte nextIFD offset
    out.copyWithin(removeStart, afterEntry, tailEnd);
    out.fill(0, tailEnd - 12, tailEnd);
    writeU16(ifd0, count - 1);

    return { bytes: out, scrubbed: true };
  }

  /**
   * True Lossless Binary JPEG Metadata Stripper (0% Pixel Re-Encoding).
   * Supports selective removal (GPS-only, Full EXIF, XMP, C2PA/APP11, IPTC/COM, ICC preserve).
   */
  function stripJpegMetadataLossless(input, options) {
    const opts = Object.assign({
      stripGps: true,
      stripCameraExif: true,
      stripXmp: true,
      stripC2paAi: true,
      stripIptcCom: true,
      preserveIcc: true
    }, options || {});
    const bytes = toUint8(input);
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
      throw new Error('Not a valid JPEG file');
    }

    const keptChunks = [bytes.subarray(0, 2)]; // SOI
    let offset = 2;
    let strippedSegments = 0;
    let strippedBytes = 0;

    while (offset < bytes.length) {
      if (bytes[offset] !== 0xFF) {
        keptChunks.push(bytes.subarray(offset));
        break;
      }
      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xFF) offset++;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];

      // SOS (0xDA) -> entropy-coded compressed image data through EOI: copy verbatim untouched!
      if (marker === 0xDA) {
        keptChunks.push(bytes.subarray(markerStart));
        break;
      }
      // EOI or standalone restart markers
      if (marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
        keptChunks.push(bytes.subarray(markerStart, offset));
        if (marker === 0xD9) break;
        continue;
      }

      if (offset + 2 > bytes.length) {
        keptChunks.push(bytes.subarray(markerStart));
        break;
      }
      const segLen = readU16(bytes, offset, false);
      const segEnd = offset + segLen;
      if (segLen < 2 || segEnd > bytes.length) {
        keptChunks.push(bytes.subarray(markerStart));
        break;
      }

      const dataStart = offset + 2;
      let shouldStrip = false;
      let replacementChunk = null;

      if (marker === 0xE1) {
        const sig6 = readAscii(bytes, dataStart, 6);
        const sig29 = readAscii(bytes, dataStart, 29);
        if (sig6 === 'Exif') {
          if (opts.stripCameraExif) {
            shouldStrip = true;
          } else if (opts.stripGps) {
            // Surgical GPS-only binary scrub inside APP1 Exif while keeping Camera/Lens/ISO/Shutter!
            const tiffSlice = bytes.subarray(dataStart + 6, segEnd);
            const gpsRes = scrubGpsOnlyFromTiff(tiffSlice);
            if (gpsRes.scrubbed) {
              const segCopy = bytes.slice(markerStart, segEnd);
              segCopy.set(gpsRes.bytes, (dataStart + 6) - markerStart);
              replacementChunk = segCopy;
              strippedSegments++;
            }
          }
        } else if (sig29.includes('http://ns.adobe.com/xap/')) {
          shouldStrip = !!opts.stripXmp;
        } else {
          shouldStrip = !!opts.stripCameraExif;
        }
      } else if (marker === 0xEB) {
        shouldStrip = !!opts.stripC2paAi;
      } else if (marker === 0xED || marker === 0xFE) {
        shouldStrip = !!opts.stripIptcCom;
      } else if (marker === 0xE2) {
        const iccSig = readAscii(bytes, dataStart, 11);
        if (iccSig === 'ICC_PROFILE') {
          shouldStrip = !opts.preserveIcc;
        } else {
          shouldStrip = !!opts.stripCameraExif;
        }
      } else if (marker >= 0xE3 && marker <= 0xEF && marker !== 0xEE) {
        shouldStrip = !!opts.stripCameraExif;
      }

      if (shouldStrip) {
        strippedSegments++;
        strippedBytes += (segEnd - markerStart);
      } else if (replacementChunk) {
        keptChunks.push(replacementChunk);
      } else {
        keptChunks.push(bytes.subarray(markerStart, segEnd));
      }
      offset = segEnd;
    }

    const totalOutLen = keptChunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(totalOutLen);
    let pos = 0;
    for (let i = 0; i < keptChunks.length; i++) {
      out.set(keptChunks[i], pos);
      pos += keptChunks[i].length;
    }

    return {
      bytes: out,
      mime: 'image/jpeg',
      lossless: true,
      strippedSegments,
      strippedBytes
    };
  }

  /**
   * True Lossless Binary PNG Metadata Stripper (0% Pixel Re-Encoding) with selective chunk controls.
   */
  function stripPngMetadataLossless(input, options) {
    const opts = Object.assign({
      stripGps: true,
      stripCameraExif: true,
      stripXmp: true,
      stripC2paAi: true,
      stripIptcCom: true,
      preserveIcc: true
    }, options || {});
    const bytes = toUint8(input);
    if (
      bytes.length < 16 ||
      bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47
    ) {
      throw new Error('Not a valid PNG file');
    }

    const keptChunks = [bytes.subarray(0, 8)];
    let offset = 8;
    let strippedSegments = 0;
    let strippedBytes = 0;

    while (offset + 12 <= bytes.length) {
      const len = readU32(bytes, offset, false);
      const type = readAscii(bytes, offset + 4, 4);
      const dataStart = offset + 8;
      const nextOff = offset + 12 + len;
      if (nextOff > bytes.length) break;

      let drop = false;
      if (type === 'eXIf' || type === 'tIME') {
        drop = !!(opts.stripCameraExif || opts.stripGps);
      } else if (type === 'caBX') {
        drop = !!opts.stripC2paAi;
      } else if (type === 'iCCP') {
        drop = !opts.preserveIcc;
      } else if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
        const kw = readAscii(bytes, dataStart, Math.min(len, 80)).toLowerCase();
        if (kw === 'parameters' || kw === 'prompt' || kw === 'workflow' || kw.includes('stable diffusion') || kw.includes('comfy')) {
          drop = !!opts.stripC2paAi;
        } else if (kw.includes('xmp')) {
          drop = !!opts.stripXmp;
        } else {
          drop = !!opts.stripIptcCom;
        }
      }

      if (drop) {
        strippedSegments++;
        strippedBytes += (nextOff - offset);
      } else {
        keptChunks.push(bytes.subarray(offset, nextOff));
      }
      offset = nextOff;
      if (type === 'IEND') break;
    }

    const totalOutLen = keptChunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(totalOutLen);
    let pos = 0;
    for (let i = 0; i < keptChunks.length; i++) {
      out.set(keptChunks[i], pos);
      pos += keptChunks[i].length;
    }

    return {
      bytes: out,
      mime: 'image/png',
      lossless: true,
      strippedSegments,
      strippedBytes
    };
  }

  /**
   * True Lossless Binary WebP Metadata Stripper with selective EXIF / XMP / ICC controls.
   */
  function stripWebpMetadataLossless(input, options) {
    const opts = Object.assign({
      stripGps: true,
      stripCameraExif: true,
      stripXmp: true,
      preserveIcc: true
    }, options || {});
    const bytes = toUint8(input);
    if (bytes.length < 16 || readFourCC(bytes, 0) !== 'RIFF' || readFourCC(bytes, 8) !== 'WEBP') {
      throw new Error('Not a valid WebP file');
    }

    const dropExif = !!(opts.stripCameraExif || opts.stripGps);
    const dropXmp = !!opts.stripXmp;
    const keptChunks = [];
    let offset = 12;
    let strippedSegments = 0;
    let strippedBytes = 0;

    while (offset + 8 <= bytes.length) {
      const fourcc = readFourCC(bytes, offset);
      const cSize = readU32(bytes, offset + 4, true);
      const padded = cSize + (cSize & 1);
      const nextOff = offset + 8 + padded;
      if (offset + 8 + cSize > bytes.length) break;

      const drop = ((fourcc === 'EXIF' && dropExif) || (fourcc === 'XMP ' && dropXmp) || (!opts.preserveIcc && fourcc === 'ICCP'));
      if (drop) {
        strippedSegments++;
        strippedBytes += (nextOff - offset);
      } else {
        const chunkCopy = bytes.slice(offset, Math.min(bytes.length, nextOff));
        if (fourcc === 'VP8X' && chunkCopy.length >= 12) {
          let mask = 0;
          if (dropExif) mask |= 0x08;
          if (dropXmp) mask |= 0x04;
          if (!opts.preserveIcc) mask |= 0x20;
          chunkCopy[8] = chunkCopy[8] & (~mask & 0xFF);
        }
        keptChunks.push(chunkCopy);
      }
      offset = nextOff;
    }

    const payloadLen = keptChunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(12 + payloadLen);
    out.set(bytes.subarray(0, 12), 0);
    const riffSize = 4 + payloadLen;
    out[4] = riffSize & 0xFF;
    out[5] = (riffSize >> 8) & 0xFF;
    out[6] = (riffSize >> 16) & 0xFF;
    out[7] = (riffSize >> 24) & 0xFF;

    let pos = 12;
    for (let i = 0; i < keptChunks.length; i++) {
      out.set(keptChunks[i], pos);
      pos += keptChunks[i].length;
    }

    return {
      bytes: out,
      mime: 'image/webp',
      lossless: true,
      strippedSegments,
      strippedBytes
    };
  }

  /**
   * Unified lossless binary metadata scrubber (dispatches JPEG, PNG, or WebP).
   */
  function stripMetadataLossless(input, options) {
    const bytes = toUint8(input);
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
      return stripJpegMetadataLossless(bytes, options);
    }
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      return stripPngMetadataLossless(bytes, options);
    }
    if (bytes.length >= 12 && readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WEBP') {
      return stripWebpMetadataLossless(bytes, options);
    }
    throw new Error('Format requires Canvas clean rebuild (not direct binary JPEG/PNG/WebP)');
  }

  /**
   * Inject a real synthetic EXIF + GPS + XMP + Comment block into a clean JPEG Uint8Array
   * (used for the interactive 3-second Demo GPS Photo & unit tests!).
   */
  function injectSyntheticDemoMetadataIntoJpeg(cleanJpegBytes) {
    const base = toUint8(cleanJpegBytes);
    if (base.length < 4 || base[0] !== 0xFF || base[1] !== 0xD8) {
      throw new Error('Expected valid base JPEG bytes');
    }

    // Build Little-Endian TIFF block with IFD0 (Make, Model, Software, DateTime, ExifPtr, GpsPtr) + ExifIFD + GPS IFD
    const buf = [];
    const pushU16 = v => { buf.push(v & 0xFF, (v >> 8) & 0xFF); };
    const pushU32 = v => { buf.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); };
    const pushAscii = s => { for (let i = 0; i < s.length; i++) buf.push(s.charCodeAt(i) & 0x7F); buf.push(0); };

    // Reserve TIFF header (8 bytes)
    buf.push(0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00);

    // Helper: write an IFD with string/rational/short entries cleanly
    const makeStr = 'Apple';
    const modelStr = 'iPhone 16 Pro (Demo)';
    const swStr = 'iOS 19.1 Sample';
    const dtStr = '2026:11:20 14:15:00';
    const artistStr = 'Alex Morgan (Demo Author)';

    // Fixed offsets layout inside TIFF:
    // IFD0 at 8: 7 entries = 2 + 7*12 + 4 = 90 bytes -> ends at 98
    const ifd0Count = 7;
    const exifIfdOff = 98;
    // ExifIFD at 98: 4 entries = 2 + 4*12 + 4 = 54 bytes -> ends at 152
    const gpsIfdOff = 152;
    // GPS IFD at 152: 5 entries = 2 + 5*12 + 4 = 66 bytes -> ends at 218
    const dataPoolStart = 218;

    const dataPool = [];
    const allocAscii = str => {
      const off = dataPoolStart + dataPool.length;
      for (let i = 0; i < str.length; i++) dataPool.push(str.charCodeAt(i) & 0x7F);
      dataPool.push(0);
      return { off, count: str.length + 1 };
    };
    const allocRationals = pairs => {
      const off = dataPoolStart + dataPool.length;
      for (let i = 0; i < pairs.length; i++) {
        const [n, d] = pairs[i];
        dataPool.push(n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF);
        dataPool.push(d & 0xFF, (d >> 8) & 0xFF, (d >> 16) & 0xFF, (d >> 24) & 0xFF);
      }
      return { off, count: pairs.length };
    };

    const aMake = allocAscii(makeStr);
    const aModel = allocAscii(modelStr);
    const aSw = allocAscii(swStr);
    const aDt = allocAscii(dtStr);
    const aArtist = allocAscii(artistStr);
    const aDtOrig = allocAscii(dtStr);
    const rShutter = allocRationals([[1, 250]]);
    const rAperture = allocRationals([[18, 10]]);
    // Times Square NYC sample: 40° 45' 28.80" N, 73° 59' 7.80" W
    const rLat = allocRationals([[40, 1], [45, 1], [2880, 100]]);
    const rLon = allocRationals([[73, 1], [59, 1], [780, 100]]);
    const rAlt = allocRationals([[165, 10]]);

    const pushEntry = (tag, type, count, valOrOff) => {
      pushU16(tag); pushU16(type); pushU32(count); pushU32(valOrOff);
    };

    // Write IFD0 (7 entries)
    pushU16(ifd0Count);
    pushEntry(0x010F, 2, aMake.count, aMake.off);
    pushEntry(0x0110, 2, aModel.count, aModel.off);
    pushEntry(0x0131, 2, aSw.count, aSw.off);
    pushEntry(0x0132, 2, aDt.count, aDt.off);
    pushEntry(0x013B, 2, aArtist.count, aArtist.off);
    pushEntry(0x8769, 4, 1, exifIfdOff);
    pushEntry(0x8825, 4, 1, gpsIfdOff);
    pushU32(0);

    // Write ExifIFD (4 entries)
    pushU16(4);
    pushEntry(0x829A, 5, rShutter.count, rShutter.off);
    pushEntry(0x829D, 5, rAperture.count, rAperture.off);
    pushEntry(0x8827, 3, 1, 100); // ISO 100 inline
    pushEntry(0x9003, 2, aDtOrig.count, aDtOrig.off);
    pushU32(0);

    // Write GPS IFD (5 entries)
    pushU16(5);
    pushEntry(0x0001, 2, 2, 0x0000004E); // "N\0" inline LE
    pushEntry(0x0002, 5, rLat.count, rLat.off);
    pushEntry(0x0003, 2, 2, 0x00000057); // "W\0" inline LE
    pushEntry(0x0004, 5, rLon.count, rLon.off);
    pushEntry(0x0006, 5, rAlt.count, rAlt.off);
    pushU32(0);

    // Append data pool
    for (let i = 0; i < dataPool.length; i++) buf.push(dataPool[i]);

    // Build APP1 EXIF segment
    const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    const exifSegLen = 2 + exifHeader.length + buf.length;
    const app1Exif = new Uint8Array(2 + exifSegLen);
    app1Exif[0] = 0xFF; app1Exif[1] = 0xE1;
    app1Exif[2] = (exifSegLen >> 8) & 0xFF; app1Exif[3] = exifSegLen & 0xFF;
    app1Exif.set(exifHeader, 4);
    app1Exif.set(buf, 10);

    // Build APP1 XMP segment
    const xmpBody = 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:RDF><rdf:Description xmp:CreatorTool="Adobe Photoshop Lightroom Demo"/></rdf:RDF></x:xmpmeta>';
    const xmpBytes = new Uint8Array(xmpBody.length);
    for (let i = 0; i < xmpBody.length; i++) xmpBytes[i] = xmpBody.charCodeAt(i) & 0x7F;
    const xmpSegLen = 2 + xmpBytes.length;
    const app1Xmp = new Uint8Array(2 + xmpSegLen);
    app1Xmp[0] = 0xFF; app1Xmp[1] = 0xE1;
    app1Xmp[2] = (xmpSegLen >> 8) & 0xFF; app1Xmp[3] = xmpSegLen & 0xFF;
    app1Xmp.set(xmpBytes, 4);

    // Build COM comment segment
    const comTxt = 'Captured with Sample Demo Camera - GPS Enabled';
    const comSegLen = 2 + comTxt.length;
    const comSeg = new Uint8Array(2 + comSegLen);
    comSeg[0] = 0xFF; comSeg[1] = 0xFE;
    comSeg[2] = (comSegLen >> 8) & 0xFF; comSeg[3] = comSegLen & 0xFF;
    for (let i = 0; i < comTxt.length; i++) comSeg[4 + i] = comTxt.charCodeAt(i) & 0x7F;

    // Combine SOI + EXIF + XMP + COM + remainder of base JPEG
    const rest = base.subarray(2);
    const out = new Uint8Array(2 + app1Exif.length + app1Xmp.length + comSeg.length + rest.length);
    let p = 0;
    out[p++] = 0xFF; out[p++] = 0xD8;
    out.set(app1Exif, p); p += app1Exif.length;
    out.set(app1Xmp, p); p += app1Xmp.length;
    out.set(comSeg, p); p += comSeg.length;
    out.set(rest, p);
    return out;
  }

  return {
    ORIENTATION_LABELS,
    isHeicFile,
    isSupportedUploadFile,
    formatFileSize,
    formatGpsDms,
    inspectMetadata,
    stripJpegMetadataLossless,
    stripPngMetadataLossless,
    stripWebpMetadataLossless,
    stripMetadataLossless,
    injectSyntheticDemoMetadataIntoJpeg
  };
}));
