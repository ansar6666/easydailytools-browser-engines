/**
 * PhotoCurvesEngine - Client-Side RGB Tone Curves, Monotone Cubic Spline Interpolation,
 * Live Histogram, Black/Gray/White Eyedroppers, Auto-Tone, Clipping Map & Open .CUBE 3D LUT Exporter.
 * 100% Original Math — Zero External Dependencies. Dual Browser / Node.js export.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PhotoCurvesEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHANNELS = ['rgb', 'r', 'g', 'b'];

  const PRESETS = {
    default: {
      label: 'Default (Linear)',
      rgb: [[0, 0], [255, 255]],
      r: [[0, 0], [255, 255]],
      g: [[0, 0], [255, 255]],
      b: [[0, 0], [255, 255]]
    },
    soft_s: {
      label: 'Soft S-Curve (Balanced Contrast)',
      rgb: [[0, 0], [64, 52], [192, 206], [255, 255]],
      r: [[0, 0], [255, 255]],
      g: [[0, 0], [255, 255]],
      b: [[0, 0], [255, 255]]
    },
    strong_contrast: {
      label: 'Strong Contrast Punch',
      rgb: [[0, 0], [48, 28], [128, 128], [208, 232], [255, 255]],
      r: [[0, 0], [255, 255]],
      g: [[0, 0], [255, 255]],
      b: [[0, 0], [255, 255]]
    },
    matte_film: {
      label: 'Matte / Faded Film',
      rgb: [[0, 26], [56, 52], [192, 204], [255, 240]],
      r: [[0, 0], [128, 132], [255, 255]],
      g: [[0, 0], [255, 255]],
      b: [[0, 12], [128, 124], [255, 244]]
    },
    lift_shadows: {
      label: 'Lift Dark Shadows',
      rgb: [[0, 0], [42, 68], [128, 142], [255, 255]],
      r: [[0, 0], [255, 255]],
      g: [[0, 0], [255, 255]],
      b: [[0, 0], [255, 255]]
    },
    warm_golden: {
      label: 'Warm Golden Hour',
      rgb: [[0, 0], [64, 58], [192, 204], [255, 255]],
      r: [[0, 0], [128, 144], [255, 255]],
      g: [[0, 0], [128, 131], [255, 255]],
      b: [[0, 0], [128, 110], [255, 244]]
    },
    cool_editorial: {
      label: 'Cool Editorial Tone',
      rgb: [[0, 8], [64, 56], [196, 208], [255, 255]],
      r: [[0, 0], [128, 118], [255, 248]],
      g: [[0, 0], [128, 127], [255, 255]],
      b: [[0, 10], [128, 142], [255, 255]]
    },
    high_key: {
      label: 'High-Key Bright Portrait',
      rgb: [[0, 10], [85, 114], [175, 204], [255, 255]],
      r: [[0, 0], [255, 255]],
      g: [[0, 0], [255, 255]],
      b: [[0, 0], [255, 255]]
    }
  };

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
    return /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(String(fileName || '').trim());
  }

  function computeTargetDimensions(srcW, srcH, maxEdge, maxPixels) {
    const w = Math.max(1, Math.round(Number(srcW) || 1));
    const h = Math.max(1, Math.round(Number(srcH) || 1));
    const edgeLimit = Number(maxEdge) > 0 ? Number(maxEdge) : 3200;
    const pixelLimit = Number(maxPixels) > 0 ? Number(maxPixels) : 3600000;
    let scale = 1;
    const maxDim = Math.max(w, h);
    if (maxDim > edgeLimit) scale = Math.min(scale, edgeLimit / maxDim);
    if (w * h > pixelLimit) scale = Math.min(scale, Math.sqrt(pixelLimit / (w * h)));
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
      scaled: scale < 1
    };
  }

  /**
   * Normalize, sort, and deduplicate curve control points [{x, y}] within [0..255].
   */
  function normalizePoints(points) {
    const raw = Array.isArray(points) ? points : [[0, 0], [255, 255]];
    const mapped = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      const x = Array.isArray(p) ? Number(p[0]) : Number(p && p.x);
      const y = Array.isArray(p) ? Number(p[1]) : Number(p && p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      mapped.push({ x: Math.round(clamp(x, 0, 255)), y: Math.round(clamp(y, 0, 255)) });
    }
    if (mapped.length < 2) {
      return [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    }
    mapped.sort((a, b) => a.x - b.x);
    const dedup = [mapped[0]];
    for (let i = 1; i < mapped.length; i++) {
      if (mapped[i].x === dedup[dedup.length - 1].x) {
        dedup[dedup.length - 1] = mapped[i];
      } else {
        dedup.push(mapped[i]);
      }
    }
    if (dedup.length < 2) {
      return [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    }
    return dedup;
  }

  /**
   * Build a smooth 256-entry Uint8Array lookup table using Monotone Cubic Hermite Spline
   * (Fritsch-Carlson method) so tone curves never ring or overshoot unpredictably.
   */
  function buildSplineLut(points) {
    const pts = normalizePoints(points);
    const n = pts.length;
    const lut = new Uint8Array(256);

    if (n === 2) {
      const p0 = pts[0], p1 = pts[1];
      const dx = p1.x - p0.x;
      for (let x = 0; x < 256; x++) {
        if (x <= p0.x) lut[x] = p0.y;
        else if (x >= p1.x) lut[x] = p1.y;
        else lut[x] = Math.round(clamp(p0.y + ((x - p0.x) / dx) * (p1.y - p0.y), 0, 255));
      }
      return lut;
    }

    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const dxs = new Array(n - 1);
    const dys = new Array(n - 1);
    const ms = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      dxs[i] = xs[i + 1] - xs[i];
      dys[i] = ys[i + 1] - ys[i];
      ms[i] = dxs[i] !== 0 ? dys[i] / dxs[i] : 0;
    }

    const tangents = new Array(n);
    tangents[0] = ms[0];
    tangents[n - 1] = ms[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (ms[i - 1] * ms[i] <= 0) {
        tangents[i] = 0;
      } else {
        const common = dxs[i - 1] + dxs[i];
        tangents[i] = (3 * common) / ((common + dxs[i]) / ms[i - 1] + (common + dxs[i - 1]) / ms[i]);
      }
    }

    // Clamp tangent magnitudes to guarantee monotonicity
    for (let i = 0; i < n - 1; i++) {
      if (ms[i] === 0) {
        tangents[i] = 0;
        tangents[i + 1] = 0;
      } else {
        const a = tangents[i] / ms[i];
        const b = tangents[i + 1] / ms[i];
        const sq = a * a + b * b;
        if (sq > 9) {
          const tau = 3 / Math.sqrt(sq);
          tangents[i] = tau * a * ms[i];
          tangents[i + 1] = tau * b * ms[i];
        }
      }
    }

    let seg = 0;
    for (let x = 0; x < 256; x++) {
      if (x <= xs[0]) {
        lut[x] = ys[0];
        continue;
      }
      if (x >= xs[n - 1]) {
        lut[x] = ys[n - 1];
        continue;
      }
      while (seg < n - 2 && x > xs[seg + 1]) seg++;
      const h = dxs[seg];
      const t = (x - xs[seg]) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const y = h00 * ys[seg] + h10 * h * tangents[seg] + h01 * ys[seg + 1] + h11 * h * tangents[seg + 1];
      lut[x] = Math.round(clamp(y, 0, 255));
    }
    return lut;
  }

  /**
   * Smooth a freehand pencil 256-entry LUT gently (moving box average preserving endpoints).
   */
  function smoothLut(lut, passes) {
    const rounds = clamp(Number(passes) || 2, 1, 8);
    let cur = new Uint8Array(lut);
    for (let p = 0; p < rounds; p++) {
      const next = new Uint8Array(256);
      next[0] = cur[0];
      next[255] = cur[255];
      for (let i = 1; i < 255; i++) {
        const lo = Math.max(0, i - 3);
        const hi = Math.min(255, i + 3);
        let sum = 0;
        for (let k = lo; k <= hi; k++) sum += cur[k];
        next[i] = Math.round(sum / (hi - lo + 1));
      }
      cur = next;
    }
    return cur;
  }

  /**
   * Compose master RGB LUT + individual R/G/B LUTs into final 3-channel lookup tables.
   */
  function composeChannelLuts(curveState) {
    const getLut = ch => {
      const chObj = curveState && curveState[ch];
      if (!chObj) return buildSplineLut([[0, 0], [255, 255]]);
      if (chObj.mode === 'pencil' && chObj.pencilLut && chObj.pencilLut.length === 256) {
        return chObj.pencilLut;
      }
      return buildSplineLut(chObj.points || [[0, 0], [255, 255]]);
    };
    const master = getLut('rgb');
    const rSingle = getLut('r');
    const gSingle = getLut('g');
    const bSingle = getLut('b');

    const rFinal = new Uint8Array(256);
    const gFinal = new Uint8Array(256);
    const bFinal = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      rFinal[i] = rSingle[master[i]];
      gFinal[i] = gSingle[master[i]];
      bFinal[i] = bSingle[master[i]];
    }
    return { master, rSingle, gSingle, bSingle, rFinal, gFinal, bFinal };
  }

  /**
   * Apply composed RGB lookup tables directly onto RGBA pixel array (fast 60fps in-place or copy).
   * Optionally renders highlight/shadow clipping warning colors when showClipping === true.
   */
  function applyCurvesToRgba(srcRgba, dstRgba, luts, options) {
    const opts = options || {};
    const rLut = luts.rFinal;
    const gLut = luts.gFinal;
    const bLut = luts.bFinal;
    const showClip = !!opts.showClipping;
    const len = srcRgba.length;
    let clippedHighlights = 0;
    let clippedShadows = 0;

    for (let i = 0; i < len; i += 4) {
      const r = rLut[srcRgba[i]];
      const g = gLut[srcRgba[i + 1]];
      const b = bLut[srcRgba[i + 2]];

      if (showClip) {
        const hiClip = (r === 255 && g === 255 && b === 255);
        const loClip = (r === 0 && g === 0 && b === 0);
        if (hiClip) {
          dstRgba[i] = 255; dstRgba[i + 1] = 45; dstRgba[i + 2] = 45; // Vivid red highlight warning
          clippedHighlights++;
        } else if (loClip) {
          dstRgba[i] = 0; dstRgba[i + 1] = 160; dstRgba[i + 2] = 255; // Vivid cyan shadow warning
          clippedShadows++;
        } else {
          // Dim non-clipped pixels slightly so clipping mask pops immediately
          dstRgba[i] = r >> 1;
          dstRgba[i + 1] = g >> 1;
          dstRgba[i + 2] = b >> 1;
        }
      } else {
        dstRgba[i] = r;
        dstRgba[i + 1] = g;
        dstRgba[i + 2] = b;
      }
      dstRgba[i + 3] = srcRgba[i + 3];
    }

    const totalPx = Math.max(1, len / 4);
    return {
      clippedHighlightPct: Number(((clippedHighlights / totalPx) * 100).toFixed(2)),
      clippedShadowPct: Number(((clippedShadows / totalPx) * 100).toFixed(2))
    };
  }

  /**
   * Compute 256-bin R, G, B, and Rec.709 Luminance histograms from RGBA array.
   */
  function computeHistogram(rgba, stridePx) {
    const r = new Uint32Array(256);
    const g = new Uint32Array(256);
    const b = new Uint32Array(256);
    const luma = new Uint32Array(256);
    const step = Math.max(1, Number(stridePx) || 1) * 4;
    let samples = 0;

    for (let i = 0; i < rgba.length; i += step) {
      if (rgba[i + 3] === 0) continue;
      const rv = rgba[i], gv = rgba[i + 1], bv = rgba[i + 2];
      const lv = Math.min(255, Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv));
      r[rv]++; g[gv]++; b[bv]++; luma[lv]++;
      samples++;
    }
    return { r, g, b, luma, samples };
  }

  /**
   * Compute Auto-Tone / Auto-Contrast black & white clip endpoints per channel (0.5% default percentile).
   */
  function computeAutoCurvePoints(rgba, clipPercent) {
    const hist = computeHistogram(rgba, 2);
    const pct = clamp(Number(clipPercent) || 0.5, 0.05, 5) / 100;
    const total = Math.max(1, hist.samples);
    const cut = total * pct;

    function findRange(bins) {
      let acc = 0, lo = 0;
      for (let i = 0; i < 256; i++) {
        acc += bins[i];
        if (acc >= cut) { lo = i; break; }
      }
      acc = 0;
      let hi = 255;
      for (let i = 255; i >= 0; i--) {
        acc += bins[i];
        if (acc >= cut) { hi = i; break; }
      }
      if (hi - lo < 16) return [{ x: 0, y: 0 }, { x: 255, y: 255 }];
      return [{ x: lo, y: 0 }, { x: hi, y: 255 }];
    }

    return {
      rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      r: findRange(hist.r),
      g: findRange(hist.g),
      b: findRange(hist.b)
    };
  }

  /**
   * Apply Black Point, Neutral Gray Point (White Balance), or White Point Eyedropper sample (r,g,b)
   * onto a curve state copy without destroying other unrelated points.
   */
  function applyEyedropperSample(curveState, kind, rVal, gVal, bVal) {
    const next = {};
    CHANNELS.forEach(ch => {
      const cur = curveState && curveState[ch] ? curveState[ch] : { mode: 'spline', points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
      next[ch] = {
        mode: 'spline',
        points: normalizePoints(cur.points).map(p => ({ x: p.x, y: p.y }))
      };
    });

    const sampled = { r: clamp(Math.round(rVal), 0, 255), g: clamp(Math.round(gVal), 0, 255), b: clamp(Math.round(bVal), 0, 255) };

    if (kind === 'black') {
      ['r', 'g', 'b'].forEach(ch => {
        const val = clamp(sampled[ch], 0, 240);
        const pts = next[ch].points.filter(p => p.x > val + 4);
        pts.unshift({ x: val, y: 0 });
        if (pts.length < 2) pts.push({ x: 255, y: 255 });
        next[ch].points = normalizePoints(pts);
      });
    } else if (kind === 'white') {
      ['r', 'g', 'b'].forEach(ch => {
        const val = clamp(sampled[ch], 15, 255);
        const pts = next[ch].points.filter(p => p.x < val - 4);
        pts.push({ x: val, y: 255 });
        if (pts.length < 2) pts.unshift({ x: 0, y: 0 });
        next[ch].points = normalizePoints(pts);
      });
    } else if (kind === 'gray') {
      // Auto White-Balance Neutralizer: anchor each channel at sampled value -> target average luminance
      const avg = clamp(Math.round((sampled.r + sampled.g + sampled.b) / 3), 16, 239);
      ['r', 'g', 'b'].forEach(ch => {
        const val = clamp(sampled[ch], 8, 247);
        const pts = next[ch].points.filter(p => Math.abs(p.x - val) > 10);
        pts.push({ x: val, y: avg });
        next[ch].points = normalizePoints(pts);
      });
    }

    return next;
  }

  /**
   * Generate an open-standard 3D LUT (.cube plain-text format) from current RGB lookup tables.
   */
  function buildCubeLutText(luts, gridSize, title) {
    const size = clamp(Math.round(Number(gridSize) || 17), 5, 33);
    const safeTitle = String(title || 'EasyDailyTools Tone Curve').replace(/["\r\n]+/g, ' ').trim();
    const lines = [
      `TITLE "${safeTitle}"`,
      `LUT_3D_SIZE ${size}`,
      'DOMAIN_MIN 0.0 0.0 0.0',
      'DOMAIN_MAX 1.0 1.0 1.0'
    ];
    for (let bi = 0; bi < size; bi++) {
      const bIn = Math.round((bi / (size - 1)) * 255);
      const bOut = (luts.bFinal[bIn] / 255).toFixed(6);
      for (let gi = 0; gi < size; gi++) {
        const gIn = Math.round((gi / (size - 1)) * 255);
        const gOut = (luts.gFinal[gIn] / 255).toFixed(6);
        for (let ri = 0; ri < size; ri++) {
          const rIn = Math.round((ri / (size - 1)) * 255);
          const rOut = (luts.rFinal[rIn] / 255).toFixed(6);
          lines.push(`${rOut} ${gOut} ${bOut}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Parse an open-standard 1D or 3D .CUBE LUT plain-text file and extract smooth R, G, B tone curves.
   * For 3D LUTs, samples the neutral tone diagonal (r == g == b) into clean editable spline points.
   */
  function parseCubeLutToCurves(cubeText) {
    const rawLines = String(cubeText || '').split(/\r?\n/);
    let title = 'Imported .CUBE LUT';
    let size1D = 0;
    let size3D = 0;
    const triplets = [];

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line || line.startsWith('#')) continue;
      if (/^TITLE\b/i.test(line)) {
        const m = line.match(/^TITLE\s+"?([^"]+)"?/i);
        if (m && m[1]) title = m[1].trim();
        continue;
      }
      if (/^LUT_1D_SIZE\b/i.test(line)) {
        size1D = parseInt(line.split(/\s+/)[1], 10) || 0;
        continue;
      }
      if (/^LUT_3D_SIZE\b/i.test(line)) {
        size3D = parseInt(line.split(/\s+/)[1], 10) || 0;
        continue;
      }
      if (/^(DOMAIN_MIN|DOMAIN_MAX|LUT_1D_INPUT_RANGE|LUT_3D_INPUT_RANGE)\b/i.test(line)) {
        continue;
      }
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const r = parseFloat(parts[0]);
        const g = parseFloat(parts[1]);
        const b = parseFloat(parts[2]);
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
          triplets.push([r, g, b]);
        }
      }
    }

    let samples = [];
    if (size3D >= 2 && triplets.length >= size3D * size3D * size3D) {
      // Sample neutral diagonal (k, k, k) across the 3D cube (red varies fastest)
      const stride = size3D * size3D + size3D + 1;
      for (let k = 0; k < size3D; k++) {
        const idx = Math.min(triplets.length - 1, k * stride);
        const x = Math.round((k / (size3D - 1)) * 255);
        const t = triplets[idx];
        samples.push({
          x,
          r: clamp(Math.round(t[0] * 255), 0, 255),
          g: clamp(Math.round(t[1] * 255), 0, 255),
          b: clamp(Math.round(t[2] * 255), 0, 255)
        });
      }
    } else if (size1D >= 2 && triplets.length >= size1D) {
      for (let k = 0; k < size1D; k++) {
        const x = Math.round((k / (size1D - 1)) * 255);
        const t = triplets[k];
        samples.push({
          x,
          r: clamp(Math.round(t[0] * 255), 0, 255),
          g: clamp(Math.round(t[1] * 255), 0, 255),
          b: clamp(Math.round(t[2] * 255), 0, 255)
        });
      }
    } else {
      throw new Error('Invalid or unsupported .CUBE file (missing LUT_3D_SIZE or LUT_1D_SIZE data).');
    }

    // Reduce to up to 9 evenly spaced editable spline points per channel (preserving endpoints)
    function pickControlPoints(key) {
      const targetCount = Math.min(9, samples.length);
      const pts = [];
      for (let i = 0; i < targetCount; i++) {
        const si = Math.round((i / (targetCount - 1)) * (samples.length - 1));
        pts.push({ x: samples[si].x, y: samples[si][key] });
      }
      return normalizePoints(pts);
    }

    return {
      title,
      kind: size3D >= 2 ? `3D (${size3D}x${size3D}x${size3D})` : `1D (${size1D})`,
      curves: {
        rgb: { mode: 'spline', points: [{ x: 0, y: 0 }, { x: 255, y: 255 }], pencilLut: null },
        r: { mode: 'spline', points: pickControlPoints('r'), pencilLut: null },
        g: { mode: 'spline', points: pickControlPoints('g'), pencilLut: null },
        b: { mode: 'spline', points: pickControlPoints('b'), pencilLut: null }
      }
    };
  }

  /**
   * Build a rich built-in Studio Landscape & Color Checker Demo Canvas so users can test
   * Tone Curves, Histograms, Eyedroppers, and Clipping Warning within 2 seconds.
   */
  function buildDemoStudioCanvas(doc) {
    const c = doc.createElement('canvas');
    c.width = 960;
    c.height = 600;
    const ctx = c.getContext('2d');

    // Slightly hazy daylight sky + sunset horizon (perfect to demonstrate S-Curve & Auto Contrast!)
    const sky = ctx.createLinearGradient(0, 0, 0, 340);
    sky.addColorStop(0, '#4f6d9a');
    sky.addColorStop(0.55, '#8fa8c8');
    sky.addColorStop(1, '#e6cbb5');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 960, 340);

    // Warm sun disc
    const sun = ctx.createRadialGradient(690, 215, 10, 690, 215, 110);
    sun.addColorStop(0, '#fff7e6');
    sun.addColorStop(0.4, 'rgba(255, 224, 178, 0.72)');
    sun.addColorStop(1, 'rgba(255, 224, 178, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(560, 90, 260, 240);

    // Distant hazy mountain range
    ctx.fillStyle = '#5f6f85';
    ctx.beginPath();
    ctx.moveTo(0, 340);
    ctx.lineTo(140, 225);
    ctx.lineTo(310, 295);
    ctx.lineTo(480, 195);
    ctx.lineTo(660, 285);
    ctx.lineTo(830, 210);
    ctx.lineTo(960, 275);
    ctx.lineTo(960, 340);
    ctx.closePath();
    ctx.fill();

    // Foreground meadow + water reflection
    const ground = ctx.createLinearGradient(0, 340, 0, 600);
    ground.addColorStop(0, '#49664c');
    ground.addColorStop(0.5, '#3b5241');
    ground.addColorStop(1, '#26342a');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 340, 960, 260);

    // Lake reflection band
    const lake = ctx.createLinearGradient(0, 350, 0, 465);
    lake.addColorStop(0, '#8ea1b5');
    lake.addColorStop(1, '#506478');
    ctx.fillStyle = lake;
    ctx.beginPath();
    ctx.ellipse(540, 415, 360, 56, 0, 0, Math.PI * 2);
    ctx.fill();

    // Photographer's Calibration Color Swatch Card (bottom-left — ideal for testing Eyedroppers!)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fillRect(36, 456, 390, 114);
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('TONE & WHITE-BALANCE TEST CARD (Click Eyedroppers Here)', 50, 478);

    const swatches = [
      { c: '#26282b', lbl: 'Shadow' },
      { c: '#868077', lbl: 'Warm Gray' },
      { c: '#dfe2e6', lbl: 'Highlight' },
      { c: '#c9524b', lbl: 'Red' },
      { c: '#4b9b68', lbl: 'Green' },
      { c: '#4476b8', lbl: 'Blue' }
    ];
    swatches.forEach((sw, i) => {
      const sx = 50 + i * 61;
      ctx.fillStyle = sw.c;
      ctx.fillRect(sx, 490, 52, 46);
      ctx.fillStyle = '#334155';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillText(sw.lbl, sx + 2, 552);
    });

    // Subtle instructions pill top-left
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(36, 28, 430, 56);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('SAMPLE STUDIO PHOTO — DRAG CURVE OR PICK A PRESET', 52, 52);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText('Try Soft S-Curve, Gray Eyedropper on Warm Gray, or Auto Tone!', 52, 72);

    return c;
  }

  return {
    CHANNELS,
    PRESETS,
    clamp,
    isHeicFile,
    isSupportedUploadFile,
    computeTargetDimensions,
    normalizePoints,
    buildSplineLut,
    smoothLut,
    composeChannelLuts,
    applyCurvesToRgba,
    computeHistogram,
    computeAutoCurvePoints,
    applyEyedropperSample,
    buildCubeLutText,
    parseCubeLutToCurves,
    buildDemoStudioCanvas
  };
}));
