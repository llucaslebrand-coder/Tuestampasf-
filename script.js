/* ==========================================================
   Herramientas Tu Estampa SF — comportamiento
   JavaScript vanilla, sin dependencias obligatorias.
   (La IA de "Eliminar fondo" se descarga solo si se usa.)

   Índice
    1. Constantes y utilidades
    2. Procesamiento de imágenes
    3. Guardado local (IndexedDB)
    4. Estado de la app e historial
    5. Definición de las herramientas
    6. Editor de composiciones (Diseño, Mockup, Lienzo)
    7. Interfaz: menú, título, panel de ajustes
    8. Vista previa, zoom y comparador
    9. Carga de imágenes, descargas y envíos
   10. Mis creaciones / Mi cuenta
   11. Inicio
   ========================================================== */

(function () {
  'use strict';

  /* =========================================================
     1. CONSTANTES Y UTILIDADES
     ========================================================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const DPI = 300;
  const CM_PER_INCH = 2.54;
  const PREVIEW_MAX = 1200;              // lado máximo de la vista previa
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Límite de píxeles de un lienzo: Safari en iPhone es mucho más restrictivo
  const MAX_CANVAS_AREA = IS_IOS ? 16000000 : 100000000;
  const MAX_CANVAS_SIDE = IS_IOS ? 8000 : 30000;
  const MAX_SOURCE_AREA = IS_IOS ? 16000000 : 40000000;

  const cmToPx = (cm, dpi = DPI) => Math.round(cm / CM_PER_INCH * dpi);
  const pxToCm = (px, dpi = DPI) => px / dpi * CM_PER_INCH;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const fmtCm = (cm) => (Math.round(cm * 10) / 10).toLocaleString('es-AR') + ' cm';
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  function createCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

  function cloneCanvas(src) {
    const c = createCanvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  /** Redimensiona con buena calidad (reduce de a mitades para evitar serrucho). */
  function resizeCanvas(src, w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    let cur = src;
    while (cur.width / 2 > w && cur.height / 2 > h) {
      const half = createCanvas(cur.width / 2, cur.height / 2);
      const hc = half.getContext('2d');
      hc.imageSmoothingQuality = 'high';
      hc.drawImage(cur, 0, 0, half.width, half.height);
      cur = half;
    }
    const out = createCanvas(w, h);
    const oc = out.getContext('2d');
    oc.imageSmoothingEnabled = true;
    oc.imageSmoothingQuality = 'high';
    oc.drawImage(cur, 0, 0, w, h);
    return out;
  }

  function fitInside(src, maxSide) {
    const k = Math.min(1, maxSide / Math.max(src.width, src.height));
    return k >= 1 ? src : resizeCanvas(src, src.width * k, src.height * k);
  }

  function canvasToBlob(canvas, type = 'image/png', quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), type, quality);
    });
  }

  function blobToCanvas(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const c = createCanvas(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen no válida')); };
      img.src = url;
    });
  }

  /* --- PNG con resolución de 300 DPI (inserta el bloque pHYs) --- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function pngWithDpi(blob, dpi = DPI) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const ppm = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4);          // "pHYs"
    dv.setUint32(8, ppm);
    dv.setUint32(12, ppm);
    chunk[16] = 1;                                     // unidad: metros
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const ihdrEnd = 8 + 25;                            // firma + IHDR
    const out = new Uint8Array(buf.length + 21);
    out.set(buf.subarray(0, ihdrEnd), 0);
    out.set(chunk, ihdrEnd);
    out.set(buf.subarray(ihdrEnd), ihdrEnd + 21);
    return new Blob([out], { type: 'image/png' });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  /** Generador pseudoaleatorio con semilla (para efectos repetibles). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* =========================================================
     2. PROCESAMIENTO DE IMÁGENES
     ========================================================= */

  /** Desenfoque de caja RGBA (varias pasadas ≈ desenfoque gaussiano). */
  function boxBlurRGBA(src, w, h, r, passes = 2) {
    r = Math.round(r);
    const a = new Uint8ClampedArray(src);
    if (r < 1) return a;
    const b = new Uint8ClampedArray(src.length);
    for (let p = 0; p < passes; p++) {
      blurPass(a, b, w, h, r, 4, w * 4);       // horizontal
      blurPass(b, a, h, w, r, w * 4, 4);       // vertical (ejes intercambiados)
    }
    return a;
  }
  /* Una pasada de caja a lo largo de "len" píxeles en cada una de "lines" líneas. */
  function blurPass(src, dst, len, lines, r, step, lineStride) {
    const div = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const base = l * lineStride;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += src[base + clamp(i, 0, len - 1) * step + c];
        for (let i = 0; i < len; i++) {
          dst[base + i * step + c] = sum / div;
          sum += src[base + Math.min(len - 1, i + r + 1) * step + c] - src[base + Math.max(0, i - r) * step + c];
        }
      }
    }
  }

  /** Desenfoque de un solo canal con borde transparente (valores fuera = 0). */
  function blurChannel(src, w, h, r, passes = 2) {
    let a = Float32Array.from(src);
    let b = new Float32Array(src.length);
    const div = 2 * r + 1;
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let sum = 0;
        for (let i = 0; i <= r && i < w; i++) sum += a[row + i];
        for (let x = 0; x < w; x++) {
          b[row + x] = sum / div;
          if (x + r + 1 < w) sum += a[row + x + r + 1];
          if (x - r >= 0) sum -= a[row + x - r];
        }
      }
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let i = 0; i <= r && i < h; i++) sum += b[i * w + x];
        for (let y = 0; y < h; y++) {
          a[y * w + x] = sum / div;
          if (y + r + 1 < h) sum += b[(y + r + 1) * w + x];
          if (y - r >= 0) sum -= b[(y - r) * w + x];
        }
      }
    }
    return a;
  }

  /** Amplía en pasos de 2× con suavizado de alta calidad. */
  function upscale(src, factor) {
    let cur = src;
    let remaining = factor;
    while (remaining > 1.001) {
      const f = Math.min(2, remaining);
      const next = createCanvas(cur.width * f, cur.height * f);
      const c = next.getContext('2d');
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(cur, 0, 0, next.width, next.height);
      cur = next;
      remaining /= f;
    }
    return cur === src ? cloneCanvas(src) : cur;
  }

  /** Limpieza de ruido que respeta los bordes ("desenfoque de superficie"). */
  function surfaceBlur(data, w, h, radius, threshold) {
    const blurred = boxBlurRGBA(data, w, h, radius, 2);
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const o = data[i + c];
        const d = Math.abs(o - blurred[i + c]);
        const k = Math.max(0, 1 - d / threshold);
        data[i + c] = o + (blurred[i + c] - o) * k;
      }
    }
  }

  /** Máscara de enfoque (nitidez). */
  function unsharp(data, w, h, radius, amount, threshold = 2) {
    const blurred = boxBlurRGBA(data, w, h, radius, 2);
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = data[i + c] - blurred[i + c];
        if (Math.abs(diff) > threshold) data[i + c] = data[i + c] + diff * amount;
      }
    }
  }

  /** Mejora de imagen: ampliación + limpieza + nitidez (+ colores planos en ilustración). */
  function enhanceImage(src, s, illustration) {
    return finishImage(upscale(src, s.scale), s, illustration, s.scale / 2, 1);
  }

  /** Terminación: limpieza, colores planos y nitidez (modifica y devuelve el lienzo).
      k = escala de los radios; strength = intensidad (la IA ya entrega una imagen nítida). */
  function finishImage(out, s, illustration, k, strength) {
    if (!s.clean && !s.sharp && !(illustration && s.flat)) return out;
    const c = ctx2d(out);
    const img = c.getImageData(0, 0, out.width, out.height);
    const { data } = img;
    const w = out.width, h = out.height;
    if (s.clean > 0) {
      const thresholds = [0, 10, 18, 28, 40];
      surfaceBlur(data, w, h, Math.max(1, Math.round(s.clean * k)), thresholds[s.clean] * (strength < 1 ? 0.7 : 1));
    }
    if (illustration && s.flat > 0) {
      for (let p = 0; p < s.flat; p++) surfaceBlur(data, w, h, Math.round(2 * k) + 1, 26);
    }
    if (s.sharp > 0) {
      unsharp(data, w, h, Math.max(1, Math.round((illustration ? 1.5 : 1) * k)), s.sharp / 100 * 1.6 * strength);
    }
    c.putImageData(img, 0, 0);
    return out;
  }

  /** Rellena los píxeles transparentes con el color de sus vecinos, para que la IA
      no genere halos oscuros en los bordes (la transparencia se restituye después). */
  function hasTransparency(canvas) {
    const d = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
    return false;
  }
  function bleedColors(src) {
    const w = src.width, h = src.height;
    const out = cloneCanvas(src);
    const c = ctx2d(out);
    const img = c.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;
    const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    const a = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const al = d[p * 4 + 3] / 255;
      a[p] = al;
      for (let k = 0; k < 3; k++) ch[k][p] = d[p * 4 + k] * al;
    }
    const r = Math.max(2, Math.round(Math.max(w, h) / 120));
    const ba = blurChannel(a, w, h, r, 2);
    const bc = ch.map((x) => blurChannel(x, w, h, r, 2));
    for (let p = 0; p < n; p++) {
      if (d[p * 4 + 3] === 255) continue;
      const al = a[p];
      for (let k = 0; k < 3; k++) {
        const fill = ba[p] > 0.001 ? bc[k][p] / ba[p] : 128;
        d[p * 4 + k] = d[p * 4 + k] * al + fill * (1 - al);
      }
      d[p * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return out;
  }

  /** Aplica una máscara (canal alfa) sobre una imagen. */
  function applyMask(src, maskCanvas, s, touch) {
    const out = cloneCanvas(src);
    const m = resizeCanvas(maskCanvas, src.width, src.height);
    const mc = ctx2d(m);
    const md = mc.getImageData(0, 0, m.width, m.height);
    const alpha = new Float32Array(m.width * m.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = md.data[i * 4 + 3];
    // Retoque a mano: canal rojo = restaurar, verde = borrar
    if (touch) {
      const t = ctx2d(resizeCanvas(touch, src.width, src.height)).getImageData(0, 0, src.width, src.height).data;
      for (let i = 0; i < alpha.length; i++) {
        alpha[i] = alpha[i] * (1 - t[i * 4 + 1] / 255);
        alpha[i] = Math.max(alpha[i], t[i * 4]);
      }
    }
    let a = alpha;
    if (s.edge > 0) a = blurChannel(alpha, m.width, m.height, Math.max(1, Math.round(s.edge * src.width / 1200)), 1);
    const oc = ctx2d(out);
    const od = oc.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < a.length; i++) {
      let v = a[i];
      if (s.solid) v = v >= 128 ? 255 : 0;
      od.data[i * 4 + 3] = od.data[i * 4 + 3] * v / 255;
    }
    oc.putImageData(od, 0, 0);
    return out;
  }

  /** Quita el fondo por color, rellenando desde los bordes (o en toda la imagen). */
  function colorBackgroundMask(src, s) {
    const w = src.width, h = src.height;
    const data = ctx2d(src).getImageData(0, 0, w, h).data;
    // Color de fondo: el elegido o el promedio de las 4 esquinas
    let target = s.bgColor ? hexToRgb(s.bgColor) : null;
    if (!target) {
      const pts = [0, w - 1, (h - 1) * w, h * w - 1];
      target = [0, 0, 0];
      pts.forEach((p) => { for (let c = 0; c < 3; c++) target[c] += data[p * 4 + c] / 4; });
    }
    const tol = s.tolerance * 4.4;     // 0-100 → distancia RGB aprox.
    const tol2 = tol * tol;
    const dist2 = (p) => {
      const dr = data[p * 4] - target[0], dg = data[p * 4 + 1] - target[1], db = data[p * 4 + 2] - target[2];
      return dr * dr + dg * dg + db * db;
    };
    const mask = createCanvas(w, h);
    const mc = ctx2d(mask);
    const md = mc.createImageData(w, h);
    const bg = new Uint8Array(w * h);
    if (s.contiguous) {
      const stack = new Int32Array(w * h);
      let top = 0;
      const push = (p) => { if (!bg[p] && data[p * 4 + 3] > 0 && dist2(p) <= tol2) { bg[p] = 1; stack[top++] = p; } };
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (top) {
        const p = stack[--top];
        const x = p % w;
        if (x > 0) push(p - 1);
        if (x < w - 1) push(p + 1);
        if (p >= w) push(p - w);
        if (p < w * (h - 1)) push(p + w);
      }
    } else {
      for (let p = 0; p < w * h; p++) if (dist2(p) <= tol2) bg[p] = 1;
    }
    for (let p = 0; p < w * h; p++) {
      md.data[p * 4] = md.data[p * 4 + 1] = md.data[p * 4 + 2] = 255;
      md.data[p * 4 + 3] = bg[p] ? 0 : 255;
    }
    mc.putImageData(md, 0, 0);
    return mask;
  }

  /** Elimina o reemplaza un color, conservando el sombreado. */
  function editColors(src, s) {
    const out = cloneCanvas(src);
    if (!s.target) return out;
    const c = ctx2d(out);
    const img = c.getImageData(0, 0, out.width, out.height);
    const d = img.data;
    const t = hexToRgb(s.target);
    const n = hexToRgb(s.newColor);
    const tol = s.tolerance * 4.4;
    const soft = tol * 1.25;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const dr = d[i] - t[0], dg = d[i + 1] - t[1], db = d[i + 2] - t[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist > soft) continue;
      // k = 1 dentro de la tolerancia y baja suave hasta el borde "soft"
      const k = dist <= tol ? 1 : 1 - (dist - tol) / (soft - tol);
      if (s.action === 'remove') {
        d[i + 3] = s.solid ? (k >= 0.5 ? 0 : d[i + 3]) : d[i + 3] * (1 - k);
      } else {
        d[i] = d[i] + (clamp(n[0] + dr, 0, 255) - d[i]) * k;
        d[i + 1] = d[i + 1] + (clamp(n[1] + dg, 0, 255) - d[i + 1]) * k;
        d[i + 2] = d[i + 2] + (clamp(n[2] + db, 0, 255) - d[i + 2]) * k;
      }
    }
    c.putImageData(img, 0, 0);
    return out;
  }

  /* ---------- Editar colores: cambios acumulables ----------
     Cada cambio (toque del gotero o trazo de pincel, borrador o restaurar) se
     guarda con sus propios ajustes y se vuelve a aplicar en orden. Así la vista
     previa y la descarga en alta resolución dan el mismo resultado.
     Las coordenadas se guardan de 0 a 1 y los tamaños en píxeles de la imagen original. */
  let colorOpsCache = null;   // { src, json, data } resultado parcial para no recalcular todo

  function applyColorOps(src, ops, fullW) {
    const w = src.width, h = src.height;
    const k = w / fullW;
    let data, start = 0;
    // Reutiliza el resultado de los cambios anteriores (clave mientras se pinta un trazo)
    if (colorOpsCache && colorOpsCache.src === src && ops.length > colorOpsCache.count &&
        JSON.stringify(ops.slice(0, colorOpsCache.count)) === colorOpsCache.json) {
      data = new Uint8ClampedArray(colorOpsCache.data);
      start = colorOpsCache.count;
    } else {
      data = ctx2d(src).getImageData(0, 0, w, h).data;
    }
    let orig = null;
    for (let i = start; i < ops.length; i++) {
      const op = ops[i];
      if (op.type === 'tap') applyTap(data, w, h, op);
      else {
        if (op.tool === 'restore' && !orig) orig = ctx2d(src).getImageData(0, 0, w, h).data;
        applyStroke(data, w, h, op, k, orig);
      }
      // Guarda el estado previo al último cambio (el que se está pintando)
      if (i === ops.length - 2) colorOpsCache = { src, count: i + 1, json: JSON.stringify(ops.slice(0, i + 1)), data: new Uint8ClampedArray(data) };
    }
    const out = createCanvas(w, h);
    const img = new ImageData(data, w, h);
    out.getContext('2d').putImageData(img, 0, 0);
    return out;
  }

  /* Toque del gotero: elimina o reemplaza el color tocado */
  function applyTap(d, w, h, op) {
    const px = clamp(Math.floor(op.x * w), 0, w - 1), py = clamp(Math.floor(op.y * h), 0, h - 1);
    const [tr, tg, tb] = hexToRgb(op.color);
    const tol = op.tol * 4.4, tol2 = tol * tol;
    const match = (p) => {
      if (d[p * 4 + 3] === 0) return false;
      const dr = d[p * 4] - tr, dg = d[p * 4 + 1] - tg, db = d[p * 4 + 2] - tb;
      return dr * dr + dg * dg + db * db <= tol2;
    };
    const sel = new Uint8Array(w * h);
    if (op.scope === 'connected') {
      // Solo la zona conectada al punto tocado (respeta ojos, letras y zonas cerradas)
      const start = py * w + px;
      if (!match(start)) return;
      const stack = new Int32Array(w * h);
      let top = 0;
      sel[start] = 1; stack[top++] = start;
      while (top) {
        const p = stack[--top];
        const x = p % w;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1];
        for (const q of nb) if (q >= 0 && !sel[q] && match(q)) { sel[q] = 1; stack[top++] = q; }
      }
    } else {
      for (let p = 0; p < w * h; p++) if (match(p)) sel[p] = 1;
    }
    const [nr, ng, nb] = hexToRgb(op.newColor || '#000000');
    for (let p = 0; p < w * h; p++) {
      if (!sel[p]) continue;
      const i = p * 4;
      if (op.action === 'remove') { d[i + 3] = 0; continue; }
      // Reemplazo conservando las variaciones de luz del color original
      d[i] = clamp(nr + (d[i] - tr), 0, 255);
      d[i + 1] = clamp(ng + (d[i + 1] - tg), 0, 255);
      d[i + 2] = clamp(nb + (d[i + 2] - tb), 0, 255);
    }
  }

  /* Trazo de pincel, borrador o restaurar (siempre con borde binario, apto DTF) */
  function applyStroke(d, w, h, op, k, orig) {
    const size = Math.max(1, op.size * k);
    const pts = op.pts.map(([x, y]) => [x * w, y * h]);
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const pad = size / 2 + 2;
    x0 = clamp(Math.floor(x0 - pad), 0, w); y0 = clamp(Math.floor(y0 - pad), 0, h);
    x1 = clamp(Math.ceil(x1 + pad), 0, w); y1 = clamp(Math.ceil(y1 + pad), 0, h);
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;
    const m = createCanvas(bw, bh);
    const mc = ctx2d(m);
    mc.translate(-x0, -y0);
    mc.fillStyle = mc.strokeStyle = '#000';
    mc.lineWidth = size;
    mc.lineCap = mc.lineJoin = 'round';
    if (pts.length === 1) {
      mc.beginPath();
      mc.arc(pts[0][0], pts[0][1], Math.max(0.6, size / 2), 0, Math.PI * 2);
      mc.fill();
    } else {
      mc.beginPath();
      mc.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) mc.lineTo(pts[i][0], pts[i][1]);
      mc.stroke();
    }
    const md = mc.getImageData(0, 0, bw, bh).data;
    const [pr, pg, pb] = op.tool === 'paint' ? hexToRgb(op.color) : [0, 0, 0];
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (md[(y * bw + x) * 4 + 3] < 128) continue;
        const i = ((y + y0) * w + (x + x0)) * 4;
        if (op.tool === 'paint') { d[i] = pr; d[i + 1] = pg; d[i + 2] = pb; d[i + 3] = 255; }
        else if (op.tool === 'erase') d[i + 3] = 0;
        else { d[i] = orig[i]; d[i + 1] = orig[i + 1]; d[i + 2] = orig[i + 2]; d[i + 3] = orig[i + 3]; }
      }
    }
  }

  /** Semitono para DTF (tramado por umbral, píxel a píxel).
      Cada píxel de salida se compara con la "forma del punto" de su celda de trama:
      - tonos por debajo de "Eliminar" desaparecen,
      - tonos por encima de "Conservar" quedan sólidos,
      - el resto se convierte en puntos que crecen con el tono.
      Los puntos conservan el color original (o negro/blanco) y el borde es binario. */
  function halftoneDTF(edited, s, outW) {
    const outH = Math.max(1, Math.round(outW * edited.height / edited.width));
    const work = resizeCanvas(edited, outW, outH);
    const c = ctx2d(work);
    const img = c.getImageData(0, 0, outW, outH);
    const d = img.data;
    // Nitidez antes de tramar: define mejor los detalles finos
    if (s.sharp > 0) unsharp(d, outW, outH, Math.max(1, Math.round(outW / 900)), s.sharp / 100 * 1.8);

    const pxPerInch = outW / (s.widthCm / CM_PER_INCH);
    const cell = Math.max(2, pxPerInch / s.lpi);
    const ang = s.angle * Math.PI / 180;
    const cos = Math.cos(ang) / cell, sin = Math.sin(ang) / cell;
    const lo = s.low / 255;                       // "Eliminar"
    const hi = 1 - s.high / 255;                  // "Conservar"
    const span = Math.max(0.001, hi - lo);
    // "Medios tonos": 0.5 = lineal; menos aclara, más oscurece los tonos medios
    const gamma = Math.log(0.5) / Math.log(clamp(s.mid, 0.05, 0.95));
    const ink = s.dotColor === 'black' ? [0, 0, 0] : s.dotColor === 'white' ? [255, 255, 255] : null;
    const shape = s.shape;

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const i = (y * outW + x) * 4;
        const a = d[i + 3] / 255;
        if (a === 0) continue;
        const L = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        // Tono que se imprime: los claros (remeras oscuras) o los oscuros (remeras claras)
        let t = (s.tone === 'dark' ? 1 - L : L) * a;
        let n;
        if (t <= lo) n = 0;
        else if (t >= hi) n = 1;
        else n = Math.pow((t - lo) / span, gamma);
        let on;
        if (n <= 0) on = false;
        else if (n >= 1) on = true;
        else {
          // Coordenadas dentro de la celda rotada (de -0,5 a 0,5)
          let u = x * cos + y * sin, v = -x * sin + y * cos;
          u -= Math.floor(u) + 0.5; v -= Math.floor(v) + 0.5;
          let th;
          if (shape === 'square') { const m = Math.max(Math.abs(u), Math.abs(v)); th = 4 * m * m; }
          else if (shape === 'line') th = Math.abs(v) * 2;
          else if (shape === 'ellipse') { const e = Math.sqrt(u * u * 0.6 + v * v * 1.4); th = e <= 0.5 ? Math.PI * e * e : 0.785 + (e - 0.5) / 0.35 * 0.215; }
          else { const r = Math.sqrt(u * u + v * v); th = r <= 0.5 ? Math.PI * r * r : 0.785 + (r - 0.5) / 0.2071 * 0.215; }
          on = n > th;
        }
        if (!on) { d[i + 3] = 0; continue; }
        if (ink) { d[i] = ink[0]; d[i + 1] = ink[1]; d[i + 2] = ink[2]; }
        d[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    return work;
  }

  /** Recorta los márgenes transparentes de una imagen. */
  function trimTransparent(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = ctx2d(canvas).getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    const out = createCanvas(x1 - x0 + 1, y1 - y0 + 1);
    out.getContext('2d').drawImage(canvas, -x0, -y0);
    return out;
  }

  /** Semitono: convierte tonos en puntos sobre fondo transparente. */
  function halftone(src, s, outW) {
    const outH = Math.round(outW * src.height / src.width);
    const out = createCanvas(outW, outH);
    const c = out.getContext('2d');
    const cols = Math.max(4, Math.round(s.widthCm / CM_PER_INCH * s.lpi));
    const cell = outW / cols;
    const gw = cols;
    const gh = Math.max(1, Math.round(cols * src.height / src.width));
    const sample = ctx2d(resizeCanvas(src, gw, gh)).getImageData(0, 0, gw, gh).data;
    const ang = s.angle * Math.PI / 180;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const cx = outW / 2, cy = outH / 2;
    const n = Math.ceil(Math.hypot(outW, outH) / cell / 2) + 2;
    const contrast = 1 + s.contrast / 50;
    const bright = s.brightness / 100;
    const minDot = s.minDot / 100;
    const single = s.mode !== 'color';
    c.fillStyle = s.mode === 'white' ? '#ffffff' : '#000000';
    if (single) c.beginPath();
    for (let iv = -n; iv <= n; iv++) {
      for (let iu = -n; iu <= n; iu++) {
        const u = iu * cell, v = iv * cell;
        const x = cx + u * cos - v * sin;
        const y = cy + u * sin + v * cos;
        if (x < -cell || y < -cell || x > outW + cell || y > outH + cell) continue;
        const gx = Math.floor(x / outW * gw), gy = Math.floor(y / outH * gh);
        if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
        const p = (gy * gw + gx) * 4;
        const a = sample[p + 3] / 255;
        if (a < 0.02) continue;
        let L = (0.299 * sample[p] + 0.587 * sample[p + 1] + 0.114 * sample[p + 2]) / 255;
        L = clamp((L - 0.5) * contrast + 0.5 + bright, 0, 1);
        // Negro y color: más punto donde es más oscuro. Blanco: donde es más claro.
        let val = s.mode === 'white' ? L : 1 - L;
        if (s.invert) val = 1 - val;
        val *= a;
        if (val < minDot) continue;
        if (!single) {
          c.fillStyle = `rgb(${sample[p]},${sample[p + 1]},${sample[p + 2]})`;
          c.beginPath();
        }
        if (s.shape === 'square') {
          const side = cell * Math.sqrt(val);
          c.save();
          c.translate(x, y);
          c.rotate(ang);
          c.rect(-side / 2, -side / 2, side, side);
          c.restore();
        } else {
          const r = cell * Math.sqrt(val / Math.PI);
          c.moveTo(x + r, y);
          c.arc(x, y, r, 0, Math.PI * 2);
        }
        if (!single) c.fill();
      }
    }
    if (single) c.fill();
    return out;
  }

  /** Semitransparencias → alfa sólido (corte o tramado). */
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function solidAlpha(src, s, highlight) {
    const out = cloneCanvas(src);
    const c = ctx2d(out);
    const img = c.getImageData(0, 0, out.width, out.height);
    const d = img.data;
    const w = out.width;
    const cellSize = s.ditherSize;
    let semi = 0, visible = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const a = d[i + 3];
      if (a > 0) visible++;
      if (a > 0 && a < 255) semi++;
      if (highlight) {
        if (a > 0 && a < 255) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 170; d[i + 3] = 255; }
        continue;
      }
      if (s.method === 'dither') {
        const x = Math.floor((p % w) / cellSize) & 3;
        const y = Math.floor(Math.floor(p / w) / cellSize) & 3;
        d[i + 3] = a / 255 > (BAYER4[y * 4 + x] + 0.5) / 16 ? 255 : 0;
      } else {
        d[i + 3] = a >= s.threshold ? 255 : 0;
      }
    }
    c.putImageData(img, 0, 0);
    out.stats = { semi, visible };
    return out;
  }

  /** Ajuste del borde después de quitar las semitransparencias:
      contraer o expandir el contorno unos píxeles y suavizar el serrucho.
      El resultado sigue siendo binario (0 o 100 %). */
  function adjustSolidEdge(canvas, s, k) {
    const offset = Math.round(s.edgeOffset * k);
    const smooth = Math.round(s.edgeSmooth * k);
    if (!offset && !smooth) return canvas;
    const w = canvas.width, h = canvas.height;
    // Al expandir, los píxeles nuevos toman el color de sus vecinos (sin halos oscuros)
    const base = offset > 0 ? bleedColors(canvas) : cloneCanvas(canvas);
    const c = ctx2d(base);
    const img = c.getImageData(0, 0, w, h);
    const d = img.data;
    const orig = ctx2d(canvas).getImageData(0, 0, w, h).data;
    let a = new Float32Array(w * h);
    for (let p = 0; p < a.length; p++) a[p] = orig[p * 4 + 3] >= 128 ? 255 : 0;
    if (offset) {
      const r = Math.abs(offset);
      const b = blurChannel(a, w, h, r, 1);
      for (let p = 0; p < a.length; p++) a[p] = offset > 0 ? (b[p] > 0.5 ? 255 : 0) : (b[p] >= 254.5 ? 255 : 0);
    }
    if (smooth) {
      const b = blurChannel(a, w, h, smooth, 2);
      for (let p = 0; p < a.length; p++) a[p] = b[p] >= 128 ? 255 : 0;
    }
    for (let p = 0; p < a.length; p++) d[p * 4 + 3] = a[p];
    c.putImageData(img, 0, 0);
    return base;
  }

  /** Ruido de valor fractal (0..1) para texturas de desgaste. */
  function fractalNoise(w, h, baseCells, seed, octaves = 3) {
    const rand = mulberry32(seed);
    const out = new Float32Array(w * h);
    let amp = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      const cells = Math.max(2, Math.round(baseCells * Math.pow(2, o)));
      const gw = cells + 2;
      const gh = Math.ceil(cells * h / w) + 2;
      const grid = new Float32Array(gw * gh);
      for (let i = 0; i < grid.length; i++) grid[i] = rand();
      const sx = cells / w;
      for (let y = 0; y < h; y++) {
        const fy = y * sx;
        const y0 = Math.floor(fy);
        let ty = fy - y0;
        ty = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < w; x++) {
          const fx = x * sx;
          const x0 = Math.floor(fx);
          let tx = fx - x0;
          tx = tx * tx * (3 - 2 * tx);
          const i = y0 * gw + x0;
          const top = grid[i] + (grid[i + 1] - grid[i]) * tx;
          const bot = grid[i + gw] + (grid[i + gw + 1] - grid[i + gw]) * tx;
          out[y * w + x] += (top + (bot - top) * ty) * amp;
        }
      }
      total += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }

  /* ---------- Efectos de desgaste (Grunge, Vintage, Grietas) ----------
     Se calcula una "máscara de borrado" binaria: los píxeles marcados quedan
     transparentes. Primero el efecto general (solo bordes o toda la imagen),
     después cada pasada del pincel de efectos y de Restaurar, en orden. */
  const fxCache = new Map();
  function fxCached(key, make) {
    if (!fxCache.has(key)) {
      if (fxCache.size > 12) fxCache.delete(fxCache.keys().next().value);
      fxCache.set(key, make());
    }
    return fxCache.get(key);
  }
  /* Pasa el ruido a una escala pareja de 0 a 1 (para que "cantidad" sea un porcentaje real) */
  function equalize(n) {
    const sample = [];
    const step = Math.max(1, Math.floor(n.length / 4000));
    for (let i = 0; i < n.length; i += step) sample.push(n[i]);
    sample.sort((a, b) => a - b);
    const q = (t) => sample[Math.min(sample.length - 1, Math.floor(t * sample.length))];
    const knots = [];
    for (let t = 0; t <= 20; t++) knots.push(q(t / 20));
    const out = new Float32Array(n.length);
    for (let i = 0; i < n.length; i++) {
      const v = n[i];
      let k = 0;
      while (k < 19 && v > knots[k + 1]) k++;
      const a = knots[k], b = knots[k + 1];
      out[i] = (k + (b > a ? clamp((v - a) / (b - a), 0, 1) : 0)) / 20;
    }
    return out;
  }
  /* Textura de cada estilo (0 = se borra primero, 1 = se borra último) */
  function fxTexture(w, h, style, tex, seed) {
    return fxCached(`tex|${w}|${h}|${style}|${tex}|${seed}`, () => {
      const base = 3 + (100 - tex) / 100 * 26;   // más tamaño de textura = manchas más grandes
      let n;
      if (style === 'vintage') {
        const a = fractalNoise(w, h, base * 3, seed, 2);
        const b = fractalNoise(w, h, base * 12, seed + 3, 1);
        n = new Float32Array(w * h);
        for (let i = 0; i < n.length; i++) n[i] = a[i] * 0.55 + b[i] * 0.45;
        n = equalize(n);
        // Rayas finas: líneas cortas en direcciones parecidas
        const sc = createCanvas(w, h);
        const c = sc.getContext('2d');
        const rand = mulberry32(seed + 11);
        c.strokeStyle = '#000';
        c.lineCap = 'round';
        const count = 260;
        const baseAng = rand() * Math.PI;
        for (let k = 0; k < count; k++) {
          const x = rand() * w, y = rand() * h;
          const len = (0.02 + rand() * 0.08) * Math.max(w, h);
          const ang = baseAng + (rand() - 0.5) * 0.5;
          c.lineWidth = Math.max(1, Math.min(w, h) * (0.0008 + rand() * 0.0015));
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
          c.stroke();
        }
        const d = c.getImageData(0, 0, w, h).data;
        // Las rayas cuentan como "lo primero que se borra" según su orden (k bajo)
        for (let i = 0; i < n.length; i++) if (d[i * 4 + 3] > 100) n[i] = Math.min(n[i], 0.02 + (i % 97) / 97 * 0.08);
      } else if (style === 'cracks') {
        n = new Float32Array(w * h).fill(1);
        const cc = createCanvas(w, h);
        const c = cc.getContext('2d');
        const rand = mulberry32(seed + 5);
        const minD = Math.min(w, h);
        const lw = Math.max(1, minD * 0.0022 * (0.6 + tex / 60));
        c.lineCap = c.lineJoin = 'round';
        // Cada grieta tiene un "orden": con más cantidad aparecen más grietas
        const total = 140;
        const drawCrack = (x, y, ang, len, width, depth, order) => {
          c.strokeStyle = `rgb(${order},0,0)`;
          c.lineWidth = width;
          c.beginPath();
          c.moveTo(x, y);
          const segs = 6 + Math.floor(rand() * 8);
          for (let k = 0; k < segs; k++) {
            ang += (rand() - 0.5) * 0.9;
            const l = len / segs;
            x += Math.cos(ang) * l; y += Math.sin(ang) * l;
            c.lineTo(x, y);
            if (depth < 2 && rand() < 0.25) {
              c.stroke();
              drawCrack(x, y, ang + (rand() < 0.5 ? 1 : -1) * (0.5 + rand() * 0.6), len * 0.45, Math.max(1, width * 0.7), depth + 1, order);
              c.strokeStyle = `rgb(${order},0,0)`;
              c.lineWidth = width;
              c.beginPath();
              c.moveTo(x, y);
            }
          }
          c.stroke();
        };
        for (let k = 0; k < total; k++) {
          const order = 1 + Math.floor(k / total * 250);
          drawCrack(rand() * w, rand() * h, rand() * Math.PI * 2, minD * (0.12 + rand() * 0.25), lw * (0.7 + rand() * 0.8), 0, order);
        }
        const d = c.getImageData(0, 0, w, h).data;
        for (let i = 0; i < n.length; i++) if (d[i * 4 + 3] > 110) n[i] = d[i * 4] / 255;
      } else {
        const a = fractalNoise(w, h, base, seed, 3);
        const b = fractalNoise(w, h, base * 5, seed + 7, 2);
        n = new Float32Array(w * h);
        for (let i = 0; i < n.length; i++) n[i] = a[i] * 0.72 + b[i] * 0.28;
        n = equalize(n);
      }
      return n;
    });
  }
  /* Cercanía al borde del diseño (1 en el borde, 0 desde la profundidad elegida hacia adentro) */
  function fxEdge(src, data, w, h, depth) {
    return fxCached(`edge|${src.__fxid || (src.__fxid = uid())}|${w}|${h}|${depth}`, () => {
      const alpha = new Float32Array(w * h);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
      const r = Math.max(1, Math.round(depth / 100 * Math.min(w, h) / 2.2));
      const b = blurChannel(alpha, w, h, r, 2);
      const e = new Float32Array(w * h);
      for (let i = 0; i < e.length; i++) e[i] = Math.pow(clamp((250 - b[i]) / 122, 0, 1), 1.4);
      return e;
    });
  }

  function renderEffects(src, s, fullW) {
    const w = src.width, h = src.height;
    const out = cloneCanvas(src);
    const c = ctx2d(out);
    const img = c.getImageData(0, 0, w, h);
    const d = img.data;
    const erase = new Uint8Array(w * h);
    // 1) Efecto general
    const tex = fxTexture(w, h, s.style, s.texture, s.seed);
    const A = s.amount / 100;
    const edge = s.depth > 0 ? fxEdge(src, d, w, h, s.depth) : null;
    for (let p = 0; p < w * h; p++) {
      if (d[p * 4 + 3] === 0) continue;
      const ef = edge ? edge[p] : 0;
      let prob;
      if (s.style === 'cracks') {
        // Grietas: aparecen según la cantidad; en "Solo bordes" únicamente cerca del borde
        const crackOn = tex[p] < 1 && tex[p] <= clamp(A * 4, 0, 1) && (s.scope === 'all' || ef > 0.03);
        if (crackOn) { erase[p] = 1; continue; }
        prob = ef * 0.55;
        if (prob > 0 && fxTexture(w, h, 'grunge', s.texture, s.seed)[p] < prob) erase[p] = 1;
        continue;
      }
      prob = s.scope === 'all' ? A * 2.5 + ef * 0.9 : ef * (0.9 + A);
      if (tex[p] < prob) erase[p] = 1;
    }
    // 2) Pasadas del pincel de efectos y de Restaurar
    const k = w / fullW;
    for (const op of s.ops) {
      const m = strokeMask(op, w, h, k);
      if (!m) continue;
      const { mask, x0, y0, bw, bh } = m;
      const t = op.tool === 'fx' ? fxTexture(w, h, op.style, s.texture, op.seed) : null;
      const pa = op.amount / 10;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          if (mask[(y * bw + x) * 4 + 3] < 128) continue;
          const p = (y + y0) * w + (x + x0);
          if (op.tool === 'restore') erase[p] = 0;
          else if (op.style === 'cracks' ? t[p] < 1 && t[p] <= pa : t[p] < pa * 0.8) erase[p] = 1;
        }
      }
    }
    for (let p = 0; p < w * h; p++) if (erase[p]) d[p * 4 + 3] = 0;
    c.putImageData(img, 0, 0);
    return out;
  }

  /* Máscara de un trazo (zona pintada), recortada a su rectángulo */
  function strokeMask(op, w, h, k) {
    const size = Math.max(1, op.size * k);
    const pts = op.pts.map(([x, y]) => [x * w, y * h]);
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const pad = size / 2 + 2;
    x0 = clamp(Math.floor(x0 - pad), 0, w); y0 = clamp(Math.floor(y0 - pad), 0, h);
    x1 = clamp(Math.ceil(x1 + pad), 0, w); y1 = clamp(Math.ceil(y1 + pad), 0, h);
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return null;
    const m = createCanvas(bw, bh);
    const mc = ctx2d(m);
    mc.translate(-x0, -y0);
    mc.fillStyle = mc.strokeStyle = '#000';
    mc.lineWidth = size;
    mc.lineCap = mc.lineJoin = 'round';
    mc.beginPath();
    if (pts.length === 1) { mc.arc(pts[0][0], pts[0][1], Math.max(0.6, size / 2), 0, Math.PI * 2); mc.fill(); }
    else { mc.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(([x, y]) => mc.lineTo(x, y)); mc.stroke(); }
    return { mask: mc.getImageData(0, 0, bw, bh).data, x0, y0, bw, bh };
  }

  /** Efectos: desgaste y bordes grunge (siempre con bordes sólidos, aptos DTF). */
  function grungeEffect(src, s) {
    const out = cloneCanvas(src);
    const w = out.width, h = out.height;
    const c = ctx2d(out);
    const img = c.getImageData(0, 0, w, h);
    const d = img.data;
    const baseCells = 4 + (11 - s.grain) * 5;
    const big = fractalNoise(w, h, baseCells, s.seed, 3);
    const fine = fractalNoise(w, h, baseCells * 6, s.seed + 7, 2);
    let edge = null;
    if (s.edges > 0) {
      const alpha = new Float32Array(w * h);
      for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
      edge = blurChannel(alpha, w, h, Math.max(2, Math.round(w * 0.018)), 2);
    }
    const wear = s.wear / 100;
    const edges = s.edges / 100;
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (d[i + 3] === 0) continue;
      const n = big[p] * 0.72 + fine[p] * 0.28;
      let erase = n < 0.18 + wear * 0.42 && fine[p] < 0.25 + wear * 0.55 ? wear > 0 : false;
      if (!erase && edge) {
        const e = 1 - edge[p] / 255;              // 0 adentro, sube cerca del borde
        if (e > 0.02 && n < e * edges * 2.2) erase = true;
      }
      if (erase) d[i + 3] = 0;
    }
    c.putImageData(img, 0, 0);
    return out;
  }

  /* =========================================================
     3. GUARDADO LOCAL (IndexedDB)
     ========================================================= */
  const DB = (() => {
    let dbPromise = null;
    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) { reject(new Error('Sin almacenamiento')); return; }
        const req = indexedDB.open('tuestampa-herramientas', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('kv');
          db.createObjectStore('images');
          db.createObjectStore('creations', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }
    async function run(store, mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
      });
    }
    return {
      get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
      put: (store, value, key) => run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
      del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
      all: (store) => run(store, 'readonly', (s) => s.getAll()),
      keys: (store) => run(store, 'readonly', (s) => s.getAllKeys()),
      clear: (store) => run(store, 'readwrite', (s) => s.clear()),
    };
  })();

  /* =========================================================
     4. ESTADO DE LA APP E HISTORIAL
     ========================================================= */

  /* Registro de imágenes: cada imagen tiene una versión completa y una de vista previa */
  const images = new Map();   // id → { full, preview, name }

  function registerImage(full, name = 'imagen', id = uid(), persist = true) {
    const preview = fitInside(full, PREVIEW_MAX);
    images.set(id, { full, preview, name });
    if (persist) {
      canvasToBlob(full).then((blob) => DB.put('images', { blob, name }, id)).catch(() => {});
    }
    return id;
  }

  const state = {
    tool: 'mejorar-foto',
    sourceId: null,        // imagen de trabajo actual
    settings: {},          // ajustes por herramienta
    cache: {},             // resultados costosos (ej. máscara de IA)
    compose: null,         // documentos de Diseño, Mockup y Lienzo (ver sección 6)
    zoom: 1,               // 1 = ajustado a la pantalla
    compare: false,
    comparePos: 0.5,
    bg: 'checker',
    openPanel: null,
  };

  const source = () => (state.sourceId ? images.get(state.sourceId) : null);
  const settingsOf = (toolId) => state.settings[toolId];

  /* --- Historial para Deshacer / Rehacer --- */
  const history = { past: [], future: [], editing: false };

  function snapshot() {
    return {
      tool: state.tool,
      sourceId: state.sourceId,
      settings: JSON.parse(JSON.stringify(state.settings[state.tool])),
      compose: JSON.parse(JSON.stringify(state.compose)),
    };
  }
  function restoreSnapshot(snap) {
    state.sourceId = snap.sourceId;
    state.settings[snap.tool] = snap.settings;
    state.compose = snap.compose;
    syncDesignRef();
    if (state.tool !== snap.tool) selectTool(snap.tool, { silent: true });
  }
  function pushHistory() {
    history.past.push(snapshot());
    if (history.past.length > 40) history.past.shift();
    history.future = [];
    updateHistoryButtons();
  }
  function undo() {
    if (!history.past.length) return;
    history.future.push(snapshot());
    restoreSnapshot(history.past.pop());
    afterStateChange();
  }
  function redo() {
    if (!history.future.length) return;
    history.past.push(snapshot());
    restoreSnapshot(history.future.pop());
    afterStateChange();
  }
  function updateHistoryButtons() {
    $('#undo-btn').disabled = !history.past.length;
    $('#redo-btn').disabled = !history.future.length;
    $('#restore-btn').disabled = !state.sourceId && !hasComposeContent();
  }
  function afterStateChange() {
    syncPanelButtons();
    renderPanelContent();
    renderHeading();
    schedulePreview();
    updateHistoryButtons();
    scheduleSave();
  }

  /* =========================================================
     5. DEFINICIÓN DE LAS HERRAMIENTAS
     Cada herramienta declara sus ajustes (paneles y controles),
     cómo genera la vista previa ("live") y la descarga ("full").
     ========================================================= */
  const ICONS = {
    crop: '<path d="M6 3v15h15M3 6h15v15M10 3v3M3 10h3"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    ruler: '<path d="m3 17 14-14 4 4L7 21Z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
    dots: '<circle cx="6" cy="6" r="1.4"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="6" r="2.6"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2.6"/><circle cx="18" cy="12" r="1.4"/><circle cx="6" cy="18" r="2.6"/><circle cx="12" cy="18" r="1.4"/><circle cx="18" cy="18" r="2"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
    sparkle: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 15v4M17 17h4"/>',
    canvas: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h5"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13 7 4 4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
    shirt: '<path d="m8.2 5 2.3-2h3l2.3 2 4.2 1.8-2 4-2.2-1V21H8.2V9.8L6 10.8l-2-4Z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8" cy="9" r="1.7"/><path d="m5.5 17 4.2-4.2 2.8 2.5 2.2-2 3.8 3.7"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    frame: '<rect x="4" y="3" width="13" height="15" rx="1.5"/><path d="M8 21h12V8"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/>',
    shapes: '<rect x="3" y="4" width="8" height="8" rx="1"/><circle cx="17" cy="8" r="4"/><path d="M4 20h16"/>',
    edge: '<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 2.5"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>',
    levels: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    angle: '<path d="M3 21h18M3 21 17 7"/><path d="M10 21a7 7 0 0 0-2-5"/><circle cx="19" cy="5" r="2"/>',
    dropper: '<path d="m14.7 3.3 6 6-2.2 2.2-1.2-1.2-6.4 6.4-3.6.7.7-3.6 6.4-6.4-1.2-1.2Z"/><path d="m12.6 8.4 3 3"/>',
    eraser: '<path d="m7 21-4.3-4.3a1.5 1.5 0 0 1 0-2.1l10-10a1.5 1.5 0 0 1 2.1 0l5.6 5.6a1.5 1.5 0 0 1 0 2.1L12 21Z"/><path d="M22 21H7M5 11l9 9"/>',
    restore: '<path d="m15 4 5 5-9 9H6v-5Z"/><path d="M3 21h7M12 7l5 5M19 2v3M21 4h-3"/>',
    brush: '<path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L11 16l-4-1 1-4Z"/><path d="M7 15c-2.5 0-4 1.5-4 4 0 1 0 2-1 3 3 0 7-1 7-4"/>',
    roll: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><rect x="8" y="6" width="4" height="5" rx=".7"/><rect x="13.5" y="6" width="2.5" height="3" rx=".5"/><rect x="8" y="13" width="8" height="5" rx=".7"/>',
  };
  const svgIcon = (name, filled) =>
    `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  const LIMPIEZA = ['Nula', 'Baja', 'Media', 'Alta', 'Máxima'];
  const enhanceLimit = (src, scale) => {
    // Evita superar el límite de memoria del navegador al ampliar
    const area = src.width * src.height * scale * scale;
    return area <= MAX_CANVAS_AREA * 0.8 && Math.max(src.width, src.height) * scale <= MAX_CANVAS_SIDE
      ? scale
      : Math.max(1, Math.floor(Math.sqrt(MAX_CANVAS_AREA * 0.8 / (src.width * src.height)) * 10) / 10);
  };

  const TOOLS = {
    /* ---------- 01 · Mejorar fotografía ---------- */
    'mejorar-foto': enhanceTool('mejorar-foto', {
      title: 'Mejorar fotografía',
      desc: 'Restaurá fotos y retratos con más nitidez, menos ruido y mayor resolución, sin cambiar rasgos ni expresión.',
      illustration: false,
      defaults: { engine: 'ai', scale: 2, clean: 1, sharp: 20 },
      panelLabel: 'Recorte y mejora',
      finishing: [
        { type: 'range', key: 'clean', label: 'Limpieza', min: 0, max: 4, step: 1, fmt: (v) => LIMPIEZA[v] },
        { type: 'range', key: 'sharp', label: 'Nitidez', min: 0, max: 55, step: 1, fmt: (v) => v + '%' },
      ],
      kind: 'Foto',
      downloadNoun: 'imagen mejorada',
      next: ['eliminar-fondo', 'semitono', 'lienzo', 'mockup'],
    }),

    /* ---------- 02 · Mejorar ilustración ---------- */
    'mejorar-ilustracion': enhanceTool('mejorar-ilustracion', {
      title: 'Mejorar ilustración',
      desc: 'Ampliá dibujos, logos y anime con bordes limpios y colores planos, ideales para estampar.',
      illustration: true,
      defaults: { engine: 'ai', scale: 2, clean: 2, flat: 1, sharp: 30 },
      panelLabel: 'Ampliación y limpieza',
      finishing: [
        { type: 'range', key: 'clean', label: 'Limpieza', min: 0, max: 4, step: 1, fmt: (v) => LIMPIEZA[v] },
        { type: 'range', key: 'flat', label: 'Colores planos', min: 0, max: 3, step: 1, fmt: (v) => ['No', 'Suave', 'Medio', 'Fuerte'][v] },
        { type: 'range', key: 'sharp', label: 'Bordes nítidos', min: 0, max: 80, step: 1, fmt: (v) => v + '%' },
      ],
      kind: 'Ilustración',
      downloadNoun: 'ilustración',
      next: ['eliminar-fondo', 'semitransparencias', 'lienzo', 'mockup'],
    }),

    /* ---------- 03 · Eliminar fondo ---------- */
    'eliminar-fondo': {
      title: 'Eliminar fondo',
      ai: true,
      desc: 'Separá personas, mascotas y objetos del fondo con IA, o quitá un fondo liso por color. Después retocá a mano lo que haga falta.',
      compare: true,
      picker: (s) => s.method === 'color' && s.brush === 'off',
      brush: (s) => s.brush !== 'off',
      defaults: { method: 'ai', aiQuality: 'fast', tolerance: 25, contiguous: true, bgColor: null, edge: 0, solid: true, brush: 'off', brushSize: 36 },
      panels: [
        {
          id: 'bg', label: 'Eliminar fondo', icon: 'crop',
          controls: [
            { type: 'segmented', key: 'method', label: 'Método', options: [['ai', 'IA (sujetos)'], ['color', 'Por color']] },
            { type: 'segmented', key: 'aiQuality', label: 'Calidad de la IA', when: (s) => s.method === 'ai', options: [['fast', 'Rápida'], ['high', 'Alta']] },
            { type: 'button', label: '✦ Quitar fondo con IA', primary: true, when: (s) => s.method === 'ai', action: () => runBackgroundAI() },
            { type: 'note', when: (s) => s.method === 'ai', text: (s) => aiNote(s) },
            { type: 'note', when: (s) => s.method === 'color', text: (s) => `Tocá el fondo en la imagen para elegir su color. ${s.bgColor ? `Color elegido: <span class="picked-color" style="background:${s.bgColor}"></span>` : 'Ahora se usa el color de las esquinas.'}` },
            { type: 'range', key: 'tolerance', label: 'Tolerancia', min: 1, max: 100, step: 1, when: (s) => s.method === 'color', fmt: (v) => v + '%' },
            { type: 'check', key: 'contiguous', label: 'Solo el fondo conectado a los bordes', when: (s) => s.method === 'color' },
            { type: 'range', key: 'edge', label: 'Suavizar borde', min: 0, max: 4, step: 1, fmt: (v) => (v ? v + ' px' : 'No') },
            { type: 'check', key: 'solid', label: 'Bordes sólidos (recomendado para DTF)' },
          ],
        },
        {
          id: 'touch', label: 'Retoque a mano', icon: 'brush',
          controls: [
            { type: 'segmented', key: 'brush', label: 'Pincel', options: [['off', 'Apagado'], ['erase', 'Borrar'], ['restore', 'Restaurar']] },
            { type: 'range', key: 'brushSize', label: 'Tamaño del pincel', min: 6, max: 120, step: 1, fmt: (v) => v + ' px' },
            { type: 'note', text: () => 'Pintá sobre la imagen: “Borrar” quita lo que sobró del fondo y “Restaurar” recupera partes que la IA cortó. Acercá con el zoom para los detalles.' },
            { type: 'button', label: '↶ Deshacer último trazo', action: () => undoTouchStroke(), disabled: () => !touchFor() || !touchFor().history.length },
            { type: 'button', label: '✕ Borrar todos los retoques', action: () => clearTouch(), disabled: () => !touchFor() },
          ],
        },
      ],
      quality: (s) => [s.method === 'ai' ? 'IA' : 'Color', 'Sin fondo'],
      live: (src, s) => {
        const base = bgBaseMask(src, s);
        const touch = touchFor();
        if (!base && !touch) return cloneCanvas(src);
        return applyMask(src, base || opaqueMask(src), s, touch && touch.canvas);
      },
      full: (src, s) => {
        // El relleno por color se calcula sobre una versión de hasta 3000 px y se escala
        const base = bgBaseMask(s.method === 'color' ? fitInside(src, 3000) : src, s);
        const touch = touchFor();
        if (!base && !touch) throw new Error('Primero tocá “Quitar fondo con IA” en Ajustes.');
        return applyMask(src, base || opaqueMask(src), s, touch && touch.canvas);
      },
      ready: (s) => s.method !== 'ai' || !!aiMaskFor() || !!touchFor(),
      notReady: 'Tocá “Quitar fondo con IA” para generar el resultado.',
      primaryAction: () => ({ label: '✦ Quitar fondo con IA', run: runBackgroundAI }),
      onPick: (rgbHex) => setSetting('bgColor', rgbHex),
      downloadLabel: () => '↓ Descargar PNG sin fondo',
      note: () => 'PNG con transparencia a 300 DPI.',
      next: ['semitransparencias', 'efectos', 'lienzo', 'mockup'],
    },

    /* ---------- 04 · Editar colores ---------- */
    'editar-colores': {
      title: 'Editar colores',
      desc: 'Eliminá o reemplazá colores con el gotero y retocá a mano con pincel, borrador y restaurar.',
      compare: true,
      colorOps: true,
      picker: (s) => s.mode === 'dropper' || s.pickPaint,
      brush: (s) => s.mode !== 'dropper' && !s.pickPaint,
      defaults: {
        mode: 'dropper', ops: [], pickPaint: false,
        tapAction: 'remove', tapScope: 'connected', tolerance: 22, newColor: '#ffffff',
        paintColor: '#000000', paintSize: 10, eraseSize: 88, restoreSize: 88,
      },
      panels: [
        {
          id: 'dropper', label: 'Gotero', icon: 'dropper', mode: 'dropper',
          controls: [
            { type: 'note', text: () => 'Tocá un color en la imagen. Los ajustes se aplican al próximo toque; los anteriores conservan su configuración.' },
            { type: 'segmented', key: 'tapAction', label: 'Acción', options: [['remove', 'Eliminar'], ['replace', 'Reemplazar']] },
            { type: 'segmented', key: 'tapScope', label: 'Alcance', options: [['connected', 'Solo fondo conectado'], ['all', 'Todo color similar']] },
            { type: 'help', when: (s) => s.tapScope === 'connected', text: () => 'Conserva ojos, letras y otras zonas cerradas aunque tengan el mismo color del fondo.' },
            { type: 'color', key: 'newColor', label: 'Nuevo color', when: (s) => s.tapAction === 'replace', swatches: ['#000000', '#ffffff', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#ec407a'] },
            { type: 'range', key: 'tolerance', label: 'Tolerancia', min: 1, max: 100, step: 1 },
            { type: 'button', label: (s) => undoOpLabel(s, 'tap'), action: () => undoLastOp('tap'), disabled: (s) => !s.ops.some((o) => o.type === 'tap') },
          ],
        },
        {
          id: 'paint', label: 'Pincel', icon: 'brush', mode: 'paint',
          controls: [
            { type: 'color', key: 'paintColor', label: 'Color del pincel', swatches: ['#000000', '#ffffff', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#ec407a'] },
            { type: 'button', label: (s) => (s.pickPaint ? '◎ Tocá la imagen para tomar el color…' : '◎ Tomar color de la imagen'), action: () => setSetting('pickPaint', !settingsOf('editar-colores').pickPaint) },
            ...sizeControls('paintSize', 'Tamaño del pincel'),
            { type: 'button', label: (s) => undoOpLabel(s, 'stroke'), action: () => undoLastOp('stroke'), disabled: (s) => !s.ops.some((o) => o.type === 'stroke') },
          ],
        },
        {
          id: 'erase', label: 'Borrador', icon: 'eraser', mode: 'erase',
          controls: [
            ...sizeControls('eraseSize', 'Tamaño del borrador'),
            { type: 'button', label: (s) => undoOpLabel(s, 'stroke'), action: () => undoLastOp('stroke'), disabled: (s) => !s.ops.some((o) => o.type === 'stroke') },
            { type: 'help', text: () => 'Edición local: se hace en tu dispositivo, sin subir la imagen.' },
          ],
        },
        {
          id: 'restore', label: 'Restaurar', icon: 'restore', mode: 'restore',
          controls: [
            { type: 'help', text: () => 'Recuperá el color y el contenido original en la zona que pintás.' },
            ...sizeControls('restoreSize', 'Tamaño de Restaurar'),
            { type: 'button', label: (s) => undoOpLabel(s, 'stroke'), action: () => undoLastOp('stroke'), disabled: (s) => !s.ops.some((o) => o.type === 'stroke') },
          ],
        },
      ],
      quality: (s) => [String(s.ops.length), s.ops.length === 1 ? 'cambio' : 'cambios'],
      live: (src, s) => (s.ops.length ? applyColorOps(src, s.ops, source().full.width) : cloneCanvas(src)),
      full: (src, s) => applyColorOps(src, s.ops, src.width),
      downloadLabel: () => '↓ Descargar PNG transparente',
      note: () => 'El pincel y el borrador entregan transparencia binaria, sin píxeles semitransparentes.',
      next: ['semitono', 'lienzo', 'mockup', 'diseno'],
    },

    /* ---------- 05 · Crear semitono ---------- */
    semitono: {
      title: 'Semitono',
      desc: 'Convertí sombras y degradados en puntos sólidos, para que el DTF quede liviano y respirable.',
      compare: true,
      colorOps: true,
      picker: (s) => s.mode === 'dropper',
      brush: (s) => s.mode === 'erase' || s.mode === 'restore',
      sampleEdited: true,
      defaults: {
        mode: 'none', ops: [], tapScope: 'all', tolerance: 18, eraseSize: 43, restoreSize: 43,
        low: 26, mid: 0.5, high: 27, tone: 'light', dotColor: 'original',
        widthCm: 25, unit: 'cm', sharp: 21, lpi: 25, angle: 45, shape: 'circle',
      },
      panels: [
        {
          id: 'dropper', label: 'Eliminar color', icon: 'dropper', mode: 'dropper',
          controls: [
            { type: 'note', text: () => 'Tocá el color que querés eliminar (por ejemplo, el fondo).' },
            { type: 'segmented', key: 'tapScope', label: 'Alcance', options: [['all', 'Todo color similar'], ['connected', 'Solo zona conectada']] },
            { type: 'range', key: 'tolerance', label: 'Tolerancia', min: 1, max: 100, step: 1 },
            { type: 'button', label: (s) => undoOpLabel(s, 'tap'), action: () => undoLastOp('tap'), disabled: (s) => !s.ops.some((o) => o.type === 'tap') },
          ],
        },
        {
          id: 'erase', label: 'Borrador', icon: 'eraser', mode: 'erase',
          controls: [
            { type: 'range', key: 'eraseSize', label: 'Tamaño del borrador', min: 1, max: 200, step: 1, fmt: (v) => v + ' px' },
            { type: 'button', label: () => 'Restablecer', action: () => resetOps('erase'), disabled: (s) => !s.ops.some((o) => o.tool === 'erase') },
          ],
        },
        {
          id: 'restore', label: 'Restaurar', icon: 'restore', mode: 'restore',
          controls: [
            { type: 'range', key: 'restoreSize', label: 'Tamaño de Restaurar', min: 1, max: 200, step: 1, fmt: (v) => v + ' px' },
            { type: 'button', label: () => 'Restablecer', action: () => resetOps('restore'), disabled: (s) => !s.ops.some((o) => o.tool === 'restore') },
          ],
        },
        {
          id: 'levels', label: 'Tramado y niveles', icon: 'levels',
          controls: [
            { type: 'levels' },
            { type: 'range', key: 'low', label: 'Eliminar', min: 0, max: 200, step: 1 },
            { type: 'range', key: 'mid', label: 'Medios tonos', min: 0.1, max: 0.9, step: 0.01, fmt: (v) => Number(v).toFixed(2) },
            { type: 'range', key: 'high', label: 'Conservar', min: 0, max: 200, step: 1 },
            { type: 'segmented', key: 'tone', label: 'Tono que se imprime', options: [['light', 'Claros'], ['dark', 'Oscuros']] },
            { type: 'help', text: (s) => (s.tone === 'light' ? 'Claros: para estampar sobre remeras oscuras (lo oscuro se elimina).' : 'Oscuros: para remeras claras (lo claro se elimina).') },
            { type: 'segmented', key: 'dotColor', label: 'Color de los puntos', options: [['original', 'Original'], ['black', 'Negro'], ['white', 'Blanco']] },
          ],
        },
        { id: 'size', label: 'Medidas e imagen', icon: 'ruler', render: (el) => renderHalftoneSizePanel(el) },
        {
          id: 'screen', label: 'Lineatura y ángulo', icon: 'angle',
          controls: [
            { type: 'range', key: 'lpi', label: 'Lineatura', min: 10, max: 80, step: 1, fmt: (v) => v + ' LPI' },
            { type: 'range', key: 'angle', label: 'Ángulo', min: 0, max: 90, step: 1, fmt: (v) => v + '°' },
            { type: 'select', key: 'shape', label: 'Forma del punto', options: [['circle', 'Redondo'], ['square', 'Cuadrado'], ['ellipse', 'Elíptico'], ['line', 'Línea']] },
            { type: 'help', text: () => 'DTF suele ir entre 20 y 35 LPI. Más LPI da puntos más chicos y finos.' },
          ],
        },
      ],
      quality: (s) => ['PNG · 300 ppp', `${s.lpi} LPI`],
      info: (s) => {
        const src = source();
        const hcm = src ? s.widthCm * src.full.height / src.full.width : 0;
        return [['Medida', `${fmtCm(s.widthCm)} × ${fmtCm(hcm)}`], ['Salida', `${cmToPx(s.widthCm)} × ${cmToPx(hcm)} px`], ['Archivo', 'PNG · 300 ppp']];
      },
      live: (src, s) => {
        const edited = s.ops.length ? applyColorOps(src, s.ops, source().full.width) : src;
        // La vista previa respeta la escala real de la trama
        const outW = Math.min(PREVIEW_MAX, cmToPx(s.widthCm));
        return halftoneDTF(edited, s, outW);
      },
      full: (src, s) => {
        const w = cmToPx(s.widthCm);
        const h = Math.round(w * src.height / src.width);
        if (w * h > MAX_CANVAS_AREA) throw new Error('La medida es demasiado grande para este dispositivo. Probá con menos centímetros.');
        const edited = s.ops.length ? applyColorOps(src, s.ops, src.width) : src;
        return halftoneDTF(edited, s, w);
      },
      extraActions: [{ label: 'Recortar márgenes transparentes', run: () => trimHalftoneMargins() }],
      downloadLabel: () => '↓ Descargar PNG',
      note: (s) => `Se descarga a ${fmtCm(s.widthCm)} de ancho, a 300 ppp.`,
      next: ['lienzo', 'mockup', 'diseno', 'efectos'],
    },

    /* ---------- 06 · Semitransparencias ---------- */
    semitransparencias: {
      title: 'Quitar semitransparencias',
      desc: 'Para imágenes editadas fuera de Tu Estampa SF. Si la editaste acá, no hace falta: las semitransparencias se eliminan automáticamente.',
      compare: true,
      defaults: { method: 'cut', threshold: 128, ditherSize: 1, highlight: false, edgeOffset: 0, edgeSmooth: 0, widthCm: null, unit: 'cm' },
      panels: [
        {
          id: 'alpha', label: 'Opacidad', icon: 'drop', chip: true,
          controls: [
            { type: 'segmented', key: 'method', label: 'Método', options: [['cut', 'Cortar'], ['dither', 'Tramar']] },
            { type: 'help', text: (s) => (s.method === 'cut' ? 'Cortar: lo que supera la opacidad elegida queda sólido; el resto desaparece.' : 'Tramar: las sombras suaves se convierten en puntitos sólidos.') },
            { type: 'range', key: 'threshold', label: 'Opacidad mínima', min: 1, max: 254, step: 1, when: (s) => s.method === 'cut', fmt: (v) => Math.round(v / 2.55) + '%' },
            { type: 'range', key: 'ditherSize', label: 'Tamaño del tramado', min: 1, max: 6, step: 1, when: (s) => s.method === 'dither', fmt: (v) => v + ' px' },
            { type: 'check', key: 'highlight', label: 'Resaltar en rosa las semitransparencias de la original' },
            { type: 'note', text: () => semiInfo() },
          ],
        },
        {
          id: 'edge', label: 'Borde', icon: 'edge', chip: true,
          controls: [
            { type: 'range', key: 'edgeOffset', label: 'Contraer / expandir', min: -6, max: 6, step: 1, fmt: (v) => (v > 0 ? '+' : '') + v + ' px' },
            { type: 'range', key: 'edgeSmooth', label: 'Suavizar contorno', min: 0, max: 6, step: 1, fmt: (v) => (v ? v + ' px' : 'No') },
            { type: 'help', text: () => 'Contraer elimina restos del fondo en el contorno; expandir agranda el diseño. Suavizar quita el serrucho. El borde sigue siendo 100 % sólido.' },
          ],
        },
        { id: 'size', label: 'Medida', icon: 'ruler', chip: true, render: (el) => renderPrintSizePanel(el, 'semitransparencias') },
      ],
      quality: (s) => [s.method === 'cut' ? 'Corte' : 'Tramado', 'Alpha 0 o 100 %'],
      info: (s) => {
        const src = source();
        const med = s.widthCm && src ? `${fmtCm(s.widthCm)} × ${fmtCm(s.widthCm * src.full.height / src.full.width)}` : 'A elección';
        return [['Formato', 'PNG transparente'], ['Medida', med], ['Alpha', '0 o 100 %']];
      },
      live: (src, s) => {
        const out = solidAlpha(src, s, s.highlight);
        state.cache.semiStats = out.stats;
        if (s.highlight) return out;
        const stats = out.stats;
        const adj = adjustSolidEdge(out, s, src.width / source().full.width);
        adj.stats = stats;
        return adj;
      },
      full: (src, s) => {
        let out = adjustSolidEdge(solidAlpha(src, s, false), s, 1);
        if (s.widthCm) {
          const w = cmToPx(s.widthCm), h = Math.round(w * src.height / src.width);
          if (w * h > MAX_CANVAS_AREA) throw new Error('La medida es demasiado grande para este dispositivo.');
          if (w !== src.width) out = binaryAlpha(resizeCanvas(out, w, h));
        }
        return out;
      },
      downloadLabel: () => '↓ Descargar PNG listo para DTF',
      note: () => 'Se conservan los píxeles originales y la medida de impresión elegida.',
      next: ['lienzo', 'mockup', 'diseno'],
    },

    /* ---------- 07 · Efectos ---------- */
    efectos: {
      title: 'Efectos',
      desc: 'Agregá bordes grunge, desgaste vintage o grietas. Todo queda transparente, listo para DTF.',
      compare: true,
      colorOps: true,
      brush: (s) => s.mode === 'fx' || s.mode === 'restore',
      defaults: {
        style: 'grunge', scope: 'edges', depth: 7, amount: 6, texture: 40, seed: 1,
        mode: 'none', ops: [], fxStyle: 'grunge', fxSize: 18, fxAmount: 4, restoreSize: 8,
        widthCm: null, unit: 'cm',
      },
      panels: [
        {
          id: 'fx', label: 'Efecto y desgaste', icon: 'levels',
          controls: [
            { type: 'segmented', key: 'style', label: 'Estilo', grid: true, options: [['grunge', 'Grunge'], ['vintage', 'Vintage'], ['cracks', 'Grietas']] },
            { type: 'help', text: (s) => FX_DESC[s.style] },
            { type: 'segmented', key: 'scope', label: 'Dónde', options: [['edges', 'Solo bordes'], ['all', 'Toda la imagen']] },
            { type: 'range', key: 'depth', label: 'Profundidad del borde', min: 0, max: 30, step: 1, fmt: (v) => v + '%' },
            { type: 'range', key: 'amount', label: 'Cantidad de desgaste', min: 0, max: 30, step: 1, fmt: (v) => v + '%' },
            { type: 'range', key: 'texture', label: 'Tamaño de la textura', min: 0, max: 100, step: 1 },
            { type: 'button', label: () => '↻ Otra variante', action: () => { pushHistory(); settingsOf('efectos').seed++; afterStateChange(); } },
          ],
        },
        {
          id: 'fxbrush', label: 'Pincel de efectos', icon: 'brush', mode: 'fx',
          controls: [
            { type: 'segmented', key: 'fxStyle', label: 'Estilo', grid: true, options: [['grunge', 'Grunge'], ['vintage', 'Vintage'], ['cracks', 'Grietas']] },
            { type: 'range', key: 'fxSize', label: 'Tamaño del pincel', min: 1, max: 60, step: 1, fmt: (v) => v + '%' },
            { type: 'range', key: 'fxAmount', label: 'Cantidad de desgaste', min: 1, max: 10, step: 1 },
            { type: 'help', text: () => 'Tamaño y cantidad independientes. Cada pasada conserva sus ajustes.' },
            { type: 'button', label: () => 'Restablecer pinceladas', action: () => resetOps('fx'), disabled: (s) => !s.ops.some((o) => o.tool === 'fx') },
          ],
        },
        {
          id: 'restore', label: 'Restaurar zonas', icon: 'restore', mode: 'restore',
          controls: [
            { type: 'range', key: 'restoreSize', label: 'Tamaño del pincel', min: 1, max: 60, step: 1, fmt: (v) => v + '%' },
            { type: 'help', text: () => 'Pintá las zonas que querés dejar sin efecto. Conserva la transparencia original.' },
            { type: 'button', label: () => 'Restablecer', action: () => resetOps('restore'), disabled: (s) => !s.ops.some((o) => o.tool === 'restore') },
          ],
        },
        { id: 'size', label: 'Medidas de impresión', icon: 'ruler', render: (el) => renderPrintSizePanel(el, 'efectos') },
      ],
      brushSize: (s, src) => {
        const pct = s.mode === 'fx' ? s.fxSize : s.restoreSize;
        return pct / 100 * Math.min(src.full.width, src.full.height);
      },
      strokeExtra: (s) => ({ style: s.fxStyle, amount: s.fxAmount, seed: s.seed + 100 + s.ops.length }),
      hint: (s) => (s.mode === 'fx' ? 'Pincel de efectos: pintá donde querés desgaste.' : s.mode === 'restore' ? 'Restaurar: pintá para recuperar la imagen original.' : ''),
      quality: (s) => [FX_NAMES[s.style], s.scope === 'all' ? 'Toda la imagen' : 'Solo bordes'],
      info: (s) => {
        const src = source();
        if (!src) return null;
        const wcm = s.widthCm || pxToCm(src.full.width);
        const hcm = wcm * src.full.height / src.full.width;
        return [['Medida', `${fmtCm(wcm)} × ${fmtCm(hcm)}`], ['Salida', `${cmToPx(wcm)} × ${cmToPx(hcm)} px`], ['Archivo', 'PNG · 300 ppp']];
      },
      live: (src, s) => renderEffects(src, s, source().full.width),
      full: (src, s) => {
        let out = renderEffects(src, s, src.width);
        // Medida de impresión elegida (a 300 ppp)
        if (s.widthCm) {
          const w = cmToPx(s.widthCm), h = Math.round(w * src.height / src.width);
          if (w * h > MAX_CANVAS_AREA) throw new Error('La medida es demasiado grande para este dispositivo.');
          if (w !== src.width) out = binaryAlpha(resizeCanvas(out, w, h));
        }
        return out;
      },
      sheetWidthCm: (s) => s.widthCm,
      downloadLabel: () => '↓ Descargar PNG con transparencia',
      note: () => 'Bordes y grietas transparentes. El fondo es solo para la vista previa.',
      next: ['mockup', 'lienzo'],
    },

    /* ---------- 08 · Crear diseño (editor de composición) ---------- */
    diseno: {
      title: 'Crear diseño',
      desc: 'Diseños para redes y estampados: plantillas, textos, formas e imágenes. Hasta 20 diseños por proyecto.',
      interactive: true,
      needsImage: false,
      defaults: {},
      panels: [
        { id: 'design-pages', label: 'Mis diseños', icon: 'grid', action: () => togglePagesStrip(), pressed: () => state.compose.showPages },
        { id: 'design-size', label: 'Tamaño', icon: 'frame', render: (el) => renderDesignSizePanel(el) },
        { id: 'design-templates', label: 'Plantillas', icon: 'layout', render: (el) => renderTemplatesPanel(el) },
        { id: 'design-export', label: 'Descargar', icon: 'download', render: (el) => renderDesignExportPanel(el) },
        { id: 'design-shapes', label: 'Formas', header: false, render: (el) => renderShapesPanel(el) },
        { id: 'design-layers', label: 'Capas', header: false, render: (el) => renderLayers(el, 'diseno') },
        { id: 'design-props', label: 'Elemento', header: false, render: (el) => renderItemProps(el, 'diseno') },
      ],
      sideTools: [
        { label: 'Imagen', icon: 'image', run: () => $('#extra-file-input').click() },
        { label: 'Texto', text: 'T', run: () => addDesignText() },
        { label: 'Formas', icon: 'shapes', panel: 'design-shapes' },
        { label: 'Capas', icon: 'layers', panel: 'design-layers' },
        { label: 'Editar elemento', icon: 'edit', panel: 'design-props', disabled: () => !selectedItem('diseno') },
      ],
      quality: () => { const d = state.compose.diseno; return [`${d.w} × ${d.h}`, 'px']; },
      info: () => {
        const c = state.compose, d = c.diseno;
        return [['Medida', `${d.w} × ${d.h} px`], ['Diseño', `${c.designIndex + 1} de ${c.designs.length}`], ['Archivo', c.designFormat === 'jpg' && !d.transparent ? 'JPG' : 'PNG']];
      },
      uploadLabel: 'Agregar imagen',
      downloadLabel: () => { const c = state.compose; return c.designScope === 'all' && c.designs.length > 1 ? `↓ Descargar los ${c.designs.length} diseños` : '↓ Descargar diseño'; },
      note: () => 'Para estampar, usá “Pasar al lienzo”: se envía sin el fondo y listo para imprimir.',
      next: ['lienzo', 'mockup'],
    },

    /* ---------- 09 · Crear mockup ---------- */
    mockup: {
      title: 'Crear mockup',
      desc: 'Mostrá cómo queda tu diseño en una remera o sobre una foto propia antes de imprimir.',
      interactive: true,
      needsImage: false,
      defaults: {},
      panels: [
        { id: 'mock-base', label: 'Elegir mockup', icon: 'shirt', render: (el) => renderMockupBasePanel(el) },
        { id: 'mock-settings', label: 'Ajustes', icon: 'sliders', render: (el) => renderMockupSettingsPanel(el) },
        { id: 'mock-design', label: 'Estampa', icon: 'image', render: (el) => renderItemProps(el, 'mockup') },
      ],
      quality: () => { const m = state.compose.mockup; return ['Mockup', m.base === 'photo' ? 'Foto propia' : MOCK_TEMPLATES[m.template].label]; },
      info: () => {
        const m = state.compose.mockup;
        return [
          ['Vista', m.base === 'photo' ? 'Foto propia' : (m.view === 'back' ? 'Espalda' : 'Frente')],
          ['Salida', `${m.w} × ${m.h} px`],
          ['Archivo', m.format.toUpperCase()],
        ];
      },
      uploadLabel: 'Subir / cambiar imagen',
      downloadLabel: () => `↓ Descargar mockup en ${state.compose.mockup.format.toUpperCase()}`,
      note: () => (state.compose.mockup.format === 'png'
        ? (isPhotoTemplate(state.compose.mockup.template) || isRealTemplate(state.compose.mockup.template) ? 'Las fotos se descargan con su fondo original.' : 'Se descarga con fondo transparente. La imagen se genera en tu dispositivo.')
        : 'La remera se muestra sobre blanco. En PNG el fondo queda transparente.'),
      next: ['diseno'],
    },

    /* ---------- 10 · Armar lienzo DTF ---------- */
    lienzo: {
      title: 'Armar lienzo DTF',
      desc: 'Ubicá tus diseños en un lienzo a escala real. Ordenalos solos o movelos a mano, y descargá en PNG o PDF a 300 ppp.',
      interactive: true,
      needsImage: false,
      fitWidth: true,
      defaults: {},
      panels: [
        { id: 'sheet-size', label: 'Medidas del lienzo', icon: 'ruler', render: (el) => renderSheetSizePanel(el) },
        { id: 'sheet-arrange', label: 'Ordenar automáticamente', icon: 'grid', action: () => arrangeSheet(), pressed: () => false },
        { id: 'sheet-selected', label: 'Imagen seleccionada', icon: 'levels', render: (el) => renderSheetSelectedPanel(el) },
        { id: 'sheet-layers', label: 'Capas', icon: 'layers', render: (el) => renderSheetLayersPanel(el) },
      ],
      quality: () => { const sh = state.compose.lienzo; return ['Lienzo', `${fmtNum(sh.widthCm)} × ${fmtNum(sh.heightCm)} cm`]; },
      info: () => { const sh = state.compose.lienzo; return [['Medida', `${fmtNum(sh.widthCm)} × ${fmtNum(sh.heightCm)} cm`], ['Formato', 'PNG / PDF'], ['Exportación', '300 PPP']]; },
      uploadLabel: 'Subir imágenes',
      multiple: true,
      downloadLabel: () => '↓ Descargar PNG',
      secondaryDownload: { label: '↓ Descargar PDF', run: () => downloadSheetPdf() },
      note: () => 'El fondo elegido es solo para revisar el diseño: la descarga sigue siendo transparente. Escala real: si indicás 7 cm, se exporta a 7 cm a 300 ppp. Imprimí al 100 % y sin “ajustar a página”.',
      next: [],
    },

  };
  const TOOL_ORDER = Object.keys(TOOLS);

  const FX_NAMES = { grunge: 'Grunge', vintage: 'Vintage', cracks: 'Grietas' };
  const FX_DESC = {
    grunge: 'Roturas irregulares y sectores gastados, como una textura grunge.',
    vintage: 'Raspado fino, pequeños huecos y rayas distribuidas sobre todo el diseño.',
    cracks: 'Grietas delgadas y ramificadas que cortan el diseño sin agregar color.',
  };
  /* Después de escalar, la transparencia vuelve a ser binaria (apta DTF) */
  function binaryAlpha(canvas) {
    const c = ctx2d(canvas);
    const img = c.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= 128 ? 255 : 0;
    c.putImageData(img, 0, 0);
    return canvas;
  }

  /* Controles de tamaño del pincel: deslizador, medida exacta y atajos */
  function sizeControls(key, label) {
    return [
      { type: 'range', key, label, min: 1, max: 200, step: 1, fmt: (v) => v + ' px' },
      { type: 'number', key, label: 'Tamaño exacto (px)', min: 1, max: 500, step: 1, suffix: 'px' },
      { type: 'presets', key, options: [[1, '1 px'], [2, '2 px'], [5, '5 px'], [10, '10 px']] },
    ];
  }
  function undoOpLabel(s, type) {
    const n = s.ops.filter((o) => o.type === type).length;
    if (!n) return type === 'tap' ? 'Todavía no aplicaste toques' : 'Todavía no aplicaste retoques';
    return `↶ Deshacer último ${type === 'tap' ? 'toque' : 'retoque'} (${n})`;
  }
  function undoLastOp(type) {
    const s = settingsOf(state.tool);
    const i = s.ops.map((o) => o.type).lastIndexOf(type);
    if (i < 0) return;
    pushHistory();
    s.ops.splice(i, 1);
    afterStateChange();
  }

  /* Textos de ayuda dinámicos */
  function outputInfo() {
    const src = source();
    if (!src) return 'Subí una imagen para ver la medida final.';
    const s = settingsOf(state.tool);
    const r = s.engine !== 'fast' ? aiEnhanceResult(s) : null;
    if (r) {
      const { width: w, height: h } = r.canvas;
      return `Resultado con IA: <b>${w} × ${h} px</b> · ${fmtCm(pxToCm(w))} × ${fmtCm(pxToCm(h))} a 300 DPI.`;
    }
    const k = enhanceLimit(src.full, s.scale);
    const w = Math.round(src.full.width * k), h = Math.round(src.full.height * k);
    const lim = k < s.scale ? ` (limitado a ${k}× por memoria del dispositivo)` : '';
    return `Resultado: <b>${w} × ${h} px</b>${lim} · ${fmtCm(pxToCm(w))} × ${fmtCm(pxToCm(h))} a 300 DPI.`;
  }
  /* Medidas: alto y ancho vinculados, en cm, pulgadas o píxeles */
  const UNITS = { cm: { label: 'Centímetros (cm)', k: 1, step: 0.1 }, in: { label: 'Pulgadas (in)', k: 1 / CM_PER_INCH, step: 0.05 }, px: { label: 'Píxeles (px)', k: DPI / CM_PER_INCH, step: 1 } };
  function renderHalftoneSizePanel(el) { renderPrintSizePanel(el, 'semitono', true); }
  function renderPrintSizePanel(el, toolId, withSharp) {
    const s = settingsOf(toolId);
    const src = source();
    if (!src) { field(el, '<p class="panel-note">Subí una imagen para elegir la medida.</p>'); return; }
    const ratio = src.full.height / src.full.width;
    const widthCm = s.widthCm || pxToCm(src.full.width);
    const u = UNITS[s.unit];
    const fmtU = (cm) => (s.unit === 'px' ? Math.round(cm * u.k) : Math.round(cm * u.k * 100) / 100);
    const f = field(el, `<label class="field-label" for="ht-unit">Unidad</label><select id="ht-unit">${Object.entries(UNITS).map(([k, v]) => `<option value="${k}" ${k === s.unit ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`);
    f.querySelector('select').addEventListener('change', (e) => setSetting('unit', e.target.value));
    const g = field(el, `<div class="dims">
      <label><span>Alto final</span><span class="unit-input"><input type="number" id="ht-h" min="0" step="${u.step}" value="${fmtU(widthCm * ratio)}" inputmode="decimal"><i>${s.unit}</i></span></label>
      <label><span>Ancho final</span><span class="unit-input"><input type="number" id="ht-w" min="0" step="${u.step}" value="${fmtU(widthCm)}" inputmode="decimal"><i>${s.unit}</i></span></label>
    </div>`);
    const toCm = (v) => Number(v) / u.k;
    g.querySelector('#ht-w').addEventListener('change', (e) => setSetting('widthCm', clamp(toCm(e.target.value) || 1, 1, 200)));
    g.querySelector('#ht-h').addEventListener('change', (e) => setSetting('widthCm', clamp((toCm(e.target.value) || 1) / ratio, 1, 200)));
    if (withSharp) renderControl(el, { type: 'range', key: 'sharp', label: 'Nitidez', min: 0, max: 100, step: 1, fmt: (v) => v + '%' }, s);
    field(el, `<p class="field-help">300 ppp · ${cmToPx(widthCm)} × ${cmToPx(widthCm * ratio)} px. Alto y ancho mantienen la proporción. Esta medida se conserva al pasar al lienzo.</p>`);
  }
  async function trimHalftoneMargins() {
    const src = source();
    if (!src) return;
    const s = settingsOf('semitono');
    setBusy(true, 'Recortando…');
    await nextFrame();
    try {
      // Aplica los cambios (gotero, borrador, restaurar) y recorta lo transparente
      const edited = s.ops.length ? applyColorOps(src.full, s.ops, src.full.width) : src.full;
      const trimmed = trimTransparent(edited);
      if (!trimmed) { toast('La imagen quedó vacía: no hay nada para recortar.'); return; }
      if (trimmed.width === edited.width && trimmed.height === edited.height) { toast('La imagen no tiene márgenes transparentes.'); return; }
      const keepW = s.widthCm * trimmed.width / edited.width;   // mantiene la escala de impresión
      const id = registerImage(trimmed, src.name);
      pushHistory();
      state.sourceId = id;
      s.ops = [];
      s.widthCm = Math.round(keepW * 100) / 100;
      afterStateChange();
      toast('Márgenes recortados.');
    } finally {
      setBusy(false);
    }
  }
  function resetOps(tool) {
    const s = settingsOf(state.tool);
    if (!s.ops.some((o) => o.tool === tool)) return;
    pushHistory();
    s.ops = s.ops.filter((o) => o.tool !== tool);
    afterStateChange();
  }

  function halftoneSizeInfo() {
    const src = source();
    const s = settingsOf('semitono');
    if (!src) return 'El alto se calcula según la imagen.';
    const hcm = s.widthCm * src.full.height / src.full.width;
    return `Medida final: <b>${fmtCm(s.widthCm)} × ${fmtCm(hcm)}</b> (${cmToPx(s.widthCm)} × ${cmToPx(hcm)} px).`;
  }
  function semiInfo() {
    const st = state.cache.semiStats;
    if (!st || !st.visible) return 'Las zonas semitransparentes se marcan en rosa si activás “Resaltar”.';
    const pct = st.semi / st.visible * 100;
    return pct < 0.05
      ? '✓ La imagen original no tiene semitransparencias.'
      : `La original tiene <b>${pct.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%</b> de píxeles semitransparentes.`;
  }
  function aiNote(s) {
    if (aiMaskFor()) return '✓ Fondo quitado. Podés suavizar el borde, retocar a mano o descargar.';
    const mb = s.aiQuality === 'high' ? 80 : 40;
    return `La primera vez se descarga el modelo de IA (unos ${mb} MB) y queda guardado en el navegador. Todo se procesa en tu dispositivo: la imagen no se sube a ningún servidor.`;
  }

  /* --- Ayudantes de "Eliminar fondo" --- */
  function aiMaskFor() {
    const m = state.cache.bgMask;
    return m && m.sourceId === state.sourceId ? m : null;
  }
  let colorMaskMemo = { src: null, key: '', mask: null };
  function bgBaseMask(src, s) {
    if (s.method === 'color') {
      // Se recuerda la última máscara para no recalcularla en cada trazo del pincel
      const key = `${s.tolerance}|${s.contiguous}|${s.bgColor}`;
      if (colorMaskMemo.src !== src || colorMaskMemo.key !== key) colorMaskMemo = { src, key, mask: colorBackgroundMask(src, s) };
      return colorMaskMemo.mask;
    }
    const m = aiMaskFor();
    return m ? m.canvas : null;
  }
  function opaqueMask(src) {
    const m = createCanvas(src.width, src.height);
    const c = m.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, m.width, m.height);
    return m;
  }
  /* Capa de retoque a mano (rojo = restaurar, verde = borrar), una por imagen */
  function touchFor() {
    const t = state.cache.bgTouch;
    return t && t.sourceId === state.sourceId ? t : null;
  }
  function ensureTouch() {
    let t = touchFor();
    if (!t) {
      const src = source().full;
      const k = Math.min(1, 2000 / Math.max(src.width, src.height));
      t = { sourceId: state.sourceId, canvas: createCanvas(src.width * k, src.height * k), history: [] };
      state.cache.bgTouch = t;
    }
    return t;
  }
  function undoTouchStroke() {
    const t = touchFor();
    if (!t || !t.history.length) return;
    const prev = t.history.pop();
    const c = t.canvas.getContext('2d');
    c.clearRect(0, 0, t.canvas.width, t.canvas.height);
    c.drawImage(prev, 0, 0);
    renderPanelContent();
    renderHeading();
    schedulePreview(true);
  }
  function clearTouch() {
    delete state.cache.bgTouch;
    renderPanelContent();
    renderHeading();
    schedulePreview(true);
    toast('Se borraron los retoques.');
  }

  /* --- Fábrica de las herramientas de mejora (foto e ilustración) --- */
  const ENGINE_LABELS = { ai: 'IA', 'ai-max': 'IA máxima', fast: 'Rápido' };
  function enhanceTool(id, cfg) {
    const strengthAI = 0.6;   // la IA ya entrega nitidez: la terminación se suaviza
    return {
      title: cfg.title,
      ai: true,
      desc: cfg.desc,
      compare: true,
      defaults: cfg.defaults,
      panels: [{
        id: 'enhance', label: cfg.panelLabel, icon: 'crop',
        controls: [
          { type: 'segmented', key: 'engine', label: 'Motor', options: [['ai', 'IA'], ['ai-max', 'IA máxima'], ['fast', 'Rápido']] },
          { type: 'segmented', key: 'scale', label: 'Ampliación', options: [[2, '2×'], [4, '4×']] },
          { type: 'button', label: '✦ Mejorar con IA', primary: true, when: (s) => s.engine !== 'fast', action: () => runEnhanceAI() },
          { type: 'note', text: (s) => aiEnhanceNote(s) },
          ...cfg.finishing,
          { type: 'note', text: () => outputInfo() },
        ],
      }],
      quality: (s) => [s.scale + '×', `${cfg.kind} · ${ENGINE_LABELS[s.engine]}`],
      live: (src, s) => {
        const r = s.engine !== 'fast' ? aiEnhanceResult(s) : null;
        if (r) return finishImage(cloneCanvas(r.preview), s, cfg.illustration, Math.max(1, r.preview.width / 2400), strengthAI);
        return enhanceImage(fitInside(src, 2400 / s.scale), s, cfg.illustration);
      },
      full: (src, s) => {
        if (s.engine === 'fast') return enhanceImage(src, { ...s, scale: enhanceLimit(src, s.scale) }, cfg.illustration);
        const r = aiEnhanceResult(s);
        if (!r) throw new Error('Primero tocá “Mejorar con IA”.');
        return finishImage(cloneCanvas(r.canvas), s, cfg.illustration, Math.max(1, r.canvas.width / 2400), strengthAI);
      },
      ready: (s) => s.engine === 'fast' || !!aiEnhanceResult(s),
      notReady: 'La vista previa muestra el método rápido. Tocá “Mejorar con IA” para el resultado final.',
      primaryAction: () => ({ label: '✦ Mejorar con IA', run: runEnhanceAI }),
      downloadLabel: (s) => `↓ Descargar ${cfg.downloadNoun} ${s.scale}×`,
      note: () => 'La descarga se guarda en PNG a 300 DPI.',
      next: cfg.next,
    };
  }

  function aiEnhanceResult(s) {
    const r = state.cache.enhance;
    return r && r.sourceId === state.sourceId && r.scale === s.scale && r.engine === s.engine ? r : null;
  }
  function aiEnhanceNote(s) {
    if (s.engine === 'fast') return 'Método rápido sin IA: amplía y enfoca al instante. Ideal para celulares lentos.';
    if (aiEnhanceResult(s)) return `✓ Imagen mejorada con ${ENGINE_LABELS[s.engine]}. Usá el comparador para ver el antes y después.`;
    return s.engine === 'ai-max'
      ? 'IA máxima: la mejor calidad. Descarga unos 28 MB la primera vez y puede tardar varios minutos en el celular.'
      : 'IA estándar: buena calidad y velocidad. Tarda entre 10 segundos y un minuto según la imagen y el equipo. Todo se procesa en tu dispositivo.';
  }

  /* --- Carga de scripts bajo demanda --- */
  const loadedScripts = new Map();
  function loadScript(src) {
    if (!loadedScripts.has(src)) {
      loadedScripts.set(src, new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = resolve;
        el.onerror = () => { loadedScripts.delete(src); reject(new Error('No se pudo cargar ' + src)); };
        document.head.appendChild(el);
      }));
    }
    return loadedScripts.get(src);
  }

  /* --- IA de ampliación (ESRGAN con TensorFlow.js, todo en el navegador) ---
     Los modelos "IA" vienen dentro del proyecto (carpeta vendor); "IA máxima"
     se descarga de jsDelivr solo si se elige. */
  const THICK_CDN = 'https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-thick@1.0.0';
  const AI_MODELS = {
    ai: {
      2: { global: 'ESRGANMedium2x', script: 'vendor/upscaler/esrgan-medium-x2.min.js', path: 'vendor/models/esrgan-medium/x2/model.json' },
      4: { global: 'ESRGANMedium4x', script: 'vendor/upscaler/esrgan-medium-x4.min.js', path: 'vendor/models/esrgan-medium/x4/model.json' },
    },
    'ai-max': {
      2: { global: 'ESRGANThick2x', script: `${THICK_CDN}/dist/umd/models/esrgan-thick/src/x2/index.min.js`, path: `${THICK_CDN}/models/x2/model.json` },
      4: { global: 'ESRGANThick4x', script: `${THICK_CDN}/dist/umd/models/esrgan-thick/src/x4/index.min.js`, path: `${THICK_CDN}/models/x4/model.json` },
    },
  };
  const upscalers = new Map();
  let aiAbort = null;

  async function runEnhanceAI() {
    const src = source();
    if (!src) { toast('Primero subí una imagen.'); return; }
    const s = settingsOf(state.tool);
    const engine = s.engine === 'fast' ? 'ai' : s.engine;
    const def = AI_MODELS[engine][s.scale];
    aiAbort = new AbortController();
    setBusy(true, 'Cargando IA…', () => aiAbort && aiAbort.abort());
    try {
      await loadScript('vendor/tf.min.js');
      await loadScript('vendor/upscaler/default-model.min.js');
      await loadScript('vendor/upscaler/upscaler.min.js');
      await loadScript(def.script);
      const key = `${engine}-${s.scale}`;
      if (!upscalers.has(key)) {
        let path = def.path;
        // Abierta con doble clic (file://) el navegador no deja leer el modelo suelto:
        // se usa la copia incrustada en un script y se carga desde la memoria.
        if (location.protocol === 'file:') {
          if (engine !== 'ai') throw new Error('offline-max');
          setBusy(true, 'Cargando IA…', () => aiAbort && aiAbort.abort());
          await loadScript(`vendor/models/esrgan-medium/x${s.scale}/model-embed.js`);
          const emb = window.TE_AI_MODELS[`x${s.scale}`];
          const bin = atob(emb.bin);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          path = window.tf.io.fromMemory({
            modelTopology: emb.json.modelTopology,
            weightSpecs: emb.json.weightsManifest.flatMap((g) => g.weights),
            weightData: bytes.buffer,
            format: emb.json.format,
          });
        }
        upscalers.set(key, new window.Upscaler({ model: { ...window[def.global], path } }));
      }
      const upscaler = upscalers.get(key);

      // Tamaño de entrada: limita el tiempo y la memoria (más chico en celulares)
      let maxIn = IS_IOS ? 900000 : 3000000;
      if (engine === 'ai-max') maxIn /= 2.5;
      maxIn = Math.min(maxIn, MAX_CANVAS_AREA * 0.8 / (s.scale * s.scale));
      let input = src.full;
      if (input.width * input.height > maxIn) {
        const k = Math.sqrt(maxIn / (input.width * input.height));
        input = resizeCanvas(input, input.width * k, input.height * k);
      }
      const transparent = hasTransparency(input);
      const prepared = transparent ? bleedColors(input) : input;

      setBusy(true, 'Mejorando con IA… 0%', () => aiAbort && aiAbort.abort());
      const tf = window.tf;
      const pixels = tf.browser.fromPixels(prepared);
      let outTensor;
      try {
        outTensor = await upscaler.upscale(pixels, {
          output: 'tensor',
          patchSize: 64,
          padding: 6,
          signal: aiAbort.signal,
          progress: (pct) => setBusy(true, `Mejorando con IA… ${Math.round(pct * 100)}%`, () => aiAbort && aiAbort.abort()),
        });
      } finally {
        pixels.dispose();
      }
      const out = createCanvas(outTensor.shape[1], outTensor.shape[0]);
      const ints = tf.tidy(() => outTensor.clipByValue(0, 255).round().cast('int32'));
      await tf.browser.toPixels(ints, out);
      ints.dispose();
      outTensor.dispose();

      // Devuelve la transparencia original, ampliada con suavizado
      if (transparent) {
        const alphaSrc = ctx2d(resizeCanvas(input, out.width, out.height)).getImageData(0, 0, out.width, out.height).data;
        const oc = ctx2d(out);
        const od = oc.getImageData(0, 0, out.width, out.height);
        for (let i = 3; i < od.data.length; i += 4) od.data[i] = alphaSrc[i];
        oc.putImageData(od, 0, 0);
      }
      pushHistory();
      state.cache.enhance = { sourceId: state.sourceId, scale: s.scale, engine, canvas: out, preview: fitInside(out, 2400) };
      if (s.engine === 'fast') s.engine = engine;
      state.compare = true;
      afterStateChange();
      toast(input === src.full ? 'Listo: imagen mejorada con IA.' : 'Listo. La imagen era grande y se procesó a menor tamaño para que no tarde demasiado.');
    } catch (err) {
      if (aiAbort && aiAbort.signal.aborted) {
        toast('Se canceló la mejora con IA.');
      } else {
        console.warn('IA de ampliación no disponible:', err);
        toast(engine === 'ai-max'
          ? (location.protocol === 'file:' ? 'La IA máxima funciona con la web publicada. Abierta desde el archivo, usá “IA”.' : 'No se pudo cargar la IA máxima (revisá tu conexión). Probá con “IA”.')
          : 'No se pudo usar la IA en este dispositivo. Probá con el motor “Rápido”.');
      }
    } finally {
      aiAbort = null;
      setBusy(false);
    }
  }

  /* --- IA para quitar fondos (se carga solo cuando se usa) --- */
  let bgLib = null;
  async function runBackgroundAI() {
    const src = source();
    if (!src) { toast('Primero subí una imagen.'); return; }
    setBusy(true, 'Cargando IA…');
    try {
      if (!bgLib) bgLib = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
      const remove = bgLib.removeBackground || bgLib.default;
      // Se procesa una copia de hasta 2048 px (el modelo trabaja a menor resolución igualmente)
      const work = fitInside(src.full, 2048);
      const blob = await canvasToBlob(work);
      const result = await remove(blob, {
        model: settingsOf('eliminar-fondo').aiQuality === 'high' ? 'isnet_fp16' : 'isnet_quint8',
        output: { format: 'image/png', type: 'mask' },
        progress: (key, current, total) => {
          if (total) setBusy(true, `Descargando IA… ${Math.round(current / total * 100)}%`);
        },
      });
      setBusy(true, 'Quitando fondo…');
      const maskImg = await blobToCanvas(result);
      // La máscara puede venir en escala de grises: se pasa a canal alfa
      const mc = ctx2d(maskImg);
      const md = mc.getImageData(0, 0, maskImg.width, maskImg.height);
      for (let i = 0; i < md.data.length; i += 4) {
        const v = md.data[i + 3] < 255 ? md.data[i + 3] : md.data[i];
        md.data[i] = md.data[i + 1] = md.data[i + 2] = 255;
        md.data[i + 3] = v;
      }
      mc.putImageData(md, 0, 0);
      pushHistory();
      state.cache.bgMask = { sourceId: state.sourceId, canvas: maskImg };
      afterStateChange();
      toast('Listo: fondo quitado.');
    } catch (err) {
      console.warn('IA de fondo no disponible:', err);
      toast('No se pudo usar la IA (revisá tu conexión). Te paso al método “Por color”.');
      setSetting('method', 'color');
    } finally {
      setBusy(false);
    }
  }

  /* =========================================================
     6. EDITOR DE COMPOSICIONES (Diseño, Mockup, Lienzo)
     Elementos posicionados en píxeles del documento, con
     selección, arrastre, escala (esquina) y rotación (asa).
     ========================================================= */
  const DESIGN_PRESETS = {
    feed: { label: 'Feed vertical', w: 1080, h: 1350 },
    post: { label: 'Feed cuadrado', w: 1080, h: 1080 },
    story: { label: 'Historia', w: 1080, h: 1920 },
    a4: { label: 'Estampa A4 (300 ppp)', w: 2480, h: 3508 },
    pecho: { label: 'Logo de pecho 10 cm', w: 1181, h: 1181 },
  };
  const MAX_DESIGNS = 20;
  function newDesign(n) {
    return { name: `Diseño ${n}`, preset: 'feed', w: 1080, h: 1350, bg: '#f4f1ec', transparent: false, items: [], selected: null };
  }
  /* El diseño activo (compose.diseno) es siempre el mismo objeto que designs[designIndex] */
  function syncDesignRef() {
    const c = state.compose;
    if (!c.designs || !c.designs.length) c.designs = [c.diseno || newDesign(1)];
    c.designIndex = clamp(c.designIndex || 0, 0, c.designs.length - 1);
    c.diseno = c.designs[c.designIndex];
  }
  /* Todos los documentos (para buscar imágenes en uso) */
  function composeDocs(c) {
    if (!c) return [];
    return [c.mockup, c.lienzo, ...(c.designs || [c.diseno])].filter(Boolean);
  }
  const FONTS = [
    ['Inter, Arial, sans-serif', 'Moderna'],
    ['Anton, Impact, sans-serif', 'Anton'],
    ['"Bebas Neue", Impact, sans-serif', 'Bebas Neue'],
    ['Oswald, "Arial Narrow", sans-serif', 'Oswald'],
    ['Montserrat, Arial, sans-serif', 'Montserrat'],
    ['"Playfair Display", Georgia, serif', 'Playfair'],
    ['Pacifico, cursive', 'Pacifico'],
    ['Lobster, cursive', 'Lobster'],
    ['"Permanent Marker", cursive', 'Marcador'],
    ['"Special Elite", "Courier New", monospace', 'Máquina'],
  ];
  let fontsLoaded = false;
  function loadDesignFonts() {
    if (fontsLoaded) return;
    fontsLoaded = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Lobster&family=Montserrat:wght@400;800&family=Oswald:wght@400;700&family=Pacifico&family=Permanent+Marker&family=Playfair+Display:wght@400;700&family=Special+Elite&display=swap';
    link.onload = () => document.fonts.ready.then(() => schedulePreview());
    document.head.appendChild(link);
  }

  function newComposeState() {
    const first = newDesign(1);
    return {
      diseno: first,
      designs: [first],
      designIndex: 0,
      showPages: true,
      designFormat: 'png',
      designScope: 'one',
      mockup: { base: 'shirt', template: 'flat', view: 'front', shirtColor: '#9ea3ab', fusion: 'keep', format: 'jpg', photoId: null, w: MOCK_SIZE, h: MOCK_SIZE, items: [], selected: null },
      lienzo: { widthCm: 57, heightCm: 200, unit: 'cm', gapMm: 4, items: [], selected: [], multi: false },
    };
  }
  function hasComposeContent() {
    const c = state.compose;
    return !!(c && (c.diseno.items.length || c.mockup.items.length || c.lienzo.items.length));
  }

  function makeImageItem(doc, imgId, maxFrac = 0.7) {
    const img = images.get(imgId);
    const k = Math.min(doc.w * maxFrac / img.full.width, doc.h * maxFrac / img.full.height);
    return { id: uid(), type: 'image', imgId, x: doc.w / 2, y: doc.h / 2, w: img.full.width * k, h: img.full.height * k, rot: 0, opacity: 100 };
  }

  /* --- Dibujo de elementos --- */
  function itemSize(ctx, it) {
    if (it.type !== 'text') return [it.w, it.h];
    ctx.font = `${it.bold ? 800 : 400} ${it.size}px ${it.font}`;
    const lines = it.text.split('\n');
    const w = Math.max(...lines.map((l) => ctx.measureText(l || ' ').width));
    return [w + it.size * 0.2, lines.length * it.size * 1.15];
  }

  function drawItem(ctx, it, k, usePreview) {
    ctx.save();
    ctx.translate(it.x * k, it.y * k);
    ctx.rotate(it.rot * Math.PI / 180);
    ctx.globalAlpha = (it.opacity ?? 100) / 100;
    if (it.blend) ctx.globalCompositeOperation = it.blend;
    if (it.type === 'image') {
      const img = images.get(it.imgId);
      if (img) ctx.drawImage(usePreview ? img.preview : img.full, -it.w * k / 2, -it.h * k / 2, it.w * k, it.h * k);
    } else if (it.type === 'shirt') {
      // Remera de ejemplo de las plantillas (se puede reemplazar por una imagen)
      const px = it.w * k;
      ctx.drawImage(designShirt(it.color, px, it.view), -it.w * k / 2, -it.h * k / 2, it.w * k, it.h * k);
    } else if (['rect', 'ellipse', 'triangle', 'star', 'line', 'round'].includes(it.type)) {
      const w = it.w * k, h = it.h * k;
      ctx.fillStyle = it.color;
      ctx.beginPath();
      if (it.type === 'rect' || it.type === 'line') ctx.rect(-w / 2, -h / 2, w, h);
      else if (it.type === 'round') { const r = Math.min(w, h) * 0.22; ctx.roundRect ? ctx.roundRect(-w / 2, -h / 2, w, h, r) : ctx.rect(-w / 2, -h / 2, w, h); }
      else if (it.type === 'ellipse') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      else if (it.type === 'triangle') { ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); }
      else {
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 0.42 : 1;
          const a = -Math.PI / 2 + i * Math.PI / 5;
          ctx.lineTo(Math.cos(a) * w / 2 * r, Math.sin(a) * h / 2 * r);
        }
        ctx.closePath();
      }
      ctx.fill();
    } else if (it.type === 'text') {
      ctx.font = `${it.bold ? 800 : 400} ${it.size * k}px ${it.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = it.text.split('\n');
      const lh = it.size * 1.15 * k;
      lines.forEach((line, i) => {
        const y = (i - (lines.length - 1) / 2) * lh;
        if (it.strokeWidth > 0) {
          ctx.lineJoin = 'round';
          ctx.strokeStyle = it.strokeColor;
          ctx.lineWidth = it.strokeWidth * 2 * k;
          ctx.strokeText(line, 0, y);
        }
        ctx.fillStyle = it.color;
        ctx.fillText(line, 0, y);
      });
    }
    ctx.restore();
  }

  /* Guías del medio (aparecen mientras se arrastra y el elemento queda centrado) */
  function drawCenterGuides(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = '#e5157a';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    if (drag.guideX) { ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); }
    if (drag.guideY) { ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); }
    ctx.stroke();
    ctx.restore();
  }

  /* Marco de selección con asas (solo en la vista previa) */
  const HANDLE = 11;
  function drawSelection(ctx, it, k) {
    const [w, h] = itemSize(ctx, it);
    ctx.save();
    ctx.translate(it.x * k, it.y * k);
    ctx.rotate(it.rot * Math.PI / 180);
    ctx.strokeStyle = '#0d4fa3';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(-w * k / 2, -h * k / 2, w * k, h * k);
    ctx.setLineDash([]);
    // Asa de escala (esquina inferior derecha) y de rotación (arriba)
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(w * k / 2, h * k / 2, HANDLE, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -h * k / 2);
    ctx.lineTo(0, -h * k / 2 - 30);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -h * k / 2 - 30, HANDLE, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0d4fa3';
    ctx.font = 'bold 14px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↻', 0, -h * k / 2 - 30);
    ctx.restore();
  }

  /* --- Fondo de Diseño --- */
  function drawDesign(target, k, preview, d = state.compose.diseno, noBg = false) {
    const c = target.getContext('2d');
    if (!d.transparent && !noBg) { c.fillStyle = d.bg; c.fillRect(0, 0, target.width, target.height); }
    d.items.forEach((it) => drawItem(c, it, k, preview));
  }

  /* --- Remera para el mockup ---
     La remera se dibuja en su propio espacio (1200 × 1240) y se ubica centrada
     en el documento cuadrado de 1254 × 1254 px. Se arma en capas: color, cuello,
     sombras, luces y textura de tela. Hay dos modelos (suelta y en percha) y dos
     vistas (frente y espalda). */
  const MOCK_SIZE = 1254;
  const SHIRT_PATHS = {
    flat: 'M485 150C520 228 680 228 715 150C790 175 860 195 925 215C990 290 1060 390 1110 500L965 585C945 550 920 525 900 505C895 680 925 900 922 1110Q600 1145 278 1110C275 900 305 680 300 505C280 525 255 550 235 585L90 500C140 390 210 290 275 215C340 195 410 175 485 150Z',
    hanger: 'M485 150C520 228 680 228 715 150C790 175 860 195 925 215C985 300 1035 400 1060 520L935 590C920 560 910 530 900 505C895 680 925 900 922 1110Q600 1145 278 1110C275 900 305 680 300 505C290 530 280 560 265 590L140 520C165 400 215 300 275 215C340 195 410 175 485 150Z',
  };
  const FRONT_NECK = 'C520 228 680 228 715 150';
  const BACK_NECK = 'C530 182 670 182 715 150';
  const NECK_OPENING = 'M485 150C530 182 670 182 715 150C680 228 520 228 485 150Z';
  const MOCK_TEMPLATES = {
    flat: { label: 'Remera suelta', sub: 'Piso · Frente y espalda', sc: 0.84, dy: 0 },
    hanger: { label: 'Remera en percha', sub: 'Percha · Frente y espalda', sc: 0.76, dy: 62 },
    // Modelos de foto: la remera se tiñe conservando la tela real (máscara = zona de la remera)
    model: {
      label: 'Remera puesta', sub: 'Modelo · Frente', frontOnly: true,
      photo: 'img/mockups/modelo.jpg', mask: 'img/mockups/modelo-mask.png', script: 'img/mockups/modelo.js',
      size: 1024, area: { x: 512, y: 440, w: 300, h: 360 },
    },
  };
  /* Fotos reales de Tu Estampa SF (6 colores, frente y espalda).
     Los colores no se tiñen: se usa la foto del color elegido. */
  MOCK_TEMPLATES['foto-percha'] = { label: 'Tu Estampa · En percha', sub: 'Foto real · Frente y espalda', real: 'percha' };
  MOCK_TEMPLATES['foto-modelo'] = { label: 'Tu Estampa · Puesta', sub: 'Foto real · Frente y espalda', real: 'modelo' };
  const REAL_COLORS = [
    ['#f4f2ee', 'Blanca', 'blanca'], ['#1d1d1f', 'Negra', 'negra'], ['#1b2a6e', 'Azul marino', 'azul-marino'],
    ['#9ea3ab', 'Gris melange', 'gris-melange'], ['#e8d9bf', 'Beige', 'beige'], ['#1f4d3a', 'Verde inglés', 'verde-ingles'],
  ];
  /* Zona de estampa calibrada en cada foto (640 × 640): centro y píxeles por cm */
  const REAL_CAL = {
    'percha-front': { cx: 311, cy: 344, k: 6.0, w: 30, h: 38 },
    'percha-back': { cx: 314, cy: 340, k: 6.3, w: 32, h: 42 },
    'modelo-front': { cx: 322, cy: 403, k: 4.7, w: 30, h: 38 },
    'modelo-back': { cx: 308, cy: 480, k: 4.5, w: 32, h: 42 },
  };
  const isRealTemplate = (tpl) => !!(MOCK_TEMPLATES[tpl] && MOCK_TEMPLATES[tpl].real);
  const isPhotoTemplate = (tpl) => !!(MOCK_TEMPLATES[tpl] && MOCK_TEMPLATES[tpl].photo);
  /* Color de foto más parecido al elegido */
  function nearestReal(hex) {
    const a = hexToRgb(hex);
    let best = REAL_COLORS[0], bd = Infinity;
    REAL_COLORS.forEach((c) => { const b = hexToRgb(c[0]); const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < bd) { bd = d; best = c; } });
    return best;
  }
  /* Carga de la foto y su mapa de pliegues. Con doble clic (file://) las fotos
     se leen de un script con las imágenes incrustadas, como el resto de los mockups. */
  const realPhotos = new Map();
  function loadRealPhoto(tpl, view, hex) {
    const kind = MOCK_TEMPLATES[tpl].real;
    const col = nearestReal(hex)[2];
    const side = view === 'back' ? 'espalda' : 'frente';
    const key = `${col}-${kind}-${side}`;
    if (realPhotos.has(key)) return realPhotos.get(key);
    const entry = { status: 'loading' };
    realPhotos.set(key, entry);
    const srcP = location.protocol === 'file:'
      ? loadScript('img/mockups/fotos.js').then(() => (window.TE_FOTOS || {})[key])
      : Promise.resolve(`img/mockups/fotos/${key}.jpg`);
    srcP.then((src) => new Promise((res, rej) => { if (!src) { rej(new Error('Sin foto')); return; } const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }))
      .then((img) => {
        const S = MOCK_SIZE;
        const photo = createCanvas(S, S);
        photo.getContext('2d').drawImage(img, 0, 0, S, S);
        // Pliegues: luminancia relativa al tono medio de la zona de estampa
        const cal = REAL_CAL[`${kind}-${view === 'back' ? 'back' : 'front'}`];
        const f = S / 640;
        const shade = createCanvas(S, S);
        const sc = ctx2d(shade);
        sc.drawImage(photo, 0, 0);
        const id = sc.getImageData(0, 0, S, S);
        const d = id.data;
        const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        let sum = 0, n = 0;
        const r = cal.k * 8 * f;
        for (let y = cal.cy * f - r; y < cal.cy * f + r; y += 3) for (let x = cal.cx * f - r; x < cal.cx * f + r; x += 3) { sum += lum((Math.round(y) * S + Math.round(x)) * 4); n++; }
        const mean = Math.max(8, sum / n);
        for (let i = 0; i < d.length; i += 4) {
          const v = Math.min(1, Math.max(0.6, 0.55 + 0.45 * (lum(i) / mean))) * 255;
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        sc.putImageData(id, 0, 0);
        Object.assign(entry, { status: 'ready', photo, shade });
        schedulePreview(true);
        if (state.tool === 'mockup') renderPanelContent();
      })
      .catch(() => { entry.status = 'error'; });
    return entry;
  }

  /* --- Modelos de foto: carga y teñido --- */
  const photoTemplates = new Map();   // tpl → { status, photo, mask, lum, ref, shadow, light }
  function loadPhotoTemplate(tpl) {
    if (photoTemplates.has(tpl)) return photoTemplates.get(tpl);
    const t = MOCK_TEMPLATES[tpl];
    const entry = { status: 'loading' };
    photoTemplates.set(tpl, entry);
    const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    // Las imágenes vienen incrustadas en un script: así se pueden leer también
    // abriendo la web con doble clic (sin servidor, el navegador bloquea leer archivos sueltos).
    loadScript(t.script).then(() => {
      const data = (window.TE_MOCKUPS || {})[tpl];
      if (!data) throw new Error('Mockup no disponible');
      return Promise.all([loadImg(data.photo), loadImg(data.mask)]);
    }).then(([ph, mk]) => {
      const S = MOCK_SIZE;
      const photo = createCanvas(S, S);
      photo.getContext('2d').drawImage(ph, 0, 0, S, S);
      const mask = createCanvas(S, S);
      mask.getContext('2d').drawImage(mk, 0, 0, S, S);
      const pd = ctx2d(photo).getImageData(0, 0, S, S).data;
      const md = ctx2d(mask).getImageData(0, 0, S, S).data;
      // Luminancia de la tela y su valor típico (referencia del "blanco" de la remera)
      const lum = new Float32Array(S * S);
      const vals = [];
      for (let p = 0; p < S * S; p++) {
        lum[p] = (0.299 * pd[p * 4] + 0.587 * pd[p * 4 + 1] + 0.114 * pd[p * 4 + 2]) / 255;
        if (md[p * 4 + 3] > 200 && p % 7 === 0) vals.push(lum[p]);
      }
      vals.sort((x, y) => x - y);
      const ref = vals[Math.floor(vals.length * 0.6)] || 0.9;
      // Capas de sombra y luz de la tela, para que la estampa siga los pliegues reales
      const shadow = createCanvas(S, S), light = createCanvas(S, S);
      const sc = shadow.getContext('2d'), lc = light.getContext('2d');
      const sd = sc.createImageData(S, S), ld = lc.createImageData(S, S);
      for (let p = 0; p < S * S; p++) {
        const m = md[p * 4 + 3] / 255;
        const r = lum[p] / ref;
        sd.data[p * 4 + 3] = clamp((1 - r) * 2.4, 0, 1) * 255 * m;
        ld.data[p * 4] = ld.data[p * 4 + 1] = ld.data[p * 4 + 2] = 255;
        ld.data[p * 4 + 3] = clamp((r - 1) * 4, 0, 1) * 255 * m;
      }
      sc.putImageData(sd, 0, 0);
      lc.putImageData(ld, 0, 0);
      Object.assign(entry, { status: 'ready', photo, mask, lum, ref, shadow, light });
      shirtCache.key = '';
      schedulePreview(true);
      if (state.openPanel === 'mock-base') renderPanelContent();
    }).catch(() => {
      entry.status = 'error';
      toast('No se pudo cargar la foto del modelo.');
    });
    return entry;
  }

  /* Tiñe la remera de la foto: conserva sombras, luces y textura reales */
  function renderPhotoShirt(k, color, tpl) {
    const e = loadPhotoTemplate(tpl);
    if (e.status !== 'ready') return null;
    const W = Math.round(MOCK_SIZE * k);
    const out = createCanvas(W, W);
    const c = ctx2d(out);
    c.drawImage(e.photo, 0, 0, W, W);
    const img = c.getImageData(0, 0, W, W);
    const d = img.data;
    const mk = ctx2d(resizeCanvas(e.mask, W, W)).getImageData(0, 0, W, W).data;
    const [cr, cg, cb] = hexToRgb(color).map((v) => v / 255);
    const lc = 0.299 * cr + 0.587 * cg + 0.114 * cb;
    const step = MOCK_SIZE / W;
    for (let y = 0; y < W; y++) {
      const sy = Math.min(MOCK_SIZE - 1, Math.floor(y * step)) * MOCK_SIZE;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const m = mk[i + 3] / 255;
        if (m <= 0) continue;
        const r = e.lum[sy + Math.min(MOCK_SIZE - 1, Math.floor(x * step))] / e.ref;
        // Sombras: multiplican el color. Luces: lo aclaran hacia blanco.
        // En colores oscuros se refuerza el relieve para que no quede plano.
        const detail = (r - 1) * 0.45 * (1 - lc);
        const tint = (v) => {
          let o = r < 1 ? v * r : v + (1 - v) * (r - 1) * 1.6;
          return clamp(o + detail, 0, 1) * 255;
        };
        d[i] = d[i] + (tint(cr) - d[i]) * m;
        d[i + 1] = d[i + 1] + (tint(cg) - d[i + 1]) * m;
        d[i + 2] = d[i + 2] + (tint(cb) - d[i + 2]) * m;
      }
    }
    c.putImageData(img, 0, 0);
    return out;
  }
  const DOC_W = 1200, DOC_H = 1240;

  function shirtPath(tpl, view) {
    const d = SHIRT_PATHS[tpl];
    return view === 'back' ? d.replace(FRONT_NECK, BACK_NECK) : d;
  }
  /* Ubicación de la remera dentro del documento */
  function shirtTransform(tpl) {
    const t = MOCK_TEMPLATES[tpl];
    return { sc: t.sc, tx: MOCK_SIZE / 2 - 600 * t.sc, ty: MOCK_SIZE / 2 - 647 * t.sc + t.dy };
  }

  function mixHex(hex, withHex, t) {
    const a = hexToRgb(hex), b = hexToRgb(withHex);
    return rgbToHex(...a.map((v, i) => Math.round(v + (b[i] - v) * t)));
  }

  /* Trazo difuminado compatible con todos los navegadores
     (dibuja fuera del lienzo y trae solo la sombra borrosa). */
  function softStroke(c, d, width, color, blur) {
    c.save();
    c.shadowColor = color;
    c.shadowBlur = blur;
    c.shadowOffsetX = 10000;
    c.translate(-10000, 0);
    c.lineWidth = width;
    c.lineCap = 'round';
    c.strokeStyle = '#000';
    c.stroke(new Path2D(d));
    c.restore();
  }

  /* Capas de sombra, luz y textura (una por modelo y vista, se generan una sola vez) */
  const fabricCache = new Map();
  function getFabricLayers(tpl, view) {
    const key = `${tpl}|${view}`;
    if (fabricCache.has(key)) return fabricCache.get(key);
    const hanger = tpl === 'hanger';
    const back = view === 'back';
    const shadow = createCanvas(DOC_W, DOC_H);
    const sc = shadow.getContext('2d');
    // Laterales más oscuros (volumen del torso)
    const side = sc.createLinearGradient(278, 0, 922, 0);
    side.addColorStop(0, 'rgba(0,0,0,.18)');
    side.addColorStop(0.2, 'rgba(0,0,0,0)');
    side.addColorStop(0.8, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,.18)');
    sc.fillStyle = side;
    sc.fillRect(0, 0, DOC_W, DOC_H);
    // Mangas: parte de abajo y costuras de sisa
    const sleeveL = hanger ? 'M150 530L262 592' : 'M100 510L240 590';
    const sleeveR = hanger ? 'M1050 530L938 592' : 'M1100 510L960 590';
    softStroke(sc, sleeveL, 46, 'rgba(0,0,0,.30)', 34);
    softStroke(sc, sleeveR, 46, 'rgba(0,0,0,.30)', 34);
    softStroke(sc, 'M275 215C290 330 300 430 300 505', 30, 'rgba(0,0,0,.16)', 26);
    softStroke(sc, 'M925 215C910 330 900 430 900 505', 30, 'rgba(0,0,0,.16)', 26);
    softStroke(sc, 'M275 215C290 330 300 430 300 505', 5, 'rgba(0,0,0,.35)', 4);
    softStroke(sc, 'M925 215C910 330 900 430 900 505', 5, 'rgba(0,0,0,.35)', 4);
    softStroke(sc, 'M485 150L275 215', 4, 'rgba(0,0,0,.22)', 3);
    softStroke(sc, 'M715 150L925 215', 4, 'rgba(0,0,0,.22)', 3);
    // Sombra debajo del cuello
    softStroke(sc, back ? 'M505 205Q600 235 695 205' : 'M500 240Q600 300 700 240', 34, 'rgba(0,0,0,.10)', 26);
    // Pliegues (en percha, más verticales)
    if (hanger) {
      softStroke(sc, 'M330 560Q360 760 345 980', 26, 'rgba(0,0,0,.13)', 30);
      softStroke(sc, 'M870 560Q840 760 855 980', 26, 'rgba(0,0,0,.13)', 30);
      softStroke(sc, 'M470 700Q480 880 460 1080', 18, 'rgba(0,0,0,.07)', 26);
      softStroke(sc, 'M735 690Q725 880 745 1080', 18, 'rgba(0,0,0,.07)', 26);
    } else {
      softStroke(sc, 'M315 560Q420 700 470 870', 28, 'rgba(0,0,0,.16)', 30);
      softStroke(sc, 'M885 560Q780 700 730 870', 28, 'rgba(0,0,0,.16)', 30);
      softStroke(sc, 'M330 740Q370 850 350 960', 22, 'rgba(0,0,0,.10)', 26);
      softStroke(sc, 'M870 750Q830 860 850 970', 22, 'rgba(0,0,0,.10)', 26);
    }
    softStroke(sc, 'M420 980Q470 1050 450 1115', 22, 'rgba(0,0,0,.12)', 22);
    softStroke(sc, 'M760 970Q720 1040 760 1115', 22, 'rgba(0,0,0,.12)', 22);
    softStroke(sc, 'M590 1010Q612 1065 600 1125', 18, 'rgba(0,0,0,.08)', 20);
    softStroke(sc, 'M280 1092Q600 1126 920 1092', 30, 'rgba(0,0,0,.10)', 18);
    // Costuras del ruedo, mangas y cuello
    sc.save();
    sc.setLineDash([7, 6]);
    sc.lineWidth = 2;
    sc.strokeStyle = 'rgba(0,0,0,.28)';
    [
      'M286 1082Q600 1116 914 1082',
      hanger ? 'M152 510L272 578' : 'M110 487L252 568',
      hanger ? 'M1048 510L928 578' : 'M1090 487L948 568',
      back ? 'M497 162C537 194 663 194 703 162' : 'M497 160C530 232 670 232 703 160',
    ].forEach((d) => sc.stroke(new Path2D(d)));
    sc.restore();

    const light = createCanvas(DOC_W, DOC_H);
    const lc = light.getContext('2d');
    const glow = lc.createRadialGradient(520, 470, 40, 520, 470, 560);
    glow.addColorStop(0, 'rgba(255,255,255,.30)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    lc.fillStyle = glow;
    lc.fillRect(0, 0, DOC_W, DOC_H);
    if (hanger) {
      softStroke(lc, 'M355 560Q385 760 370 980', 18, 'rgba(255,255,255,.18)', 26);
      softStroke(lc, 'M200 430L262 390', 26, 'rgba(255,255,255,.16)', 28);
    } else {
      softStroke(lc, 'M340 560Q445 700 495 870', 20, 'rgba(255,255,255,.22)', 26);
      softStroke(lc, 'M860 560Q755 700 705 870', 20, 'rgba(255,255,255,.16)', 26);
      softStroke(lc, 'M150 430L250 395', 30, 'rgba(255,255,255,.18)', 30);
    }
    softStroke(lc, 'M445 980Q495 1045 478 1110', 16, 'rgba(255,255,255,.16)', 18);
    softStroke(lc, back ? 'M490 152C532 186 668 186 710 152' : 'M490 152C525 222 675 222 710 152', 6, 'rgba(255,255,255,.35)', 5);

    // Textura de tejido: ruido fino + trama horizontal
    const tile = createCanvas(128, 128);
    const tc = tile.getContext('2d');
    const img = tc.createImageData(128, 128);
    const rand = mulberry32(42);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rand() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 10 + rand() * 18;
    }
    tc.putImageData(img, 0, 0);
    tc.fillStyle = 'rgba(0,0,0,.05)';
    for (let y = 0; y < 128; y += 3) tc.fillRect(0, y, 128, 1);
    const texture = createCanvas(DOC_W, DOC_H);
    const xc = texture.getContext('2d');
    xc.fillStyle = xc.createPattern(tile, 'repeat');
    xc.fillRect(0, 0, DOC_W, DOC_H);

    const layers = { shadow, light, texture };
    fabricCache.set(key, layers);
    return layers;
  }

  /* Percha: gancho (detrás del cuello) y madera visible por el escote */
  function drawHangerHook(c) {
    c.save();
    c.lineCap = 'round';
    c.lineWidth = 8;
    c.strokeStyle = '#7d828c';
    c.stroke(new Path2D('M600 175L600 92C600 66 628 54 628 30C628 4 604 -8 584 6'));
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255,255,255,.55)';
    c.stroke(new Path2D('M597 170L597 92C597 70 622 56 622 32'));
    c.restore();
  }
  function drawHangerWood(c) {
    c.save();
    c.clip(new Path2D(NECK_OPENING));
    const g = c.createLinearGradient(0, 150, 0, 200);
    g.addColorStop(0, '#c99560');
    g.addColorStop(1, '#8f5b2c');
    c.strokeStyle = g;
    c.lineWidth = 30;
    c.lineCap = 'round';
    c.stroke(new Path2D('M430 196Q600 140 770 196'));
    c.restore();
  }

  /* Remera de un color con todas sus capas (en caché por modelo, vista, color y escala) */
  let shirtCache = { key: '', canvas: null };
  function renderShirt(k, color, tpl, view) {
    const key = `${k}|${color}|${tpl}|${view}`;
    if (shirtCache.key === key) return shirtCache.canvas;
    if (isPhotoTemplate(tpl)) {
      const ph = renderPhotoShirt(k, color, tpl);
      if (ph) shirtCache = { key, canvas: ph };
      return ph;
    }
    const L = getFabricLayers(tpl, view);
    const dark = luminance(color) < 0.35;
    const T = shirtTransform(tpl);
    const out = createCanvas(MOCK_SIZE * k, MOCK_SIZE * k);
    const c = out.getContext('2d');
    c.setTransform(k * T.sc, 0, 0, k * T.sc, k * T.tx, k * T.ty);
    if (tpl === 'hanger') drawHangerHook(c);
    const body = new Path2D(shirtPath(tpl, view));
    // La remera se pinta en una capa propia para que sombras y textura queden solo sobre la tela
    const fabric = createCanvas(out.width, out.height);
    const f = fabric.getContext('2d');
    f.setTransform(k * T.sc, 0, 0, k * T.sc, k * T.tx, k * T.ty);
    f.fillStyle = color;
    f.fill(body);
    if (view === 'front') {
      // Interior de la espalda que se ve por el escote
      f.fillStyle = mixHex(color, '#000000', dark ? 0.35 : 0.22);
      f.fill(new Path2D(NECK_OPENING));
    }
    f.lineWidth = 24;
    f.strokeStyle = mixHex(color, '#000000', 0.08);
    f.stroke(new Path2D('M485 150' + (view === 'back' ? BACK_NECK : FRONT_NECK)));
    f.globalCompositeOperation = 'source-atop';
    f.globalAlpha = dark ? 0.7 : 1;
    f.drawImage(L.shadow, 0, 0);
    f.globalAlpha = dark ? 0.5 : 0.55;
    f.drawImage(L.light, 0, 0);
    f.globalAlpha = dark ? 0.6 : 0.45;
    f.drawImage(L.texture, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    if (tpl === 'hanger' && view === 'front') drawHangerWood(f);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(fabric, 0, 0);
    shirtCache = { key, canvas: out };
    return out;
  }

  /* Cuánto siguen el diseño las sombras y la textura de la tela */
  const FUSION = {
    keep: { label: 'Conservar colores', shadow: 0.35, light: 0.12, texture: 0.25 },
    soft: { label: 'Suave', shadow: 0.6, light: 0.25, texture: 0.4 },
    multiply: { label: 'Multiplicar', shadow: 0.5, light: 0.15, texture: 0.35, multiply: true },
    intense: { label: 'Intensa', shadow: 1, light: 0.45, texture: 0.65 },
  };

  function drawMockup(target, k, preview, transparent) {
    const m = state.compose.mockup;
    const c = target.getContext('2d');
    const W = target.width, H = target.height;
    const isShirt = !(m.base === 'photo' && m.photoId && images.get(m.photoId));

    if (isShirt && isRealTemplate(m.template)) {
      const e = loadRealPhoto(m.template, m.view, m.shirtColor);
      if (e.status !== 'ready') {
        c.fillStyle = '#e4e4e7';
        c.fillRect(0, 0, W, H);
        c.fillStyle = '#4b5470';
        c.font = `600 ${Math.round(24 * k)}px Inter, Arial`;
        c.textAlign = 'center';
        c.fillText(e.status === 'error' ? 'No se pudo cargar la foto' : 'Cargando foto…', W / 2, H / 2);
        return;
      }
      c.drawImage(e.photo, 0, 0, W, H);
      if (!m.items.length) return;
      const fxr = FUSION[m.fusion] || FUSION.keep;
      const lay = createCanvas(W, H);
      const lx = lay.getContext('2d');
      m.items.forEach((it) => drawItem(lx, it, k, preview));
      const alpha = createCanvas(W, H);
      alpha.getContext('2d').drawImage(lay, 0, 0);
      // Pliegues reales de la foto, solo dentro de la estampa
      lx.globalCompositeOperation = 'multiply';
      lx.globalAlpha = Math.min(1, 0.4 + fxr.shadow);
      lx.drawImage(e.shade, 0, 0, W, H);
      lx.globalAlpha = 1;
      lx.globalCompositeOperation = 'destination-in';
      lx.drawImage(alpha, 0, 0);
      c.save();
      if (fxr.multiply) c.globalCompositeOperation = 'multiply';
      c.drawImage(lay, 0, 0);
      c.restore();
      return;
    }
    const photoTpl = isShirt && isPhotoTemplate(m.template);
    if (photoTpl) {
      const shirt = renderShirt(k, m.shirtColor, m.template, 'front');
      if (!shirt) {
        c.fillStyle = '#f3f4f7';
        c.fillRect(0, 0, W, H);
        c.fillStyle = '#4b5470';
        c.font = `600 ${Math.round(24 * k)}px Inter, Arial`;
        c.textAlign = 'center';
        c.fillText('Cargando foto…', W / 2, H / 2);
        return;
      }
      c.drawImage(shirt, 0, 0, W, H);
    } else if (isShirt) {
      if (!transparent) {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, W, H);
      }
      c.save();
      c.shadowColor = 'rgba(20,30,70,.22)';
      c.shadowBlur = 34 * k;
      c.shadowOffsetY = 14 * k;
      c.drawImage(renderShirt(k, m.shirtColor, m.template, m.view), 0, 0);
      c.restore();
    } else {
      const ph = images.get(m.photoId);
      c.drawImage(preview ? ph.preview : ph.full, 0, 0, W, H);
    }

    if (!m.items.length) return;
    // El diseño se arma aparte para que siga los pliegues de la tela
    const fx = FUSION[m.fusion] || FUSION.keep;
    const layer = createCanvas(W, H);
    const lc = layer.getContext('2d');
    m.items.forEach((it) => drawItem(lc, it, k, preview));
    if (photoTpl) {
      // Pliegues reales de la foto sobre la estampa, y recorte a la remera
      const e = loadPhotoTemplate(m.template);
      lc.globalCompositeOperation = 'source-atop';
      lc.globalAlpha = fx.shadow;
      lc.drawImage(e.shadow, 0, 0, W, H);
      lc.globalAlpha = fx.light;
      lc.drawImage(e.light, 0, 0, W, H);
      lc.globalAlpha = 1;
      lc.globalCompositeOperation = 'destination-in';
      lc.drawImage(e.mask, 0, 0, W, H);
      c.save();
      if (fx.multiply) c.globalCompositeOperation = 'multiply';
      c.drawImage(layer, 0, 0);
      c.restore();
      return;
    }
    const T = shirtTransform(m.template);
    if (isShirt) {
      const L = getFabricLayers(m.template, m.view);
      lc.globalCompositeOperation = 'source-atop';
      lc.setTransform(k * T.sc, 0, 0, k * T.sc, k * T.tx, k * T.ty);
      lc.globalAlpha = fx.shadow;
      lc.drawImage(L.shadow, 0, 0);
      lc.globalAlpha = fx.light;
      lc.drawImage(L.light, 0, 0);
      lc.globalAlpha = fx.texture;
      lc.drawImage(L.texture, 0, 0);
    }
    c.save();
    if (isShirt) {
      // La estampa no puede salir de la remera
      c.setTransform(k * T.sc, 0, 0, k * T.sc, k * T.tx, k * T.ty);
      c.clip(new Path2D(shirtPath(m.template, m.view)));
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (fx.multiply) c.globalCompositeOperation = 'multiply';
    c.drawImage(layer, 0, 0);
    c.restore();
  }

  /* --- Lienzo DTF: posición libre, en centímetros ---
     Cada imagen guarda x, y (esquina superior izquierda), w (ancho de la imagen
     sin girar) y rot (0 o 90). El alto sale de la proporción de la imagen. */
  const fmtNum = (v) => (Math.round(v * 100) / 100).toLocaleString('es-AR');
  function sheetBox(it) {
    const img = images.get(it.imgId);
    const ratio = img ? img.full.height / img.full.width : 1;
    const h = it.w * ratio;
    return it.rot === 90 ? { w: h, h: it.w } : { w: it.w, h };
  }
  function effectiveDpi(it) {
    const img = images.get(it.imgId);
    return img ? Math.round(img.full.width / (it.w / CM_PER_INCH)) : 0;
  }
  const sheetSel = () => state.compose.lienzo.selected || [];
  function sheetSelected() {
    const sheet = state.compose.lienzo;
    return sheet.items.filter((it) => sheet.selected.includes(it.id));
  }

  /* Ordena todas las imágenes en estantes (de mayor a menor alto), sin cambiar su
     tamaño, girando las que lo necesitan para entrar o para aprovechar mejor el ancho. */
  function packSheet(sheet, allowRotate) {
    const gap = sheet.gapMm / 10;
    const usable = sheet.widthCm - gap * 2;
    const pieces = sheet.items.map((it) => {
      const img = images.get(it.imgId);
      const ratio = img ? img.full.height / img.full.width : 1;
      const w0 = it.w, h0 = it.w * ratio;
      let rot = 0;
      if (w0 > usable && h0 <= usable) rot = 90;                       // solo entra girada
      else if (allowRotate && h0 > w0 && h0 <= usable) rot = 90;       // apaisada ocupa menos alto
      return { it, rot, w: rot ? h0 : w0, h: rot ? w0 : h0 };
    }).sort((a, b) => b.h - a.h);
    const shelves = [];
    let y = gap;
    pieces.forEach((p) => {
      let sh = shelves.find((s) => s.x + p.w <= sheet.widthCm - gap + 0.001 && p.h <= s.h + 0.001);
      if (!sh) {
        sh = { y, x: gap, h: p.h };
        shelves.push(sh);
        y += p.h + gap;
      }
      p.x = sh.x;
      p.y = sh.y;
      sh.x += p.w + gap;
    });
    return { pieces, height: y };
  }
  function arrangeSheet() {
    const sheet = state.compose.lienzo;
    if (!sheet.items.length) { toast('Primero agregá imágenes al lienzo.'); return; }
    // Prueba con y sin giros y se queda con la que usa menos largo
    const a = packSheet(sheet, false), b = packSheet(sheet, true);
    const best = b.height < a.height - 0.01 ? b : a;
    pushHistory();
    let rotated = 0;
    best.pieces.forEach((p) => {
      if (p.rot !== p.it.rot) rotated++;
      p.it.rot = p.rot;
      p.it.x = Math.round(p.x * 100) / 100;
      p.it.y = Math.round(p.y * 100) / 100;
    });
    let msg = `✓ ${sheet.items.length} ${sheet.items.length === 1 ? 'imagen ordenada' : 'imágenes ordenadas'} con ${fmtNum(sheet.gapMm)} mm de separación para cortar${rotated ? `, girando ${rotated}` : ''}, sin cambiar su tamaño.`;
    const need = Math.ceil(best.height * 10) / 10;
    if (need > sheet.heightCm) {
      sheet.heightCm = Math.min(1000, Math.ceil(need));
      msg += ` El alto del lienzo pasó a ${fmtNum(sheet.heightCm)} cm.`;
    }
    afterStateChange();
    setStatus(msg);
  }

  /* Lugar libre para una imagen nueva: debajo de todo lo que ya hay */
  function nextFreeY(sheet) {
    const gap = sheet.gapMm / 10;
    return sheet.items.reduce((m, it) => Math.max(m, it.y + sheetBox(it).h + gap), gap);
  }
  function ensureHeight(sheet) {
    const bottom = sheet.items.reduce((m, it) => Math.max(m, it.y + sheetBox(it).h), 0) + sheet.gapMm / 10;
    if (bottom > sheet.heightCm) sheet.heightCm = Math.min(1000, Math.ceil(bottom));
  }

  function drawSheet(target, pxPerCm, preview, offsetCm = 0) {
    const sheet = state.compose.lienzo;
    const c = target.getContext('2d');
    const sel = sheet.selected || [];
    if (preview) {
      sheetHandle = null;
      c.fillStyle = 'rgba(255,255,255,.45)';
      c.fillRect(0, 0, target.width, target.height);
      // Reglas: marcas cada 10 cm
      c.fillStyle = '#1b2a6e';
      c.font = '600 12px Inter, Arial';
      for (let cm = 10; cm < sheet.heightCm; cm += 10) {
        const yy = cm * pxPerCm;
        c.fillRect(0, yy, 10, 1.5);
        c.fillText(cm + ' cm', 14, yy + 4);
      }
      c.textAlign = 'center';
      c.fillText(`${fmtNum(sheet.widthCm)} cm`, target.width / 2, 14);
      c.textAlign = 'start';
    }
    sheet.items.forEach((it) => {
      const img = images.get(it.imgId);
      if (!img) return;
      const b = sheetBox(it);
      const x = it.x * pxPerCm, y = (it.y - offsetCm) * pxPerCm, w = b.w * pxPerCm, h = b.h * pxPerCm;
      if (y > target.height || y + h < 0) return;
      const pic = preview ? img.preview : img.full;
      c.save();
      if (it.rot === 90) {
        c.translate(x + w / 2, y + h / 2);
        c.rotate(Math.PI / 2);
        c.drawImage(pic, -h / 2, -w / 2, h, w);
      } else {
        c.drawImage(pic, x, y, w, h);
      }
      c.restore();
      if (preview) {
        // Contorno suave de cada imagen y aviso si se sale del lienzo
        const out = it.x < -0.01 || it.y < -0.01 || it.x + b.w > sheet.widthCm + 0.01 || it.y + b.h > sheet.heightCm + 0.01;
        c.strokeStyle = out ? '#d32f2f' : 'rgba(27,42,110,.18)';
        c.lineWidth = out ? 2 : 1;
        c.strokeRect(x, y, w, h);
      }
      if (preview && sel.includes(it.id)) {
        c.strokeStyle = '#0d4fa3';
        c.lineWidth = 2;
        c.setLineDash([6, 4]);
        c.strokeRect(x, y, w, h);
        c.setLineDash([]);
        if (sel.length === 1) {
          sheetHandle = { x: x + w, y: y + h };
          c.fillStyle = '#ffffff';
          c.lineWidth = 2.5;
          c.beginPath();
          c.arc(x + w, y + h, HANDLE, 0, Math.PI * 2);
          c.fill();
          c.stroke();
          c.fillStyle = '#0d4fa3';
          c.font = 'bold 13px Inter, Arial';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText('⤡', x + w, y + h);
          const label = `${fmtCm(b.w)} × ${fmtCm(b.h)} · ${effectiveDpi(it)} ppp`;
          c.font = '700 13px Inter, Arial';
          const tw = c.measureText(label).width + 14;
          const lx = clamp(x + w / 2 - tw / 2, 2, target.width - tw - 2);
          const ly = y > 30 ? y - 28 : y + 6;
          c.fillStyle = '#0d4fa3';
          c.beginPath();
          c.roundRect ? c.roundRect(lx, ly, tw, 22, 6) : c.rect(lx, ly, tw, 22);
          c.fill();
          c.fillStyle = '#ffffff';
          c.fillText(label, lx + tw / 2, ly + 11);
          c.textAlign = 'start';
          c.textBaseline = 'alphabetic';
        }
      }
    });
  }

  /* --- Interacción con el puntero (Diseño, Mockup y Lienzo) --- */
  const drag = { mode: null };
  let sheetHandle = null;   // posición del asa de tamaño en el lienzo (px de vista previa)

  function docOf(toolId) { return state.compose[toolId]; }
  function selectedItem(toolId) {
    const d = docOf(toolId);
    return d.items.find((i) => i.id === d.selected) || null;
  }

  function toLocal(it, px, py) {
    const a = -it.rot * Math.PI / 180;
    const dx = px - it.x, dy = py - it.y;
    return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  }

  function hitTest(toolId, px, py, k) {
    const d = docOf(toolId);
    const c = $('#result-canvas').getContext('2d');
    const sel = selectedItem(toolId);
    const tol = (HANDLE + 6) / k;
    if (sel) {
      const [w, h] = itemSize(c, sel);
      const [lx, ly] = toLocal(sel, px, py);
      if (Math.hypot(lx - w / 2, ly - h / 2) < tol) return { item: sel, mode: 'scale' };
      if (Math.hypot(lx, ly + h / 2 + 30 / k) < tol) return { item: sel, mode: 'rotate' };
    }
    for (let i = d.items.length - 1; i >= 0; i--) {
      const it = d.items[i];
      const [w, h] = itemSize(c, it);
      const [lx, ly] = toLocal(it, px, py);
      if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return { item: it, mode: 'move' };
    }
    return null;
  }

  function canvasPoint(e) {
    const canvas = $('#result-canvas');
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height];
  }

  function initComposeInteraction() {
    const canvas = $('#result-canvas');

    canvas.addEventListener('pointerdown', (e) => {
      const tool = TOOLS[state.tool];
      if (tool.colorOps) { colorEditDown(e); return; }
      if (tool.brush && tool.brush(settingsOf(state.tool)) && state.sourceId) { startBrush(e); return; }
      if (tool.picker && tool.picker(settingsOf(state.tool))) { pickColor(e); return; }
      if (!tool.interactive) return;
      const [cx, cy] = canvasPoint(e);
      const k = previewScale.k;

      if (state.tool === 'lienzo') {
        const sheet = state.compose.lienzo;
        const xcm = cx / k, ycm = cy / k;
        // ¿Tocó el asa de tamaño de la imagen seleccionada?
        if (sheetHandle && Math.hypot(cx - sheetHandle.x, cy - sheetHandle.y) < HANDLE + 8) {
          const it = sheetSelected()[0];
          if (it) {
            pushHistory();
            drag.mode = 'sheet-size';
            drag.item = it;
            drag.start = { cx, cy, w: it.w };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
        }
        const hit = sheet.items.slice().reverse().find((it) => {
          const b = sheetBox(it);
          return xcm >= it.x && xcm <= it.x + b.w && ycm >= it.y && ycm <= it.y + b.h;
        });
        if (!hit) {
          if (!sheet.multi) sheet.selected = [];
        } else if (sheet.multi || e.shiftKey || e.ctrlKey || e.metaKey) {
          sheet.selected = sheet.selected.includes(hit.id) ? sheet.selected.filter((x) => x !== hit.id) : [...sheet.selected, hit.id];
        } else if (!sheet.selected.includes(hit.id)) {
          sheet.selected = [hit.id];
        }
        if (hit && sheet.selected.includes(hit.id)) {
          pushHistory();
          drag.mode = 'sheet-move';
          drag.start = { xcm, ycm, pos: sheetSelected().map((it) => [it, it.x, it.y]) };
          canvas.setPointerCapture(e.pointerId);
          $('#stage').classList.add('is-dragging');
        }
        schedulePreview(true);
        renderPanelContent();
        return;
      }

      const px = cx / k, py = cy / k;
      const hit = hitTest(state.tool, px, py, k);
      const d = docOf(state.tool);
      d.selected = hit ? hit.item.id : null;
      if (hit) {
        pushHistory();
        const it = hit.item;
        drag.mode = hit.mode;
        drag.start = { px, py, x: it.x, y: it.y, w: it.w, h: it.h, size: it.size, rot: it.rot };
        drag.item = it;
        canvas.setPointerCapture(e.pointerId);
        $('#stage').classList.add('is-dragging');
      }
      schedulePreview();
      renderPanelContent();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (TOOLS[state.tool].colorOps) { colorEditMove(e); return; }
      if (moveBrush(e)) return;
      if (!drag.mode) return;
      const [cx, cy] = canvasPoint(e);
      const k = previewScale.k;
      const px = cx / k, py = cy / k;
      const it = drag.item, s = drag.start;
      if (drag.mode === 'sheet-size') {
        // Arrastrar en diagonal agranda o achica, manteniendo la proporción
        const img = images.get(it.imgId).full;
        const ratio = img.height / img.width;
        const dCm = ((cx - s.cx) + (cy - s.cy)) / 2 / k;
        const visualW = it.rot === 90 ? s.w * ratio : s.w;
        const newVisual = Math.max(0.5, visualW + dCm);
        it.w = Math.round((it.rot === 90 ? newVisual / ratio : newVisual) * 10) / 10;
        schedulePreview(true);
        return;
      }
      if (drag.mode === 'sheet-move') {
        const sheet = state.compose.lienzo;
        let dx = cx / k - s.xcm, dy = cy / k - s.ycm;
        // No deja sacar las imágenes por la izquierda ni por arriba
        s.pos.forEach(([, x0, y0]) => { dx = Math.max(dx, -x0); dy = Math.max(dy, -y0); });
        s.pos.forEach(([o, x0, y0]) => {
          const b = sheetBox(o);
          o.x = Math.round(clamp(x0 + dx, 0, Math.max(0, sheet.widthCm - b.w)) * 10) / 10;
          o.y = Math.round((y0 + dy) * 10) / 10;
        });
        schedulePreview(true);
        return;
      }
      if (drag.mode === 'move') {
        it.x = s.x + (px - s.px);
        it.y = s.y + (py - s.py);
        // Imán al centro: muestra la guía vertical u horizontal del medio
        const d = docOf(state.tool);
        const snap = 10 / k;
        drag.guideX = Math.abs(it.x - d.w / 2) < snap;
        drag.guideY = Math.abs(it.y - d.h / 2) < snap;
        if (drag.guideX) it.x = d.w / 2;
        if (drag.guideY) it.y = d.h / 2;
      } else if (drag.mode === 'scale') {
        const d0 = Math.hypot(s.px - s.x, s.py - s.y) || 1;
        const f = clamp(Math.hypot(px - s.x, py - s.y) / d0, 0.05, 20);
        if (it.type === 'text') it.size = Math.max(6, s.size * f);
        else { it.w = s.w * f; it.h = s.h * f; }
      } else if (drag.mode === 'rotate') {
        let deg = Math.atan2(py - it.y, px - it.x) * 180 / Math.PI + 90;
        if (!e.shiftKey) {                       // imán cada 15°
          const snap = Math.round(deg / 15) * 15;
          if (Math.abs(snap - deg) < 4) deg = snap;
        }
        it.rot = Math.round(((deg + 540) % 360) - 180);
      }
      schedulePreview(true);
    });

    const end = () => {
      if (colorEditEnd()) return;
      if (endBrush()) return;
      if (!drag.mode) return;
      if ((drag.mode === 'sheet-move' || drag.mode === 'sheet-size') && state.tool === 'lienzo') ensureHeight(state.compose.lienzo);
      drag.mode = null;
      drag.guideX = drag.guideY = false;
      schedulePreview(true);
      $('#stage').classList.remove('is-dragging');
      renderPanelContent();
      scheduleSave();
    };
    canvas.addEventListener('pointerup', end);
    // Doble clic en un elemento del diseño: abre sus opciones
    canvas.addEventListener('dblclick', () => {
      if (state.tool === 'diseno' && selectedItem('diseno')) openPanel('design-props');
    });
    canvas.addEventListener('pointerleave', () => { const cur = $('#brush-cursor'); if (cur) cur.hidden = true; });
    canvas.addEventListener('pointercancel', end);
  }

  /* --- Pincel de retoque (Eliminar fondo) --- */
  const brushState = { active: false, last: null };
  function touchPoint(e, t) {
    const r = $('#result-canvas').getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * t.canvas.width, (e.clientY - r.top) / r.height * t.canvas.height];
  }
  function brushRadius(t) {
    const r = $('#result-canvas').getBoundingClientRect();
    return settingsOf('eliminar-fondo').brushSize / 2 * t.canvas.width / r.width;
  }
  function paintStroke(t, from, to) {
    const s = settingsOf('eliminar-fondo');
    const c = t.canvas.getContext('2d');
    // Borrar pinta verde y Restaurar pinta rojo (cada trazo reemplaza al anterior en esa zona)
    c.strokeStyle = s.brush === 'erase' ? 'rgb(0,255,0)' : 'rgb(255,0,0)';
    c.lineWidth = brushRadius(t) * 2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(from[0], from[1]);
    c.lineTo(to[0] + 0.01, to[1]);
    c.stroke();
  }
  function updateBrushCursor(e, diameter, cls) {
    let cur = $('#brush-cursor');
    if (!cur) {
      cur = document.createElement('div');
      cur.id = 'brush-cursor';
      cur.className = 'brush-cursor';
      cur.setAttribute('aria-hidden', 'true');
      $('#stage').appendChild(cur);
    }
    if (diameter === undefined) {
      const s = settingsOf('eliminar-fondo');
      diameter = s.brushSize;
      cls = s.brush;
    }
    const st = $('#stage').getBoundingClientRect();
    cur.hidden = false;
    cur.className = `brush-cursor is-${cls}`;
    cur.style.width = cur.style.height = Math.max(4, diameter) + 'px';
    cur.style.left = (e.clientX - st.left) + 'px';
    cur.style.top = (e.clientY - st.top) + 'px';
  }
  function startBrush(e) {
    const t = ensureTouch();
    t.history.push(cloneCanvas(t.canvas));
    if (t.history.length > 15) t.history.shift();
    brushState.active = true;
    brushState.last = touchPoint(e, t);
    paintStroke(t, brushState.last, brushState.last);
    $('#result-canvas').setPointerCapture(e.pointerId);
    updateBrushCursor(e);
    schedulePreview(true);
  }
  function moveBrush(e) {
    const tool = TOOLS[state.tool];
    if (!tool.brush || !tool.brush(settingsOf(state.tool)) || !state.sourceId) return false;
    updateBrushCursor(e);
    if (!brushState.active) return true;
    const t = ensureTouch();
    const p = touchPoint(e, t);
    paintStroke(t, brushState.last, p);
    brushState.last = p;
    schedulePreview(true);
    return true;
  }
  function endBrush() {
    if (!brushState.active) return false;
    brushState.active = false;
    renderPanelContent();
    renderHeading();
    return true;
  }

  /* --- Editar colores: gotero, pincel, borrador y restaurar --- */
  const colorStroke = { active: false };
  function normPoint(e) {
    const r = $('#result-canvas').getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
  }
  /* Color del resultado actual en ese punto (lo que se ve en la vista previa) */
  function resultColorAt(nx, ny) {
    const c = $('#result-canvas');
    const p = ctx2d(c).getImageData(clamp(Math.floor(nx * c.width), 0, c.width - 1), clamp(Math.floor(ny * c.height), 0, c.height - 1), 1, 1).data;
    return p[3] < 10 ? null : rgbToHex(p[0], p[1], p[2]);
  }
  /* Color de la imagen editada (antes del semitono) en ese punto */
  function editedColorAt(nx, ny) {
    const src = source();
    const s = settingsOf(state.tool);
    const ed = s.ops.length ? applyColorOps(src.preview, s.ops, src.full.width) : src.preview;
    const p = ctx2d(ed).getImageData(clamp(Math.floor(nx * ed.width), 0, ed.width - 1), clamp(Math.floor(ny * ed.height), 0, ed.height - 1), 1, 1).data;
    return p[3] < 10 ? null : rgbToHex(p[0], p[1], p[2]);
  }
  function colorBrushInfo(s) {
    const r = $('#result-canvas').getBoundingClientRect();
    const src = source();
    const t = TOOLS[state.tool];
    const size = t.brushSize && src ? t.brushSize(s, src) : s.mode === 'paint' ? s.paintSize : s.mode === 'erase' ? s.eraseSize : s.restoreSize;
    return { size, css: src ? size * r.width / src.full.width : size };
  }
  function colorEditDown(e) {
    if (!state.sourceId) return;
    const s = settingsOf(state.tool);
    const [nx, ny] = normPoint(e);
    if (s.pickPaint) {
      const hex = resultColorAt(nx, ny);
      if (!hex) { toast('Ese punto es transparente. Tocá una zona con color.'); return; }
      pushHistory();
      s.paintColor = hex;
      s.pickPaint = false;
      afterStateChange();
      return;
    }
    if (s.mode === 'dropper') {
      const hex = TOOLS[state.tool].sampleEdited ? editedColorAt(nx, ny) : resultColorAt(nx, ny);
      if (!hex) { toast('Ese punto ya es transparente.'); return; }
      pushHistory();
      s.ops.push({ type: 'tap', x: nx, y: ny, color: hex, action: s.tapAction || 'remove', scope: s.tapScope, tol: s.tolerance, newColor: s.newColor });
      afterStateChange();
      return;
    }
    // Sin una herramienta de pincel activa, tocar la imagen no hace nada
    if (!(TOOLS[state.tool].brush && TOOLS[state.tool].brush(s))) return;
    pushHistory();
    const { size } = colorBrushInfo(s);
    const extra = TOOLS[state.tool].strokeExtra ? TOOLS[state.tool].strokeExtra(s) : {};
    s.ops.push({ type: 'stroke', tool: s.mode, color: s.paintColor, size, pts: [[nx, ny]], ...extra });
    colorStroke.active = true;
    $('#result-canvas').setPointerCapture(e.pointerId);
    schedulePreview(true);
  }
  function colorEditMove(e) {
    const s = settingsOf(state.tool);
    const t = TOOLS[state.tool];
    if (state.sourceId && t.brush && t.brush(s)) {
      const info = colorBrushInfo(s);
      updateBrushCursor(e, info.css, s.mode === 'paint' ? 'paint' : s.mode === 'restore' ? 'restore' : 'erase');
    }
    if (!colorStroke.active) return;
    const op = s.ops[s.ops.length - 1];
    const [nx, ny] = normPoint(e);
    const last = op.pts[op.pts.length - 1];
    // Evita guardar puntos casi iguales (menos datos y más fluidez)
    if (Math.hypot(nx - last[0], ny - last[1]) < 0.0015) return;
    op.pts.push([Math.round(nx * 10000) / 10000, Math.round(ny * 10000) / 10000]);
    schedulePreview(true);
  }
  function colorEditEnd() {
    if (!colorStroke.active) return false;
    colorStroke.active = false;
    afterStateChange();
    return true;
  }

  /* Cuentagotas: lee el color de la imagen original en ese punto */
  function pickColor(e) {
    const src = source();
    if (!src) return;
    const [cx, cy] = canvasPoint(e);
    const canvas = $('#result-canvas');
    const x = Math.floor(cx / canvas.width * src.preview.width);
    const y = Math.floor(cy / canvas.height * src.preview.height);
    const p = ctx2d(src.preview).getImageData(clamp(x, 0, src.preview.width - 1), clamp(y, 0, src.preview.height - 1), 1, 1).data;
    if (p[3] < 10) { toast('Ese punto es transparente. Tocá una zona con color.'); return; }
    TOOLS[state.tool].onPick(rgbToHex(p[0], p[1], p[2]));
  }

  /* =========================================================
     7. INTERFAZ: MENÚ, TÍTULO Y PANEL DE AJUSTES
     ========================================================= */

  /* --- Chispas animadas del header (misma secuencia que el original) --- */
  function createHeaderSparks() {
    const energy = $('.header-energy');
    if (!energy) return;
    const durations = [3.8, 4.5, 5.2, 5.9];
    for (let i = 0; i < 16; i++) {
      const spark = document.createElement('i');
      spark.className = 'header-energy-spark';
      spark.style.left = ((i * 37) % 100) + '%';
      spark.style.top = (15 + ((i * 23) % 70)) + '%';
      spark.style.animationDelay = (-0.67 * i).toFixed(2) + 's';
      spark.style.animationDuration = durations[i % 4] + 's';
      energy.appendChild(spark);
    }
  }

  /* --- Menú lateral de herramientas --- */
  function initToolMenu() {
    const buttons = $$('.tool-link');
    buttons.forEach((b) => b.addEventListener('click', () => {
      selectTool(b.dataset.tool);
      $('#contenido').focus({ preventScroll: true });
    }));
    $('.tool-list').addEventListener('keydown', (e) => {
      const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
      if (!(e.key in keys)) return;
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      buttons[(i + keys[e.key] + buttons.length) % buttons.length].focus();
    });
  }

  function selectTool(toolId, opts = {}) {
    if (!TOOLS[toolId]) return;
    state.tool = toolId;
    $$('.tool-link').forEach((b) => {
      const on = b.dataset.tool === toolId;
      b.classList.toggle('active', on);
      if (on) { b.setAttribute('aria-current', 'true'); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      else b.removeAttribute('aria-current');
    });
    if (toolId === 'diseno') loadDesignFonts();
    // El mockup usa automáticamente la imagen actual si todavía no tiene diseño
    if (toolId === 'mockup' && state.sourceId && !state.compose.mockup.items.length) setMockupDesign(state.sourceId);
    setStatus('');
    state.zoom = 1;
    state.compare = false;
    closePanel();
    renderHeaderPanels();
    renderHeading();
    schedulePreview();
    updateHistoryButtons();
    if (!opts.silent) scheduleSave();
  }

  /* --- Título, descripción, insignia y textos de descarga --- */
  function renderHeading() {
    const tool = TOOLS[state.tool];
    const s = settingsOf(state.tool);
    const num = String(TOOL_ORDER.indexOf(state.tool) + 1).padStart(2, '0');
    $('#tool-eyebrow').textContent = `Herramienta ${num}`;
    $('#tool-title').innerHTML = tool.title + (tool.ai ? ' <i class="tool-ai-badge">IA</i>' : '');
    $('#tool-desc').textContent = tool.desc;
    const [big, small] = tool.quality(s);
    $('#tool-quality').innerHTML = `<strong>${big}</strong><span>${small}</span>`;
    document.title = `${tool.title} · Herramientas Tu Estampa SF`;

    const hasContent = (tool.interactive ? composeHasContent(state.tool) : !!state.sourceId) && (!tool.ready || tool.ready(s));
    // Si falta procesar con IA, el botón principal ofrece hacerlo
    const pending = !hasContent && state.sourceId && tool.primaryAction ? tool.primaryAction(s) : null;
    const dl = $('#download-btn');
    dl.textContent = pending ? pending.label : tool.downloadLabel(s);
    dl.disabled = !hasContent && !pending;
    dl.classList.toggle('is-ai', !!pending);
    dl.title = '';
    $('#download-note').textContent = state.sourceId && tool.ready && !tool.ready(s) ? tool.notReady : tool.note(s);
    // Barra lateral (Crear diseño: Imagen, Texto, Formas, Capas, Editar)
    const side = $('#side-tools');
    side.innerHTML = '';
    side.hidden = !tool.sideTools;
    (tool.sideTools || []).forEach((st) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = st.label;
      b.setAttribute('aria-label', st.label);
      b.innerHTML = st.text ? `<b class="side-T">${st.text}</b>` : svgIcon(st.icon);
      if (st.panel) b.setAttribute('aria-expanded', String(state.openPanel === st.panel));
      b.disabled = !!(st.disabled && st.disabled());
      b.addEventListener('click', () => (st.panel ? togglePanel(st.panel) : st.run()));
      side.appendChild(b);
    });
    renderPagesStrip();

    // Accesos de texto a los paneles (ej. "Opacidad" y "Borde" en Semitransparencias)
    const chips = $('#panel-chips');
    chips.innerHTML = '';
    const chipPanels = tool.panels.filter((p) => p.chip);
    $('#settings-shortcut').hidden = chipPanels.length > 0;
    chipPanels.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preview-chip text-chip';
      b.dataset.panel = p.id;
      b.textContent = p.label;
      b.setAttribute('aria-expanded', String(state.openPanel === p.id));
      b.setAttribute('aria-controls', 'tool-settings-panel');
      b.addEventListener('click', () => togglePanel(p.id));
      chips.appendChild(b);
    });

    // Acciones extra de la herramienta (ej. "Recortar márgenes transparentes")
    const extra = $('#extra-actions');
    extra.innerHTML = '';
    (tool.extraActions || []).forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preview-chip';
      b.textContent = a.label;
      b.disabled = !state.sourceId;
      b.addEventListener('click', a.run);
      extra.appendChild(b);
    });
    // Segunda descarga (ej. PDF del lienzo)
    const dl2 = $('#download-btn-2');
    dl2.hidden = !tool.secondaryDownload;
    if (tool.secondaryDownload) {
      dl2.textContent = tool.secondaryDownload.label;
      dl2.disabled = !hasContent;
      dl2.onclick = tool.secondaryDownload.run;
    }
    const info = $('#output-info');
    const rows = tool.info && (tool.interactive || state.sourceId) ? tool.info(s) : null;
    info.hidden = !rows;
    info.innerHTML = rows ? rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('') : '';
    $('#upload-shortcut-label').textContent = tool.uploadLabel || (state.sourceId ? 'Cambiar imagen' : 'Subir imagen');

    // Comparador solo en herramientas de filtro con imagen
    const canCompare = tool.compare && !!state.sourceId;
    $('#compare-toggle').hidden = !canCompare;
    if (!canCompare) state.compare = false;
    $('#compare-toggle').setAttribute('aria-pressed', String(state.compare));

    // Acciones para enviar el resultado a otra herramienta
    const actions = $('#result-actions');
    actions.innerHTML = '';
    tool.next.forEach((target) => {
      const t = TOOLS[target];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'canvas-send';
      b.disabled = !hasContent;
      b.innerHTML = SEND_LABELS[target] + (t.ai ? ' <i class="tool-ai-badge">IA</i>' : '');
      b.addEventListener('click', () => sendTo(target));
      actions.appendChild(b);
    });
  }
  const SEND_LABELS = {
    'mejorar-foto': '▣ Mejorar fotografía',
    'mejorar-ilustracion': '✎ Mejorar ilustración',
    'eliminar-fondo': '⌾ Eliminar fondo',
    'editar-colores': '◍ Editar colores',
    semitono: '◌ Crear semitono',
    semitransparencias: '◐ Quitar semitransparencias',
    efectos: '✦ Enviar a Efectos',
    diseno: '✐ Crear diseño',
    mockup: '▱ Crear mockup',
    lienzo: '▤ Agregar al lienzo',
  };

  function composeHasContent(toolId) {
    if (toolId === 'diseno') return true;                       // un diseño vacío también se puede descargar
    return state.compose[toolId].items.length > 0;
  }

  /* --- Botones de paneles en el header --- */
  function renderHeaderPanels() {
    const bar = $('#tool-settings-toolbar');
    bar.innerHTML = '';
    TOOLS[state.tool].panels.filter((p) => p.header !== false).forEach((p) => {
      const item = document.createElement('div');
      item.className = 'tool-header-item';
      item.innerHTML = p.action
        ? `<button type="button" data-panel="${p.id}" aria-label="${p.label}" title="${p.label}" aria-pressed="false">${svgIcon(p.icon, p.filled)}</button>`
        : `<button type="button" data-panel="${p.id}" aria-label="${p.label}" title="${p.label}" aria-expanded="false" aria-controls="tool-settings-panel">${svgIcon(p.icon, p.filled)}</button>`;
      item.firstChild.addEventListener('click', () => (p.action ? (p.action(), syncPanelButtons()) : togglePanel(p.id)));
      bar.appendChild(item);
    });
    syncPanelButtons();
  }

  function togglePanel(panelId) {
    if (state.openPanel === panelId) closePanel();
    else openPanel(panelId);
  }
  function openPanel(panelId) {
    const tool = TOOLS[state.tool];
    const panel = tool.panels.find((p) => p.id === panelId) || tool.panels[0];
    state.openPanel = panel.id;
    if (panel.mode) {
      const s = settingsOf(state.tool);
      if (s.mode !== panel.mode || s.pickPaint) { s.mode = panel.mode; s.pickPaint = false; schedulePreview(true); scheduleSave(); }
    }
    $('#settings-title').textContent = panel.label;
    $('#tool-settings-panel').hidden = false;
    renderPanelContent();
    syncPanelButtons();
  }
  function closePanel() {
    state.openPanel = null;
    $('#tool-settings-panel').hidden = true;
    syncPanelButtons();
  }
  function syncPanelButtons() {
    const tool = TOOLS[state.tool];
    const s = settingsOf(state.tool);
    $$('#tool-settings-toolbar button').forEach((b) => {
      b.setAttribute('aria-expanded', String(b.dataset.panel === state.openPanel));
      const p = tool.panels.find((x) => x.id === b.dataset.panel);
      if (p && p.mode) b.setAttribute('aria-pressed', String(s.mode === p.mode));
      if (p && p.action) { b.removeAttribute('aria-expanded'); b.setAttribute('aria-pressed', String(!!p.pressed())); }
    });
    $('#settings-shortcut').setAttribute('aria-expanded', String(!!state.openPanel));
    $$('#panel-chips button').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.panel === state.openPanel)));
    if (TOOLS[state.tool].sideTools) renderHeading();
  }

  /* --- Contenido del panel: controles declarativos o personalizados --- */
  function renderPanelContent() {
    if (!state.openPanel) return;
    const tool = TOOLS[state.tool];
    const panel = tool.panels.find((p) => p.id === state.openPanel);
    const el = $('#settings-content');
    const active = document.activeElement;
    const focusKey = active && el.contains(active) ? active.dataset.focusKey : null;
    el.innerHTML = '';
    if (!panel) return;
    if (panel.render) panel.render(el);
    else panel.controls.forEach((ctl) => renderControl(el, ctl, settingsOf(state.tool)));
    if (focusKey) { const again = el.querySelector(`[data-focus-key="${focusKey}"]`); if (again) again.focus(); }
  }

  function setSetting(key, value) {
    pushHistory();
    settingsOf(state.tool)[key] = value;
    afterStateChange();
  }

  /** Crea un control a partir de su descripción. */
  function renderControl(el, ctl, s) {
    if (ctl.when && !ctl.when(s)) return;
    const id = `ctl-${state.tool}-${ctl.key || (typeof ctl.label === 'string' ? ctl.label : ctl.type)}-${ctl.type}`.replace(/[^\w-]/g, '');
    const wrap = document.createElement('div');
    wrap.className = 'field';

    // Ajuste en vivo mientras se arrastra; el historial se guarda al empezar
    const live = (v) => {
      if (!history.editing) { pushHistory(); history.editing = true; }
      s[ctl.key] = v;
      if (ctl.onChange) ctl.onChange(v, s);
      renderHeading();
      schedulePreview();
    };
    const commit = () => { history.editing = false; renderPanelContent(); scheduleSave(); };

    switch (ctl.type) {
      case 'range': {
        const fmt = ctl.fmt || ((v) => v);
        wrap.innerHTML = `<label class="field-label" for="${id}">${ctl.label} <b>${fmt(s[ctl.key])}</b></label>
          <input type="range" id="${id}" data-focus-key="${id}" min="${ctl.min}" max="${ctl.max}" step="${ctl.step}" value="${s[ctl.key]}">`;
        const input = wrap.querySelector('input');
        const badge = wrap.querySelector('b');
        input.addEventListener('input', () => { const v = Number(input.value); badge.textContent = fmt(v); live(v); });
        input.addEventListener('change', commit);
        break;
      }
      case 'number': {
        wrap.innerHTML = `<label class="field-label" for="${id}">${ctl.label}</label>
          <div class="color-row"><input type="number" id="${id}" data-focus-key="${id}" min="${ctl.min}" max="${ctl.max}" step="${ctl.step}" value="${s[ctl.key]}" inputmode="decimal"><span>${ctl.suffix || ''}</span></div>`;
        const input = wrap.querySelector('input');
        input.addEventListener('change', () => {
          const v = clamp(Number(input.value) || ctl.min, ctl.min, ctl.max);
          input.value = v;
          pushHistory();
          s[ctl.key] = v;
          afterStateChange();
        });
        break;
      }
      case 'segmented': {
        wrap.innerHTML = `<span class="field-label" id="${id}">${ctl.label}</span><div class="segmented" role="group" aria-labelledby="${id}"></div>`;
        const group = wrap.querySelector('.segmented');
        ctl.options.forEach(([val, label]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          b.dataset.focusKey = `${id}-${val}`;
          b.setAttribute('aria-pressed', String(s[ctl.key] === val));
          b.addEventListener('click', () => {
            if (s[ctl.key] === val) return;
            pushHistory();
            s[ctl.key] = val;
            if (ctl.onChange) ctl.onChange(val, s);
            afterStateChange();
          });
          group.appendChild(b);
        });
        break;
      }
      case 'check': {
        wrap.innerHTML = `<label class="check"><input type="checkbox" data-focus-key="${id}" ${s[ctl.key] ? 'checked' : ''}> ${ctl.label}</label>`;
        wrap.querySelector('input').addEventListener('change', (e) => setSetting(ctl.key, e.target.checked));
        break;
      }
      case 'color': {
        wrap.innerHTML = `<label class="field-label" for="${id}">${ctl.label}</label>
          <div class="color-row"><input type="color" id="${id}" data-focus-key="${id}" value="${s[ctl.key]}"><div class="swatches"></div></div>`;
        const input = wrap.querySelector('input');
        input.addEventListener('input', () => live(input.value));
        input.addEventListener('change', commit);
        const sw = wrap.querySelector('.swatches');
        (ctl.swatches || []).forEach((hex) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.style.background = hex;
          b.title = hex;
          b.setAttribute('aria-label', `Color ${hex}`);
          b.setAttribute('aria-pressed', String(s[ctl.key] === hex));
          b.addEventListener('click', () => setSetting(ctl.key, hex));
          sw.appendChild(b);
        });
        break;
      }
      case 'button': {
        const btnLabel = typeof ctl.label === 'function' ? ctl.label(s) : ctl.label;
        wrap.innerHTML = `<button type="button" class="panel-btn ${ctl.primary ? 'primary' : ''}" data-focus-key="${id}">${btnLabel}</button>`;
        const b = wrap.querySelector('button');
        b.disabled = (ctl.disabled && ctl.disabled(s)) || (TOOLS[state.tool].needsImage !== false && !state.sourceId);
        b.addEventListener('click', ctl.action);
        break;
      }
      case 'select': {
        wrap.innerHTML = `<label class="field-label" for="${id}">${ctl.label}</label><select id="${id}" data-focus-key="${id}">${ctl.options.map(([v, l]) => `<option value="${v}" ${s[ctl.key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
        wrap.querySelector('select').addEventListener('change', (e) => {
          if (s === settingsOf(state.tool)) setSetting(ctl.key, e.target.value);
          else { pushHistory(); s[ctl.key] = e.target.value; afterStateChange(); }
        });
        break;
      }
      case 'levels': {
        // Barra de tonos: qué se elimina, qué se trama y qué queda sólido
        const lo = s.low / 255 * 100, hi = (1 - s.high / 255) * 100;
        const mid = lo + (hi - lo) * s.mid;
        wrap.innerHTML = `<div class="levels-bar" aria-hidden="true"><span class="lv-zone lv-off" style="width:${lo}%"></span><span class="lv-zone lv-solid" style="left:${hi}%;width:${100 - hi}%"></span><i style="left:${lo}%"></i><i class="lv-mid" style="left:${mid}%"></i><i style="left:${hi}%"></i></div>
          <div class="levels-legend"><span>Desaparece</span><span>Tramado</span><span>Sólido</span></div>`;
        break;
      }
      case 'help': {
        wrap.innerHTML = `<p class="field-help">${ctl.text(s)}</p>`;
        break;
      }
      case 'presets': {
        wrap.innerHTML = '<div class="presets" role="group" aria-label="Tamaños rápidos"></div>';
        const g = wrap.querySelector('.presets');
        ctl.options.forEach(([val, label]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          b.setAttribute('aria-pressed', String(s[ctl.key] === val));
          b.addEventListener('click', () => setSetting(ctl.key, val));
          g.appendChild(b);
        });
        break;
      }
      case 'note': {
        wrap.innerHTML = `<p class="panel-note">${ctl.text(s)}</p>`;
        break;
      }
      default:
        return;
    }
    el.appendChild(wrap);
  }

  /* Pequeño ayudante para paneles personalizados */
  function field(el, html) {
    const d = document.createElement('div');
    d.className = 'field';
    d.innerHTML = html;
    el.appendChild(d);
    return d;
  }
  function changeCompose(fn, rerender = true) {
    pushHistory();
    fn();
    if (rerender) renderPanelContent();
    renderHeading();
    schedulePreview();
    updateHistoryButtons();
    scheduleSave();
  }

  /* --- Paneles de "Crear diseño" --- */
  function renderDesignCanvasPanel(el) {
    const d = state.compose.diseno;
    const f = field(el, `<label class="field-label" for="design-preset">Tamaño</label><select id="design-preset" data-focus-key="design-preset"></select>`);
    const sel = f.querySelector('select');
    Object.entries(DESIGN_PRESETS).forEach(([key, p]) => {
      const o = new Option(`${p.label} (${p.w}×${p.h})`, key, false, d.preset === key);
      sel.add(o);
    });
    sel.addEventListener('change', () => changeCompose(() => {
      const p = DESIGN_PRESETS[sel.value];
      const kx = p.w / d.w, ky = p.h / d.h, kk = Math.min(kx, ky);
      // Reubica los elementos proporcionalmente al nuevo tamaño
      d.items.forEach((it) => {
        it.x *= kx; it.y *= ky;
        if (it.type === 'text') it.size *= kk; else { it.w *= kk; it.h *= kk; }
      });
      Object.assign(d, { preset: sel.value, w: p.w, h: p.h });
    }));
    const c = field(el, `<label class="check"><input type="checkbox" data-focus-key="design-transp" ${d.transparent ? 'checked' : ''}> Fondo transparente (para estampar)</label>`);
    c.querySelector('input').addEventListener('change', (e) => changeCompose(() => { d.transparent = e.target.checked; }));
    if (!d.transparent) {
      const col = field(el, `<label class="field-label" for="design-bg">Color de fondo</label><div class="color-row"><input type="color" id="design-bg" value="${d.bg}"><code>${d.bg}</code></div>`);
      const input = col.querySelector('input');
      let started = false;
      input.addEventListener('input', () => { if (!started) { pushHistory(); started = true; } d.bg = input.value; schedulePreview(); });
      input.addEventListener('change', () => { started = false; renderPanelContent(); scheduleSave(); });
    }
  }

  function renderDesignAddPanel(el) {
    const d = state.compose.diseno;
    const add = (it) => changeCompose(() => { d.items.push(it); d.selected = it.id; });
    const grid = document.createElement('div');
    grid.className = 'btn-row';
    const mk = (label, fn, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'panel-btn';
      b.innerHTML = label;
      b.disabled = !!disabled;
      b.addEventListener('click', fn);
      grid.appendChild(b);
    };
    mk('<span style="font:700 18px Georgia">T</span> Texto', () => add({
      id: uid(), type: 'text', text: 'Tu texto', font: FONTS[1][0], size: Math.round(d.w / 9), bold: false,
      color: '#1b2a6e', strokeColor: '#ffffff', strokeWidth: 0, x: d.w / 2, y: d.h / 2, rot: 0, opacity: 100,
    }));
    mk('▣ Imagen actual', () => add(makeImageItem(d, state.sourceId)), !state.sourceId);
    mk('⤒ Subir imagen', () => $('#extra-file-input').click());
    mk('■ Rectángulo', () => add({ id: uid(), type: 'rect', w: d.w * 0.5, h: d.h * 0.18, color: '#0d4fa3', x: d.w / 2, y: d.h / 2, rot: 0, opacity: 100 }));
    mk('● Círculo', () => add({ id: uid(), type: 'ellipse', w: d.w * 0.35, h: d.w * 0.35, color: '#87b2dd', x: d.w / 2, y: d.h / 2, rot: 0, opacity: 100 }));
    el.appendChild(grid);
    field(el, '<p class="panel-note">Tocá un elemento en el lienzo para seleccionarlo. Arrastralo para moverlo, usá el círculo de la esquina para agrandarlo y el de arriba para girarlo.</p>');
  }

  function renderItemProps(el, toolId) {
    const d = docOf(toolId);
    const it = selectedItem(toolId);
    if (!it) {
      field(el, `<p class="panel-note">${toolId === 'mockup'
        ? (state.sourceId ? 'Tocá el diseño sobre la prenda para ajustarlo.' : 'Subí tu diseño con el botón “Cambiar diseño”.')
        : 'Seleccioná un elemento tocándolo en el lienzo o desde “Capas”.'}</p>`);
      if (toolId === 'mockup' && d.items[0]) {
        const b = field(el, '<button type="button" class="panel-btn">Seleccionar el diseño</button>');
        b.querySelector('button').addEventListener('click', () => { d.selected = d.items[0].id; renderPanelContent(); schedulePreview(); });
      }
      return;
    }
    const rangeProp = (label, key, min, max, step, fmt = (v) => v) => {
      const f = field(el, `<label class="field-label" for="prop-${key}">${label} <b>${fmt(it[key])}</b></label><input type="range" id="prop-${key}" data-focus-key="prop-${key}" min="${min}" max="${max}" step="${step}" value="${it[key]}">`);
      const input = f.querySelector('input');
      const badge = f.querySelector('b');
      let started = false;
      input.addEventListener('input', () => {
        if (!started) { pushHistory(); started = true; }
        it[key] = Number(input.value);
        badge.textContent = fmt(it[key]);
        schedulePreview(true);
      });
      input.addEventListener('change', () => { started = false; scheduleSave(); });
    };

    if (it.type === 'text') {
      const t = field(el, `<label class="field-label" for="prop-text">Texto</label><textarea id="prop-text" data-focus-key="prop-text">${it.text.replace(/</g, '&lt;')}</textarea>`);
      const ta = t.querySelector('textarea');
      let started = false;
      ta.addEventListener('input', () => { if (!started) { pushHistory(); started = true; } it.text = ta.value || ' '; schedulePreview(true); });
      ta.addEventListener('change', () => { started = false; scheduleSave(); });

      const fsel = field(el, '<label class="field-label" for="prop-font">Tipografía</label><select id="prop-font" data-focus-key="prop-font"></select>').querySelector('select');
      FONTS.forEach(([fam, name]) => fsel.add(new Option(name, fam, false, it.font === fam)));
      fsel.addEventListener('change', () => changeCompose(() => { it.font = fsel.value; }));
      rangeProp('Tamaño', 'size', 8, Math.round(d.w / 2), 1, (v) => Math.round(v) + ' px');
      const b = field(el, `<label class="check"><input type="checkbox" data-focus-key="prop-bold" ${it.bold ? 'checked' : ''}> Negrita</label>`);
      b.querySelector('input').addEventListener('change', (e) => changeCompose(() => { it.bold = e.target.checked; }));
      colorProp(el, it, 'color', 'Color del texto');
      rangeProp('Contorno', 'strokeWidth', 0, 40, 1, (v) => (v ? v + ' px' : 'No'));
      if (it.strokeWidth > 0) colorProp(el, it, 'strokeColor', 'Color del contorno');
    } else if (it.type === 'shirt') {
      field(el, '<p class="panel-note">Remera de ejemplo. Reemplazala por tu diseño o cambiale el color.</p>');
      const row0 = document.createElement('div');
      row0.className = 'btn-row';
      row0.innerHTML = `<button type="button" class="panel-btn primary">⤒ Reemplazar por mi imagen</button><button type="button" class="panel-btn" ${state.sourceId ? '' : 'disabled'}>▣ Usar imagen actual</button>`;
      const [up, cur] = row0.querySelectorAll('button');
      up.addEventListener('click', () => { state.replaceItemId = it.id; $('#extra-file-input').click(); });
      cur.addEventListener('click', () => { state.replaceItemId = it.id; changeCompose(() => placeDesignImage(state.sourceId)); });
      el.appendChild(row0);
      const sw = field(el, '<span class="field-label">Color de la remera</span><div class="color-grid"></div>').querySelector('.color-grid');
      SHIRT_COLORS.forEach(([hex, name]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<i style="background:${hex}"></i>${name}`;
        b.setAttribute('aria-pressed', String(it.color === hex));
        b.addEventListener('click', () => changeCompose(() => { it.color = hex; }));
        sw.appendChild(b);
      });
      const v = field(el, '<span class="field-label">Vista</span><div class="segmented" role="group" aria-label="Vista"><button type="button" data-v="front">Frente</button><button type="button" data-v="back">Espalda</button></div>');
      v.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', String((it.view || 'front') === b.dataset.v));
        b.addEventListener('click', () => changeCompose(() => { it.view = b.dataset.v; }));
      });
      rangeProp('Tamaño', 'w', 60, Math.round(Math.max(d.w, d.h) * 1.4), 1, (v) => Math.round(v) + ' px');
      el.lastChild.querySelector('input').addEventListener('input', () => { it.h = it.w; });
    } else if (it.type === 'image') {
      const base = Math.max(it.w, it.h);
      const f = field(el, `<label class="field-label" for="prop-scale">Tamaño <b>${Math.round(it.w)} × ${Math.round(it.h)} px</b></label><input type="range" id="prop-scale" data-focus-key="prop-scale" min="20" max="${Math.round(Math.max(d.w, d.h) * 1.5)}" step="1" value="${Math.round(base)}">`);
      const input = f.querySelector('input');
      let started = false;
      input.addEventListener('input', () => {
        if (!started) { pushHistory(); started = true; }
        const k = Number(input.value) / Math.max(it.w, it.h);
        it.w *= k; it.h *= k;
        f.querySelector('b').textContent = `${Math.round(it.w)} × ${Math.round(it.h)} px`;
        schedulePreview(true);
      });
      input.addEventListener('change', () => { started = false; scheduleSave(); });
    } else {
      colorProp(el, it, 'color', 'Color');
      rangeProp('Ancho', 'w', 10, d.w * 1.5, 1, (v) => Math.round(v) + ' px');
      rangeProp('Alto', 'h', 10, d.h * 1.5, 1, (v) => Math.round(v) + ' px');
    }
    rangeProp('Rotación', 'rot', -180, 180, 1, (v) => v + '°');
    rangeProp('Opacidad', 'opacity', 10, 100, 1, (v) => v + '%');


    const row = document.createElement('div');
    row.className = 'btn-row';
    const btn = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'panel-btn'; b.innerHTML = label;
      b.addEventListener('click', fn);
      row.appendChild(b);
    };
    btn('⊕ Centrar', () => changeCompose(() => { it.x = d.w / 2; it.y = d.h / 2; }));
    if (toolId === 'diseno') {
      btn('⧉ Duplicar', () => changeCompose(() => {
        const copy = { ...it, id: uid(), x: it.x + d.w * 0.04, y: it.y + d.h * 0.04 };
        d.items.push(copy); d.selected = copy.id;
      }));
      btn('↑ Adelante', () => changeCompose(() => moveLayer(d, it, 1)));
      btn('↓ Atrás', () => changeCompose(() => moveLayer(d, it, -1)));
      btn('🗑 Eliminar', () => changeCompose(() => { d.items = d.items.filter((x) => x !== it); d.selected = null; }));
    }
    el.appendChild(row);
  }

  function colorProp(el, it, key, label) {
    const f = field(el, `<label class="field-label" for="prop-${key}">${label}</label><div class="color-row"><input type="color" id="prop-${key}" data-focus-key="prop-${key}" value="${it[key]}"><code>${it[key]}</code></div>`);
    const input = f.querySelector('input');
    let started = false;
    input.addEventListener('input', () => {
      if (!started) { pushHistory(); started = true; }
      it[key] = input.value;
      f.querySelector('code').textContent = input.value;
      schedulePreview(true);
    });
    input.addEventListener('change', () => { started = false; scheduleSave(); });
  }

  function moveLayer(d, it, dir) {
    const i = d.items.indexOf(it);
    const j = clamp(i + dir, 0, d.items.length - 1);
    d.items.splice(i, 1);
    d.items.splice(j, 0, it);
  }

  function layerThumb(it) {
    if (it.type === 'image') {
      const img = images.get(it.imgId);
      if (img) {
        const t = fitInside(img.preview, 88);
        t.className = 'layer-thumb-canvas';
        return t;
      }
    }
    const span = document.createElement('span');
    span.className = 'layer-thumb';
    if (it.type === 'shirt' || ['rect', 'round', 'ellipse', 'triangle', 'star', 'line'].includes(it.type)) {
      const cv = createCanvas(88, 72);
      const kk = Math.min(70 / it.w, 60 / it.h);
      drawItem(cv.getContext('2d'), { ...it, x: 44 / kk, y: 36 / kk, rot: 0 }, kk, true);
      cv.className = 'layer-thumb-canvas';
      return cv;
    }
    span.textContent = it.type === 'text' ? 'T' : '●';
    if (it.color && it.type !== 'text') span.style.color = it.color;
    return span;
  }

  function renderLayers(el, toolId) {
    const d = docOf(toolId);
    if (!d.items.length) { field(el, '<p class="panel-note">Todavía no hay elementos. Agregalos desde “Agregar”.</p>'); return; }
    const ul = document.createElement('ul');
    ul.className = 'layer-list';
    d.items.slice().reverse().forEach((it) => {
      const li = document.createElement('li');
      li.className = d.selected === it.id ? 'is-selected' : '';
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-pressed', String(d.selected === it.id));
      const name = it.type === 'text' ? `“${it.text.slice(0, 24)}”` : ({ image: 'Imagen', shirt: 'Remera de ejemplo', rect: 'Rectángulo', round: 'Redondeado', ellipse: 'Círculo', triangle: 'Triángulo', star: 'Estrella', line: 'Línea' }[it.type] || 'Forma');
      li.appendChild(layerThumb(it));
      const label = document.createElement('span');
      label.className = 'layer-name';
      label.innerHTML = `${name.replace(/</g, '&lt;')}<small>${it.type === 'text' ? 'Texto' : 'Elemento'}</small>`;
      li.appendChild(label);
      const actions = document.createElement('span');
      actions.className = 'layer-actions';
      actions.innerHTML = '<button type="button" class="icon-btn" aria-label="Subir capa">↑</button><button type="button" class="icon-btn" aria-label="Bajar capa">↓</button><button type="button" class="icon-btn danger" aria-label="Eliminar">✕</button>';
      const [up, down, del] = actions.querySelectorAll('button');
      up.addEventListener('click', (e) => { e.stopPropagation(); changeCompose(() => moveLayer(d, it, 1)); });
      down.addEventListener('click', (e) => { e.stopPropagation(); changeCompose(() => moveLayer(d, it, -1)); });
      del.addEventListener('click', (e) => { e.stopPropagation(); changeCompose(() => { d.items = d.items.filter((x) => x !== it); if (d.selected === it.id) d.selected = null; }); });
      li.appendChild(actions);
      const select = () => { d.selected = it.id; renderPanelContent(); schedulePreview(); };
      li.addEventListener('click', select);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
      ul.appendChild(li);
    });
    el.appendChild(ul);
  }

  /* =========================================================
     CREAR DISEÑO: varios diseños, tamaños, plantillas y descarga
     ========================================================= */

  /* Remera de ejemplo (reutiliza la remera del mockup), en caché por color y tamaño */
  const designShirtCache = new Map();
  function designShirt(color, px, view = 'front') {
    const bucket = px <= 160 ? 160 : px <= 400 ? 400 : px <= 800 ? 800 : 1254;
    const key = `${color}|${bucket}|${view}`;
    if (!designShirtCache.has(key)) {
      if (designShirtCache.size > 24) designShirtCache.delete(designShirtCache.keys().next().value);
      const prev = shirtCache;
      designShirtCache.set(key, renderShirt(bucket / MOCK_SIZE, color, 'flat', view));
      shirtCache = prev;     // no pisa la remera en caché del mockup
    }
    return designShirtCache.get(key);
  }

  /* Imagen nueva: si hay una remera de ejemplo seleccionada (o para reemplazar), la cambia */
  function placeDesignImage(imgId) {
    const d = state.compose.diseno;
    const target = d.items.find((i) => i.id === (state.replaceItemId || d.selected));
    const replace = target && target.type === 'shirt';
    state.replaceItemId = null;
    const it = makeImageItem(d, imgId);
    if (replace) {
      // Ocupa el mismo lugar que la remera de ejemplo (la remera ocupa ~84 % de su caja)
      const box = target.w * 0.84;
      const k = Math.min(box / it.w, box / it.h);
      Object.assign(it, { x: target.x, y: target.y, w: it.w * k, h: it.h * k, rot: target.rot });
      d.items.splice(d.items.indexOf(target), 1, it);
    } else {
      d.items.push(it);
    }
    d.selected = it.id;
  }

  function addDesignText() {
    const d = state.compose.diseno;
    loadDesignFonts();
    changeCompose(() => {
      const it = { id: uid(), type: 'text', text: 'Tu texto', font: FONTS[1][0], size: Math.round(d.w / 9), bold: false,
        color: luminance(d.bg) < 0.5 && !d.transparent ? '#ffffff' : '#1b2a6e', strokeColor: '#ffffff', strokeWidth: 0, x: d.w / 2, y: d.h / 2, rot: 0, opacity: 100 };
      d.items.push(it);
      d.selected = it.id;
    });
    openPanel('design-props');
    setTimeout(() => { const ta = $('#prop-text'); if (ta) { ta.focus(); ta.select(); } }, 50);
  }

  /* --- Varios diseños --- */
  function togglePagesStrip() {
    state.compose.showPages = !state.compose.showPages;
    renderPagesStrip(true);
    scheduleSave();
  }
  function selectDesign(i) {
    const c = state.compose;
    if (i === c.designIndex) return;
    c.designIndex = i;
    syncDesignRef();
    state.zoom = 1;
    renderPagesStrip(true);
    renderPanelContent();
    renderHeading();
    schedulePreview(true);
    scheduleSave();
  }
  function addDesign(copyFrom) {
    const c = state.compose;
    if (c.designs.length >= MAX_DESIGNS) { toast(`Podés tener hasta ${MAX_DESIGNS} diseños.`); return; }
    changeCompose(() => {
      const n = c.designs.length + 1;
      const d = copyFrom ? { ...JSON.parse(JSON.stringify(copyFrom)), name: `${copyFrom.name} (copia)`, selected: null } : newDesign(n);
      if (copyFrom) d.items.forEach((it) => { it.id = uid(); });
      c.designs.splice(c.designIndex + 1, 0, d);
      c.designIndex += 1;
      syncDesignRef();
    });
    renderPagesStrip(true);
  }
  function deleteDesign() {
    const c = state.compose;
    if (c.designs.length < 2) return;
    changeCompose(() => {
      c.designs.splice(c.designIndex, 1);
      c.designIndex = Math.max(0, c.designIndex - 1);
      syncDesignRef();
    });
    renderPagesStrip(true);
    toast('Diseño eliminado.', { label: 'Deshacer', fn: undo });
  }

  /* Tira de miniaturas arriba del visor */
  let pagesSig = '';
  let pagesTimer = 0;
  function renderPagesStrip(force) {
    const el = $('#pages-strip');
    const c = state.compose;
    const show = state.tool === 'diseno' && c.showPages;
    el.hidden = !show;
    if (!show) { pagesSig = ''; return; }
    const sig = `${c.designs.length}|${c.designIndex}|${c.designs.map((d) => d.name).join('/')}`;
    if (force || sig !== pagesSig) {
      pagesSig = sig;
      el.innerHTML = `<div class="pages-head"><strong>${c.diseno.name.replace(/</g, '&lt;')}</strong>
        <span class="pages-actions">
          <button type="button" class="icon-btn" data-act="rename" title="Cambiar nombre" aria-label="Cambiar nombre del diseño">✎</button>
          <button type="button" class="icon-btn" data-act="dup" title="Duplicar diseño" aria-label="Duplicar diseño">⧉</button>
          <button type="button" class="icon-btn danger" data-act="del" title="Eliminar diseño" aria-label="Eliminar diseño" ${c.designs.length < 2 ? 'disabled' : ''}>🗑</button>
          <small>${c.designs.length}/${MAX_DESIGNS} diseños</small>
        </span></div><div class="pages-list" role="list"></div>`;
      const list = el.querySelector('.pages-list');
      c.designs.forEach((d, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'page-thumb';
        b.setAttribute('role', 'listitem');
        b.setAttribute('aria-current', String(i === c.designIndex));
        b.setAttribute('aria-label', `Abrir ${d.name}`);
        b.innerHTML = `<canvas width="90" height="100"></canvas><span>${d.name.replace(/</g, '&lt;')}</span>`;
        b.addEventListener('click', () => selectDesign(i));
        list.appendChild(b);
      });
      if (c.designs.length < MAX_DESIGNS) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'page-thumb page-add';
        add.innerHTML = '<b aria-hidden="true">+</b><span>Nuevo diseño</span>';
        add.addEventListener('click', () => addDesign());
        list.appendChild(add);
      }
      el.querySelector('[data-act="dup"]').addEventListener('click', () => addDesign(c.diseno));
      el.querySelector('[data-act="del"]').addEventListener('click', deleteDesign);
      el.querySelector('[data-act="rename"]').addEventListener('click', () => renameDesign());
    }
    clearTimeout(pagesTimer);
    pagesTimer = setTimeout(drawPageThumbs, force ? 0 : 400);
  }
  function drawPageThumbs() {
    const c = state.compose;
    $$('#pages-strip .page-thumb canvas').forEach((cv, i) => {
      const d = c.designs[i];
      if (!d) return;
      const k = Math.min(90 / d.w, 100 / d.h);
      cv.width = Math.round(d.w * k);
      cv.height = Math.round(d.h * k);
      drawDesign(cv, k, true, d);
    });
  }
  function renameDesign() {
    const head = $('#pages-strip .pages-head strong');
    const d = state.compose.diseno;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = d.name;
    input.className = 'page-name-input';
    input.setAttribute('aria-label', 'Nombre del diseño');
    head.replaceWith(input);
    input.focus();
    input.select();
    const done = () => {
      const v = input.value.trim().slice(0, 40);
      if (v && v !== d.name) { pushHistory(); d.name = v; scheduleSave(); }
      renderPagesStrip(true);
    };
    input.addEventListener('blur', done);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = d.name; input.blur(); } });
  }

  /* --- Tamaño --- */
  function resizeDesign(d, w, h) {
    const kx = w / d.w, ky = h / d.h, kk = Math.min(kx, ky);
    d.items.forEach((it) => {
      it.x *= kx; it.y *= ky;
      if (it.type === 'text') it.size *= kk; else { it.w *= kk; it.h *= kk; }
    });
    d.w = w; d.h = h;
  }
  function renderDesignSizePanel(el) {
    const d = state.compose.diseno;
    const list = document.createElement('div');
    list.className = 'menu-list';
    Object.entries(DESIGN_PRESETS).forEach(([key, p]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span>${p.label}</span><small>${p.w} × ${p.h}</small>`;
      b.setAttribute('aria-pressed', String(d.preset === key));
      b.addEventListener('click', () => changeCompose(() => { resizeDesign(d, p.w, p.h); d.preset = key; }));
      list.appendChild(b);
    });
    el.appendChild(list);
    const f = field(el, `<span class="field-label">Medida personalizada</span>
      <div class="dims"><label><span>Ancho (px)</span><span class="unit-input"><input type="number" id="design-w" min="100" max="8000" value="${d.w}" inputmode="numeric"><i>px</i></span></label>
      <label><span>Alto (px)</span><span class="unit-input"><input type="number" id="design-h" min="100" max="8000" value="${d.h}" inputmode="numeric"><i>px</i></span></label></div>`);
    const apply = () => {
      const w = clamp(Math.round(Number($('#design-w').value) || d.w), 100, 8000);
      const h = clamp(Math.round(Number($('#design-h').value) || d.h), 100, 8000);
      if (w === d.w && h === d.h) return;
      changeCompose(() => { resizeDesign(d, w, h); d.preset = 'custom'; });
    };
    f.querySelectorAll('input').forEach((i) => i.addEventListener('change', apply));
    field(el, `<p class="field-help">A 300 ppp: ${fmtCm(pxToCm(d.w))} × ${fmtCm(pxToCm(d.h))}.</p>`);
    const t = field(el, `<label class="check"><input type="checkbox" ${d.transparent ? 'checked' : ''}> Fondo transparente</label>`);
    t.querySelector('input').addEventListener('change', (e) => changeCompose(() => { d.transparent = e.target.checked; }));
    if (!d.transparent) {
      const col = field(el, `<label class="field-label" for="design-bg">Color de fondo</label><div class="color-row"><input type="color" id="design-bg" value="${d.bg}"><div class="swatches"></div></div>`);
      const sw = col.querySelector('.swatches');
      ['#f4f1ec', '#ffffff', '#121212', '#1b2a6e', '#ff5a3c', '#ffd23f', '#c8f13a', '#efe9ff'].forEach((hex) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.background = hex;
        b.setAttribute('aria-label', `Fondo ${hex}`);
        b.setAttribute('aria-pressed', String(d.bg === hex));
        b.addEventListener('click', () => changeCompose(() => { d.bg = hex; }));
        sw.appendChild(b);
      });
      const input = col.querySelector('input');
      let started = false;
      input.addEventListener('input', () => { if (!started) { pushHistory(); started = true; } d.bg = input.value; schedulePreview(true); });
      input.addEventListener('change', () => { started = false; renderPanelContent(); scheduleSave(); });
    }
  }

  /* --- Formas --- */
  function renderShapesPanel(el) {
    const d = state.compose.diseno;
    const grid = document.createElement('div');
    grid.className = 'shape-grid';
    const S = Math.min(d.w, d.h);
    [
      ['rect', 'Rectángulo', S * 0.5, S * 0.3],
      ['round', 'Redondeado', S * 0.5, S * 0.3],
      ['ellipse', 'Círculo', S * 0.4, S * 0.4],
      ['triangle', 'Triángulo', S * 0.4, S * 0.36],
      ['star', 'Estrella', S * 0.4, S * 0.4],
      ['line', 'Línea', S * 0.6, Math.max(6, S * 0.012)],
    ].forEach(([type, label, w, h]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', `Agregar ${label.toLowerCase()}`);
      const cv = createCanvas(44, 44);
      drawItem(cv.getContext('2d'), { type, w: 30, h: type === 'line' ? 4 : type === 'rect' || type === 'round' ? 20 : 30, x: 22, y: 22, rot: 0, color: '#0d4fa3', opacity: 100 }, 1, true);
      b.appendChild(cv);
      b.insertAdjacentHTML('beforeend', `<span>${label}</span>`);
      b.addEventListener('click', () => changeCompose(() => {
        const it = { id: uid(), type, w, h, color: '#0d4fa3', x: d.w / 2, y: d.h / 2, rot: 0, opacity: 100 };
        d.items.push(it);
        d.selected = it.id;
      }));
      grid.appendChild(b);
    });
    el.appendChild(grid);
    const sh = field(el, '<button type="button" class="panel-btn">👕 Agregar remera de ejemplo</button>').querySelector('button');
    sh.addEventListener('click', () => changeCompose(() => {
      const it = { id: uid(), type: 'shirt', color: '#ffffff', view: 'front', w: S * 0.6, h: S * 0.6, x: d.w / 2, y: d.h / 2, rot: 0, opacity: 100 };
      d.items.push(it);
      d.selected = it.id;
    }));
    field(el, '<p class="field-help">Tocá una forma para agregarla. Después cambiá su color y tamaño desde “Editar elemento”.</p>');
  }

  /* --- Plantillas --- */
  const TPL_CATS = [['all', 'Todas'], ['pro', 'Profesionales'], ['min', 'Minimalistas'], ['urb', 'Urbanas'], ['promo', 'Promociones'], ['bold', 'Llamativas']];
  const F = { serif: '"Playfair Display", Georgia, serif', anton: 'Anton, Impact, sans-serif', mont: 'Montserrat, Arial, sans-serif', inter: 'Inter, Arial, sans-serif', marker: '"Permanent Marker", cursive' };
  function tplBuilder(d) {
    const W = d.w, H = d.h, S = Math.min(W, H);
    const base = { rot: 0, opacity: 100 };
    return {
      text: (text, fx, fy, size, font, color, bold = false) => ({ ...base, id: uid(), type: 'text', text, font, size: W * size, bold, color, strokeColor: '#ffffff', strokeWidth: 0, x: W * fx, y: H * fy }),
      rect: (fx, fy, fw, fh, color, rot = 0) => ({ ...base, id: uid(), type: 'rect', w: W * fw, h: H * fh, color, x: W * fx, y: H * fy, rot }),
      circ: (fx, fy, fd, color) => ({ ...base, id: uid(), type: 'ellipse', w: W * fd, h: W * fd, color, x: W * fx, y: H * fy }),
      shirt: (fx, fy, fs, color, view = 'front') => ({ ...base, id: uid(), type: 'shirt', color, view, w: S * fs, h: S * fs, x: W * fx, y: H * fy }),
    };
  }
  const TEMPLATES = [
    { id: 'esencial', name: 'Esencial', cat: 'min', catLabel: 'Minimalista', fmt: 'feed', bg: '#f3f2ef',
      build: (t) => [t.text('TU MARCA', 0.5, 0.07, 0.028, F.mont, '#555555', true), t.text('Menos ruido.\nMás estilo.', 0.5, 0.2, 0.075, F.serif, '#222222'),
        t.shirt(0.5, 0.55, 0.68, '#ffffff'), t.text('NUEVA COLECCIÓN · DISPONIBLE YA', 0.5, 0.88, 0.026, F.mont, '#333333', true), t.text('@tuestampasf', 0.5, 0.93, 0.024, F.inter, '#777777')] },
    { id: 'drop', name: 'Nuevo drop', cat: 'urb', catLabel: 'Urbana', fmt: 'feed', bg: '#121212',
      build: (t) => [t.circ(0.62, 0.56, 0.66, '#c8f13a'), t.text('NUEVO\nDROP', 0.27, 0.17, 0.15, F.anton, '#ffffff'),
        t.shirt(0.55, 0.58, 0.66, '#f4f2ee'), t.rect(0.27, 0.86, 0.38, 0.05, '#c8f13a'), t.text('DISPONIBLE YA', 0.27, 0.86, 0.032, F.anton, '#121212'),
        t.text('Edición limitada. Encargá la tuya.', 0.5, 0.94, 0.024, F.inter, '#cfcfcf')] },
    { id: 'editorial', name: 'Colección editorial', cat: 'pro', catLabel: 'Profesional', fmt: 'feed', bg: '#ebe8e2',
      build: (t) => [t.rect(0.76, 0.5, 0.48, 1, '#d3dad3'), t.text('La nueva\nesencia.', 0.27, 0.2, 0.07, F.serif, '#2b2b2b'),
        t.shirt(0.66, 0.52, 0.62, '#ffffff'), t.text('Diseñá tu\nremera ideal.', 0.22, 0.72, 0.035, F.mont, '#444444'), t.text('COLECCIÓN 2026', 0.22, 0.9, 0.026, F.mont, '#555555', true)] },
    { id: 'promo', name: 'Promo destacada', cat: 'promo', catLabel: 'Promocional', fmt: 'feed', bg: '#ff5a3c',
      build: (t) => [t.text('PRECIO\nESPECIAL', 0.5, 0.16, 0.12, F.anton, '#1a1a1a'), t.circ(0.5, 0.55, 0.6, '#ffd23f'),
        t.shirt(0.5, 0.56, 0.62, '#ffffff'), t.rect(0.5, 0.88, 0.62, 0.07, '#1a1a1a'), t.text('¡TE ESPERAMOS!', 0.5, 0.88, 0.045, F.anton, '#ffffff')] },
    { id: 'idea', name: 'Tu idea, tu remera', cat: 'bold', catLabel: 'Artística', fmt: 'feed', bg: '#efe9ff',
      build: (t) => [t.circ(0.28, 0.62, 0.62, '#b9a3ff'), t.rect(0.84, 0.45, 0.3, 0.6, '#ffe066', 8), t.text('Tu idea.\nTu remera.', 0.33, 0.14, 0.08, F.serif, '#3b2a7a', true),
        t.shirt(0.52, 0.58, 0.64, '#ffffff'), t.text('Pedí tu diseño personalizado', 0.5, 0.92, 0.03, F.mont, '#3b2a7a')] },
    { id: 'dos', name: 'Dos estilos', cat: 'pro', catLabel: 'Catálogo', fmt: 'feed', bg: '#eef1f6',
      build: (t) => [t.text('Elegí tu favorita.', 0.5, 0.1, 0.06, F.serif, '#1b2a6e'), t.shirt(0.28, 0.47, 0.5, '#ffffff'), t.shirt(0.72, 0.47, 0.5, '#9ea3ab'),
        t.text('CLÁSICA', 0.28, 0.73, 0.03, F.mont, '#1b2a6e', true), t.text('URBANA', 0.72, 0.73, 0.03, F.mont, '#1b2a6e', true), t.text('Consultá talles y colores', 0.5, 0.9, 0.026, F.inter, '#555555')] },
    { id: 'preventa', name: 'Preventa', cat: 'promo', catLabel: 'Historia', fmt: 'story', bg: '#1f4d3a',
      build: (t) => [t.circ(0.5, 0.55, 0.84, '#2b6650'), t.text('SE VIENE\nTU PRÓXIMA\nFAVORITA.', 0.36, 0.15, 0.075, F.anton, '#ffffff'),
        t.shirt(0.5, 0.56, 0.78, '#ffffff'), t.rect(0.5, 0.86, 0.62, 0.05, '#d8f3a7'), t.text('PREVENTA ABIERTA', 0.5, 0.86, 0.04, F.anton, '#1f4d3a')] },
    { id: 'actitud', name: 'Actitud urbana', cat: 'urb', catLabel: 'Artística', fmt: 'feed', bg: '#f4ead7',
      build: (t) => [t.rect(0.55, 0.56, 1.4, 0.34, '#2f5bea', -12), t.circ(0.82, 0.16, 0.2, '#ff6a2b'), t.text('VESTÍ\nTU ACTITUD', 0.32, 0.15, 0.085, F.marker, '#1a1a1a'),
        t.shirt(0.5, 0.58, 0.64, '#ffffff'), t.text('SIN ETIQUETAS.', 0.28, 0.9, 0.04, F.anton, '#1a1a1a')] },
    { id: 'lados', name: 'Diseño en cada lado', cat: 'urb', catLabel: 'Urbana', fmt: 'feed', bg: '#1d2433',
      build: (t) => [t.text('DISEÑO EN\nCADA LADO.', 0.3, 0.13, 0.075, F.anton, '#ffffff'), t.shirt(0.28, 0.52, 0.5, '#f4f2ee'), t.shirt(0.72, 0.52, 0.5, '#f4f2ee', 'back'),
        t.text('FRENTE', 0.28, 0.78, 0.03, F.mont, '#c9d3ea', true), t.text('ESPALDA', 0.72, 0.78, 0.03, F.mont, '#c9d3ea', true)] },
    { id: 'favorita', name: 'Tu nueva favorita', cat: 'min', catLabel: 'Minimalista', fmt: 'feed', bg: '#ffe3ec',
      build: (t) => [t.text('Tu nueva favorita.', 0.5, 0.11, 0.06, F.serif, '#5a2340'), t.circ(0.5, 0.54, 0.6, '#ff9fbf'),
        t.shirt(0.5, 0.55, 0.62, '#ffffff'), t.rect(0.5, 0.88, 0.5, 0.06, '#5a2340'), t.text('COMPRÁ ONLINE', 0.5, 0.88, 0.035, F.mont, '#ffffff', true)] },
  ];
  const tplThumbs = new Map();
  let tplFilter = 'all';
  function templateThumb(tpl) {
    if (tplThumbs.has(tpl.id)) return tplThumbs.get(tpl.id);
    const p = DESIGN_PRESETS[tpl.fmt];
    const doc = { w: p.w, h: p.h, bg: tpl.bg, transparent: false, items: [] };
    doc.items = tpl.build(tplBuilder(doc));
    const k = 150 / p.h;
    const cv = createCanvas(p.w * k, p.h * k);
    drawDesign(cv, k, true, doc);
    tplThumbs.set(tpl.id, cv);
    return cv;
  }
  function renderTemplatesPanel(el) {
    loadDesignFonts();
    field(el, '<p class="field-help">Elegí una base y cambiá los textos, colores y mockups. Las remeras de ejemplo se pueden reemplazar por tu diseño.</p>');
    const chips = document.createElement('div');
    chips.className = 'filter-chips';
    TPL_CATS.forEach(([key, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(tplFilter === key));
      b.addEventListener('click', () => { tplFilter = key; renderPanelContent(); });
      chips.appendChild(b);
    });
    el.appendChild(chips);
    const grid = document.createElement('div');
    grid.className = 'tpl-grid';
    TEMPLATES.filter((t) => tplFilter === 'all' || t.cat === tplFilter).forEach((tpl) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tpl-card';
      const thumb = cloneCanvas(templateThumb(tpl));
      b.appendChild(thumb);
      b.insertAdjacentHTML('beforeend', `<strong>${tpl.name}</strong><small>${tpl.catLabel} · ${tpl.fmt === 'story' ? 'Historia' : 'Feed'}</small>`);
      b.addEventListener('click', () => applyTemplate(tpl));
      grid.appendChild(b);
    });
    el.appendChild(grid);
  }
  function applyTemplate(tpl) {
    const d = state.compose.diseno;
    const p = DESIGN_PRESETS[tpl.fmt];
    changeCompose(() => {
      d.w = p.w; d.h = p.h; d.preset = tpl.fmt;
      d.bg = tpl.bg;
      d.transparent = false;
      d.items = tpl.build(tplBuilder(d));
      d.selected = null;
    });
    closePanel();
    toast(`Plantilla “${tpl.name}” aplicada. Tocá una remera para reemplazarla por tu diseño.`, { label: 'Deshacer', fn: undo });
  }

  /* --- Descarga --- */
  function renderDesignExportPanel(el) {
    const c = state.compose;
    const d = c.diseno;
    renderControl(el, { type: 'select', key: 'designFormat', label: 'Formato', options: [['png', 'PNG'], ['jpg', 'JPG']] }, c);
    if (c.designFormat === 'jpg' && d.transparent) field(el, '<p class="field-help">Con fondo transparente se descarga en PNG.</p>');
    if (c.designs.length > 1) {
      const f = field(el, `<span class="field-label">Qué descargar</span><div class="segmented" role="group" aria-label="Qué descargar"><button type="button" data-v="one">Este diseño</button><button type="button" data-v="all">Todos (${c.designs.length})</button></div>`);
      f.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', String(c.designScope === b.dataset.v));
        b.addEventListener('click', () => { c.designScope = b.dataset.v; renderPanelContent(); renderHeading(); scheduleSave(); });
      });
    }
    const send = field(el, '<button type="button" class="panel-btn">▤ Pasar al lienzo listo para mandar a imprimir</button>').querySelector('button');
    send.addEventListener('click', () => { closePanel(); sendTo('lienzo'); });
    field(el, '<p class="field-help">Al lienzo pasa sin el fondo y sin márgenes vacíos, con bordes sólidos para DTF.</p>');
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.innerHTML = '<button type="button" class="panel-btn">Cancelar</button><button type="button" class="panel-btn primary">↓ Descargar</button>';
    const [cancel, dl] = row.querySelectorAll('button');
    cancel.addEventListener('click', closePanel);
    dl.addEventListener('click', () => { closePanel(); download(); });
    el.appendChild(row);
  }

  /* --- Paneles de "Crear mockup" --- */
  const SHIRT_COLORS = [
    ['#f4f2ee', 'Blanco'], ['#1d1d1f', 'Negro'], ['#c62828', 'Rojo'], ['#1b2a6e', 'Azul oscuro'],
    ['#87b2dd', 'Celeste'], ['#9ea3ab', 'Gris'], ['#f4a7c3', 'Rosa'], ['#6b7f5a', 'Verde vintage'],
    ['#e2b33c', 'Amarillo'], ['#7a5236', 'Marrón'],
  ];

  /* Miniatura de cada modelo para el selector */
  function mockThumb(tpl) {
    const c = createCanvas(96, 96);
    const x = c.getContext('2d');
    if (isRealTemplate(tpl)) {
      const e = loadRealPhoto(tpl, 'front', '#1d1d1f');
      x.fillStyle = '#d6d6d9';
      x.fillRect(0, 0, 96, 96);
      if (e.status === 'ready') x.drawImage(e.photo, 0, 0, 96, 96);
      return c;
    }
    if (isPhotoTemplate(tpl)) {
      const e = loadPhotoTemplate(tpl);
      x.fillStyle = '#e7e9ee';
      x.fillRect(0, 0, 96, 96);
      if (e.status === 'ready') x.drawImage(e.photo, 0, 0, 96, 96);
      return c;
    }
    if (tpl === 'photo') {
      x.fillStyle = '#e7e9ee';
      x.fillRect(0, 0, 96, 96);
      x.fillStyle = '#8b93a5';
      x.beginPath(); x.arc(32, 34, 9, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.moveTo(8, 84); x.lineTo(40, 50); x.lineTo(58, 66); x.lineTo(70, 56); x.lineTo(90, 84); x.closePath(); x.fill();
      return c;
    }
    const k = 96 / MOCK_SIZE;
    const T = shirtTransform(tpl);
    x.setTransform(k * T.sc, 0, 0, k * T.sc, k * T.tx, k * T.ty);
    if (tpl === 'hanger') { x.lineWidth = 14; x.strokeStyle = '#7d828c'; x.stroke(new Path2D('M600 175L600 92C600 66 628 54 628 30C628 4 604 -8 584 6')); }
    x.fillStyle = '#d4d7de';
    x.fill(new Path2D(SHIRT_PATHS[tpl]));
    return c;
  }

  function renderMockupBasePanel(el) {
    const m = state.compose.mockup;
    const current = m.base === 'photo' ? 'photo' : m.template;
    const list = document.createElement('div');
    list.className = 'mock-templates';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Elegir mockup');
    [
      ['flat', MOCK_TEMPLATES.flat.label, MOCK_TEMPLATES.flat.sub],
      ['hanger', MOCK_TEMPLATES.hanger.label, MOCK_TEMPLATES.hanger.sub],
      ['model', MOCK_TEMPLATES.model.label, MOCK_TEMPLATES.model.sub],
      ['foto-percha', MOCK_TEMPLATES['foto-percha'].label, MOCK_TEMPLATES['foto-percha'].sub],
      ['foto-modelo', MOCK_TEMPLATES['foto-modelo'].label, MOCK_TEMPLATES['foto-modelo'].sub],
      ['photo', 'Usar mi foto', 'Usá una foto completa de tu producto'],
    ].forEach(([key, label, sub]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mock-template';
      b.setAttribute('aria-pressed', String(current === key));
      b.appendChild(mockThumb(key));
      const t = document.createElement('span');
      t.innerHTML = `<strong>${label}</strong><small>${sub}</small>`;
      b.appendChild(t);
      b.addEventListener('click', () => {
        if (key === 'photo') {
          if (!m.photoId) { $('#photo-file-input').click(); return; }
          changeCompose(() => setMockupBase('photo'));
        } else {
          changeCompose(() => {
            const prevArea = printArea();
            m.template = key;
            if (MOCK_TEMPLATES[key].frontOnly) m.view = 'front';
            if (isRealTemplate(key)) m.shirtColor = nearestReal(m.shirtColor)[0];
            setMockupBase('shirt');
            // La estampa se reubica en la zona de estampa del nuevo modelo
            const it = m.items[0];
            if (it) {
              const a = printArea();
              const f = a.w / prevArea.w;
              it.x = a.x + (it.x - prevArea.x) * f;
              it.y = a.y + (it.y - prevArea.y) * f;
              it.w *= f; it.h *= f;
            }
          });
        }
      });
      list.appendChild(b);
    });
    el.appendChild(list);

    if (m.base === 'photo') {
      const b = field(el, '<button type="button" class="panel-btn">⤒ Cambiar foto</button>').querySelector('button');
      b.addEventListener('click', () => $('#photo-file-input').click());
      field(el, '<p class="panel-note">Usá una foto de frente de la prenda, con buena luz y el producto completo.</p>');
      return;
    }

    if (!MOCK_TEMPLATES[m.template].frontOnly) {
    const v = field(el, '<span class="field-label">Vista de la remera</span><div class="segmented" role="group" aria-label="Vista de la remera"><button type="button" data-v="front">Frente</button><button type="button" data-v="back">Espalda</button></div>');
    v.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(m.view === b.dataset.v));
      b.addEventListener('click', () => { if (m.view !== b.dataset.v) changeCompose(() => { m.view = b.dataset.v; }); });
    });
    }

    if (isRealTemplate(m.template)) {
      const g = field(el, '<span class="field-label">Color de la remera</span><div class="color-grid"></div>').querySelector('.color-grid');
      REAL_COLORS.forEach(([hex, name]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<i style="background:${hex}"></i>${name}`;
        b.setAttribute('aria-pressed', String(m.shirtColor === hex));
        b.addEventListener('click', () => changeCompose(() => { m.shirtColor = hex; }));
        g.appendChild(b);
      });
      field(el, '<p class="field-help">Fotos reales de las remeras de Tu Estampa SF. La estampa sigue los pliegues de la tela.</p>');
      return;
    }
    const grid = field(el, '<span class="field-label">Color de la remera</span><div class="color-grid"></div>').querySelector('.color-grid');
    SHIRT_COLORS.forEach(([hex, name]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<i style="background:${hex}"></i>${name}`;
      b.setAttribute('aria-pressed', String(m.shirtColor === hex));
      b.addEventListener('click', () => changeCompose(() => { m.shirtColor = hex; }));
      grid.appendChild(b);
    });
    const col = field(el, `<label class="field-label" for="shirt-custom">Otro color</label><div class="color-row"><input type="color" id="shirt-custom" value="${m.shirtColor}"><code>${m.shirtColor}</code></div>`).querySelector('input');
    let started = false;
    col.addEventListener('input', () => { if (!started) { pushHistory(); started = true; } m.shirtColor = col.value; schedulePreview(true); });
    col.addEventListener('change', () => { started = false; renderPanelContent(); scheduleSave(); });
    field(el, '<p class="field-help">El color conserva las luces, sombras y textura de la tela.</p>');
  }

  function renderMockupSettingsPanel(el) {
    const m = state.compose.mockup;
    const f = field(el, '<span class="field-label">Fusión con la tela</span><div class="segmented segmented-2x2" role="group" aria-label="Fusión con la tela"></div>');
    const g = f.querySelector('.segmented');
    Object.entries(FUSION).forEach(([key, fx]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = fx.label;
      b.setAttribute('aria-pressed', String(m.fusion === key));
      b.addEventListener('click', () => { if (m.fusion !== key) changeCompose(() => { m.fusion = key; }); });
      g.appendChild(b);
    });
    field(el, '<p class="field-help">“Conservar colores” y “Suave” mantienen los colores de la estampa y suman las luces y sombras de la tela. “Multiplicar” mezcla el diseño con el color de la remera.</p>');
    const d = field(el, '<span class="field-label">Archivo de descarga</span><div class="segmented" role="group" aria-label="Archivo de descarga"><button type="button" data-v="jpg">JPG · Recomendado</button><button type="button" data-v="png">PNG</button></div>');
    d.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(m.format === b.dataset.v));
      b.addEventListener('click', () => { if (m.format !== b.dataset.v) changeCompose(() => { m.format = b.dataset.v; }); });
    });
    field(el, '<p class="field-help">JPG: remera sobre fondo blanco, liviano para compartir. PNG: fondo transparente.</p>');
  }

  function setMockupBase(base) {
    const m = state.compose.mockup;
    const oldW = m.w, oldH = m.h;
    m.base = base;
    if (base === 'photo' && m.photoId) {
      const ph = images.get(m.photoId).full;
      const k = Math.min(1, 1600 / Math.max(ph.width, ph.height));
      m.w = Math.round(ph.width * k);
      m.h = Math.round(ph.height * k);
    } else {
      m.w = MOCK_SIZE; m.h = MOCK_SIZE;
    }
    // Mantiene la posición relativa del diseño
    m.items.forEach((it) => {
      it.x = it.x / oldW * m.w; it.y = it.y / oldH * m.h;
      const kk = Math.min(m.w / oldW, m.h / oldH);
      it.w *= kk; it.h *= kk;
    });
  }

  /* Zona de estampa: pecho (frente) o espalda, en coordenadas del documento */
  function printArea() {
    const m = state.compose.mockup;
    if (m.base === 'photo') return { x: m.w / 2, y: m.h / 2, w: m.w * 0.45, h: m.h * 0.45 };
    const tp = MOCK_TEMPLATES[m.template];
    if (tp.real) {
      const c = REAL_CAL[`${tp.real}-${m.view === 'back' ? 'back' : 'front'}`], f = MOCK_SIZE / 640;
      return { x: c.cx * f, y: c.cy * f, w: c.w * c.k * f, h: c.h * c.k * f };
    }
    if (tp.photo) {
      const f = MOCK_SIZE / tp.size;
      return { x: tp.area.x * f, y: tp.area.y * f, w: tp.area.w * f, h: tp.area.h * f };
    }
    const T = shirtTransform(m.template);
    const box = m.view === 'back' ? { x: 600, y: 540, w: 460, h: 560 } : { x: 600, y: 540, w: 400, h: 460 };
    return { x: T.tx + box.x * T.sc, y: T.ty + box.y * T.sc, w: box.w * T.sc, h: box.h * T.sc };
  }

  function setMockupDesign(imgId) {
    const m = state.compose.mockup;
    const img = images.get(imgId).full;
    const area = printArea();
    const k = Math.min(area.w / img.width, area.h / img.height);
    const prev = m.items[0];
    const it = { id: uid(), type: 'image', imgId, x: prev ? prev.x : area.x, y: prev ? prev.y : area.y, w: img.width * k, h: img.height * k, rot: prev ? prev.rot : 0, opacity: 100 };
    m.items = [it];
    m.selected = it.id;
  }

  /* --- Paneles de "Armar lienzo DTF" --- */
  function addToSheet(imgId, exactCm) {
    const sheet = state.compose.lienzo;
    const img = images.get(imgId).full;
    const gap = sheet.gapMm / 10;
    const usable = sheet.widthCm - gap * 2;
    // Ancho inicial: la medida elegida en la herramienta, o el tamaño real a 300 ppp
    const natural = pxToCm(img.width);
    const w = exactCm ? Math.round(clamp(exactCm, 0.5, 1000) * 100) / 100 : Math.round(clamp(natural, 3, Math.min(28, usable)) * 10) / 10;
    // Busca lugar en la última fila; si no entra, abajo de todo
    const ratio = img.height / img.width;
    let x = gap, y = nextFreeY(sheet);
    const last = sheet.items[sheet.items.length - 1];
    if (last) {
      const b = sheetBox(last);
      const rx = last.x + b.w + gap;
      if (rx + w <= sheet.widthCm - gap + 0.001) { x = rx; y = last.y; }
    }
    const it = { id: uid(), imgId, name: images.get(imgId).name, x, y, w, rot: 0 };
    if (w > usable && w * ratio <= usable) it.rot = 90;      // solo entra girada
    sheet.items.push(it);
    sheet.selected = [it.id];
    ensureHeight(sheet);
  }

  /* Duplica las imágenes elegidas (cada copia es una capa más) */
  function duplicateSheetItems(list, copies) {
    const sheet = state.compose.lienzo;
    const added = [];
    for (let n = 0; n < copies; n++) {
      list.forEach((src) => {
        if (sheet.items.length >= 300) return;
        const it = { ...src, id: uid(), name: `${src.name} copia` };
        const b = sheetBox(it);
        const gap = sheet.gapMm / 10;
        const prev = added.length ? added[added.length - 1] : sheet.items[sheet.items.length - 1];
        const pb = sheetBox(prev);
        if (prev.x + pb.w + gap + b.w <= sheet.widthCm - gap + 0.001) { it.x = prev.x + pb.w + gap; it.y = prev.y; }
        else { it.x = gap; it.y = nextFreeY({ ...sheet, items: [...sheet.items, ...added] }); }
        added.push(it);
        sheet.items.push(it);
      });
    }
    sheet.selected = added.map((a) => a.id);
    ensureHeight(sheet);
  }

  function renderSheetSizePanel(el) {
    const sheet = state.compose.lienzo;
    const u = sheet.unit === 'in' ? { k: 1 / CM_PER_INCH, label: 'in' } : { k: 1, label: 'cm' };
    const f0 = field(el, `<label class="field-label" for="sheet-unit">Unidad</label><select id="sheet-unit"><option value="cm" ${sheet.unit !== 'in' ? 'selected' : ''}>Centímetros (cm)</option><option value="in" ${sheet.unit === 'in' ? 'selected' : ''}>Pulgadas (in)</option></select>`);
    f0.querySelector('select').addEventListener('change', (e) => changeCompose(() => { sheet.unit = e.target.value; }));
    const dim = (label, key, max, presets) => {
      const val = Math.round(sheet[key] * u.k * 100) / 100;
      const f = field(el, `<label class="field-label" for="sheet-${key}">${label}</label>
        <span class="unit-input"><input type="number" id="sheet-${key}" min="1" step="0.1" value="${val}" inputmode="decimal"><i>${u.label}</i></span>
        <div class="presets" style="grid-template-columns:repeat(${presets.length},1fr);margin-top:6px"></div>`);
      f.querySelector('input').addEventListener('change', (e) => changeCompose(() => { sheet[key] = clamp((Number(e.target.value) || 1) / u.k, 1, max); }));
      const g = f.querySelector('.presets');
      presets.forEach((cm) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `${cm} cm`;
        b.setAttribute('aria-pressed', String(Math.abs(sheet[key] - cm) < 0.01));
        b.addEventListener('click', () => changeCompose(() => { sheet[key] = cm; }));
        g.appendChild(b);
      });
    };
    dim('Ancho del lienzo', 'widthCm', 200, [57, 58, 100, 150, 200]);
    dim('Alto del lienzo', 'heightCm', 1000, [100, 200, 300, 500, 1000]);
    const g = field(el, `<label class="field-label" for="sheet-gap">Separación para cortar</label><span class="unit-input"><input type="number" id="sheet-gap" min="0" max="50" step="1" value="${sheet.gapMm}" inputmode="numeric"><i>mm</i></span>`);
    g.querySelector('input').addEventListener('change', (e) => changeCompose(() => { sheet.gapMm = clamp(Number(e.target.value) || 0, 0, 50); }));
    field(el, `<p class="field-help">Ancho: de 1 a 200 cm. Alto: de 1 a 1000 cm. Las medidas se conservan al volver al lienzo. A 300 ppp: ${cmToPx(sheet.widthCm)} × ${cmToPx(sheet.heightCm)} px.</p>`);
  }

  function renderSheetSelectedPanel(el) {
    const sheet = state.compose.lienzo;
    const sel = sheetSelected();
    if (!sel.length) {
      field(el, '<p class="panel-note">Seleccioná una imagen del lienzo para modificar sus medidas.</p>');
      const row = document.createElement('div');
      row.className = 'btn-row';
      row.innerHTML = `<button type="button" class="panel-btn" ${state.sourceId ? '' : 'disabled'}>▣ Imagen actual</button><button type="button" class="panel-btn primary">⤒ Subir imágenes</button>`;
      const [cur, up] = row.querySelectorAll('button');
      cur.addEventListener('click', () => changeCompose(() => addToSheet(state.sourceId)));
      up.addEventListener('click', () => $('#extra-file-input').click());
      el.appendChild(row);
      return;
    }
    if (sel.length === 1) {
      const it = sel[0];
      const b = sheetBox(it);
      const dpi = effectiveDpi(it);
      field(el, `<p class="panel-note"><b>${it.name.replace(/</g, '&lt;')}</b><br>${dpi} ppp efectivos${dpi < 150 ? ' · ⚠ resolución baja: se puede ver pixelada' : dpi < 250 ? ' · calidad aceptable' : ' · buena calidad'}</p>`);
      const f = field(el, `<div class="dims">
        <label><span>Ancho</span><span class="unit-input"><input type="number" id="sel-w" min="0.5" step="0.1" value="${Math.round(b.w * 100) / 100}" inputmode="decimal"><i>cm</i></span></label>
        <label><span>Alto</span><span class="unit-input"><input type="number" id="sel-h" min="0.5" step="0.1" value="${Math.round(b.h * 100) / 100}" inputmode="decimal"><i>cm</i></span></label></div>`);
      const setVisual = (vw, vh) => changeCompose(() => {
        const img = images.get(it.imgId).full;
        const ratio = img.height / img.width;
        // Ancho/alto visibles → ancho de la imagen sin girar, manteniendo la proporción
        let w = it.rot === 90 ? (vw ? vw / ratio : vh) : (vw || vh / ratio);
        it.w = Math.round(clamp(w, 0.5, 1000) * 100) / 100;
        ensureHeight(sheet);
      });
      f.querySelector('#sel-w').addEventListener('change', (e) => setVisual(Number(e.target.value) || b.w, 0));
      f.querySelector('#sel-h').addEventListener('change', (e) => setVisual(0, Number(e.target.value) || b.h));
      const real = field(el, `<button type="button" class="panel-btn">⤢ Tamaño real a 300 ppp (${fmtCm(pxToCm(images.get(it.imgId).full.width))})</button>`).querySelector('button');
      real.addEventListener('click', () => changeCompose(() => { it.w = Math.round(pxToCm(images.get(it.imgId).full.width) * 100) / 100; ensureHeight(sheet); }));
    } else {
      field(el, `<p class="panel-note"><b>${sel.length} imágenes seleccionadas.</b> Arrastralas juntas o aplicales una acción.</p>`);
      const f = field(el, '<label class="field-label" for="sel-all-w">Mismo ancho para todas</label><span class="unit-input"><input type="number" id="sel-all-w" min="0.5" step="0.1" inputmode="decimal" placeholder="Ej.: 10"><i>cm</i></span>');
      f.querySelector('input').addEventListener('change', (e) => {
        const v = Number(e.target.value);
        if (v > 0) changeCompose(() => { sel.forEach((it) => { it.w = clamp(v, 0.5, 1000); }); ensureHeight(sheet); });
      });
    }
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.innerHTML = '<button type="button" class="panel-btn">⟳ Girar 90°</button><button type="button" class="panel-btn danger-btn">🗑 Quitar</button>';
    const [rot, del] = row.querySelectorAll('button');
    rot.addEventListener('click', () => changeCompose(() => { sel.forEach((it) => { it.rot = it.rot === 90 ? 0 : 90; }); ensureHeight(sheet); }));
    del.addEventListener('click', () => changeCompose(() => { sheet.items = sheet.items.filter((x) => !sel.includes(x)); sheet.selected = []; }));
    el.appendChild(row);
    const d = field(el, '<span class="field-label">Duplicar</span><div class="dup-row"><span class="unit-input"><input type="number" id="dup-n" min="1" max="100" value="1" inputmode="numeric"><i>copias</i></span><button type="button" class="panel-btn">⧉ Duplicar</button></div>');
    d.querySelector('button').addEventListener('click', () => {
      const n = clamp(Math.round(Number(d.querySelector('input').value) || 1), 1, 100);
      changeCompose(() => duplicateSheetItems(sel, n));
      toast(`Se agregaron ${n * sel.length} copias. Usá “Ordenar automáticamente” para acomodarlas.`);
    });
  }

  function renderSheetLayersPanel(el) {
    const sheet = state.compose.lienzo;
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.innerHTML = `<button type="button" class="panel-btn" aria-pressed="${!!sheet.multi}">${sheet.multi ? '✓ Seleccionando varias' : 'Seleccionar varias'}</button><button type="button" class="panel-btn">Seleccionar todas</button>`;
    const [multi, all] = row.querySelectorAll('button');
    multi.addEventListener('click', () => { sheet.multi = !sheet.multi; renderPanelContent(); });
    all.addEventListener('click', () => { sheet.selected = sheet.items.map((i) => i.id); renderPanelContent(); schedulePreview(true); });
    el.appendChild(row);
    field(el, `<div class="layers-head"><span>Imágenes en el lienzo</span><small>${sheet.items.length} ${sheet.items.length === 1 ? 'imagen' : 'imágenes'}</small></div>`);
    if (!sheet.items.length) { field(el, '<p class="panel-note">Todavía no hay imágenes. Subilas con “Subir imágenes”.</p>'); return; }
    const ul = document.createElement('ul');
    ul.className = 'layer-list';
    sheet.items.slice().reverse().forEach((it) => {
      const b = sheetBox(it);
      const dpi = effectiveDpi(it);
      const li = document.createElement('li');
      const on = sheet.selected.includes(it.id);
      li.className = on ? 'is-selected' : '';
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-pressed', String(on));
      li.appendChild(layerThumb({ type: 'image', imgId: it.imgId }));
      const label = document.createElement('span');
      label.className = 'layer-name';
      label.innerHTML = `${it.name.replace(/</g, '&lt;')}<small>${fmtCm(b.w)} × ${fmtCm(b.h)}</small><small class="${dpi < 150 ? 'dpi-low' : ''}">${dpi} DPI efectivos</small>`;
      li.appendChild(label);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn danger';
      del.setAttribute('aria-label', `Quitar ${it.name}`);
      del.textContent = '✕';
      del.addEventListener('click', (e) => { e.stopPropagation(); changeCompose(() => { sheet.items = sheet.items.filter((x) => x !== it); sheet.selected = sheet.selected.filter((x) => x !== it.id); }); });
      li.appendChild(del);
      const pick = () => {
        if (sheet.multi) sheet.selected = on ? sheet.selected.filter((x) => x !== it.id) : [...sheet.selected, it.id];
        else sheet.selected = [it.id];
        renderPanelContent();
        schedulePreview(true);
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      ul.appendChild(li);
    });
    el.appendChild(ul);
  }

  /* --- PDF del lienzo (escala real, una o varias páginas) ---
     Se arma a mano: cada franja es una imagen con transparencia (SMask). */
  async function deflate(bytes) {
    const cs = new CompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function downloadSheetPdf() {
    const sheet = state.compose.lienzo;
    if (!sheet.items.length) { toast('Primero agregá imágenes al lienzo.'); return; }
    if (typeof CompressionStream === 'undefined') { toast('Tu navegador no permite generar PDF. Descargá en PNG.'); return; }
    setBusy(true, 'Armando el PDF…');
    await nextFrame();
    try {
      const pxPerCm = DPI / CM_PER_INCH;
      const ptPerCm = 72 / CM_PER_INCH;
      const widthPx = cmToPx(sheet.widthCm);
      const maxPageCm = 500;                       // límite de tamaño de página de PDF
      const stripPx = Math.max(64, Math.min(4000, Math.floor(16000000 / widthPx)));
      const enc = new TextEncoder();
      const chunks = [];
      const offsets = [];
      let pos = 0;
      const push = (data) => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); pos += b.length; };
      const objStart = (n) => { offsets[n] = pos; push(`${n} 0 obj\n`); };
      push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
      let next = 3;                                 // 1 = catálogo, 2 = páginas
      const pageIds = [];
      const pages = Math.ceil(sheet.heightCm / maxPageCm);
      for (let pg = 0; pg < pages; pg++) {
        const topCm = pg * maxPageCm;
        const hCm = Math.min(maxPageCm, sheet.heightCm - topCm);
        const hPx = Math.round(hCm * pxPerCm);
        let content = '';
        const xobjs = [];
        for (let y0 = 0; y0 < hPx; y0 += stripPx) {
          const h = Math.min(stripPx, hPx - y0);
          setBusy(true, `Armando el PDF… ${Math.round((topCm * pxPerCm + y0) / (sheet.heightCm * pxPerCm) * 100)}%`);
          const strip = createCanvas(widthPx, h);
          drawSheet(strip, pxPerCm, false, topCm + y0 / pxPerCm);
          const d = ctx2d(strip).getImageData(0, 0, widthPx, h).data;
          let empty = true;
          for (let i = 3; i < d.length; i += 4) if (d[i]) { empty = false; break; }
          if (empty) continue;
          const rgb = new Uint8Array(widthPx * h * 3);
          const alpha = new Uint8Array(widthPx * h);
          for (let p = 0, q = 0; p < widthPx * h; p++, q += 4) {
            rgb[p * 3] = d[q]; rgb[p * 3 + 1] = d[q + 1]; rgb[p * 3 + 2] = d[q + 2];
            alpha[p] = d[q + 3];
          }
          const [zr, za] = await Promise.all([deflate(rgb), deflate(alpha)]);
          const imgId = next++, maskId = next++;
          objStart(maskId);
          push(`<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${za.length} >>\nstream\n`);
          push(za); push('\nendstream\nendobj\n');
          objStart(imgId);
          push(`<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${maskId} 0 R /Filter /FlateDecode /Length ${zr.length} >>\nstream\n`);
          push(zr); push('\nendstream\nendobj\n');
          const name = `Im${imgId}`;
          xobjs.push(`/${name} ${imgId} 0 R`);
          const wPt = sheet.widthCm * ptPerCm, hPt = h / pxPerCm * ptPerCm;
          const yPt = (hCm - (y0 + h) / pxPerCm) * ptPerCm;
          content += `q ${wPt.toFixed(3)} 0 0 ${hPt.toFixed(3)} 0 ${yPt.toFixed(3)} cm /${name} Do Q\n`;
          await nextFrame();
        }
        const contentId = next++, pageId = next++;
        const cb = enc.encode(content);
        objStart(contentId);
        push(`<< /Length ${cb.length} >>\nstream\n`); push(cb); push('\nendstream\nendobj\n');
        objStart(pageId);
        push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${(sheet.widthCm * ptPerCm).toFixed(3)} ${(hCm * ptPerCm).toFixed(3)}] /Resources << /XObject << ${xobjs.join(' ')} >> >> /Contents ${contentId} 0 R >>\nendobj\n`);
        pageIds.push(pageId);
      }
      objStart(1);
      push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
      objStart(2);
      push(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>\nendobj\n`);
      const xref = pos;
      let x = `xref\n0 ${next}\n0000000000 65535 f \n`;
      for (let i = 1; i < next; i++) x += `${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`;
      push(x);
      push(`trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      const blob = new Blob(chunks, { type: 'application/pdf' });
      const name = `lienzo-dtf-${fmtNum(sheet.widthCm)}x${fmtNum(sheet.heightCm)}cm.pdf`.replace(/,/g, '.');
      downloadBlob(blob, name);
      setStatus(pages > 1 ? `✓ PDF listo: ${pages} páginas de hasta ${maxPageCm} cm, a escala real.` : '✓ PDF listo, a escala real. Imprimí al 100 %.');
    } catch (err) {
      console.error(err);
      setStatus('No se pudo generar el PDF. Probá con la descarga en PNG.', true);
    } finally {
      setBusy(false);
    }
  }

  /* =========================================================
     8. VISTA PREVIA, ZOOM Y COMPARADOR
     ========================================================= */
  let previewTimer = 0;
  let previewToken = 0;
  const previewScale = { k: 1 };      // píxeles de vista previa por píxel del documento

  function schedulePreview(immediate) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, immediate ? 0 : 50);
  }

  async function renderPreview() {
    const token = ++previewToken;
    const tool = TOOLS[state.tool];
    const stage = $('#stage');
    const canvas = $('#result-canvas');
    const src = source();

    // En el lienzo, el arrastre se activa solo con un diseño seleccionado (así se puede desplazar con el dedo)
    stage.classList.toggle('is-interactive', !!tool.interactive && (state.tool !== 'lienzo' || sheetSel().length > 0));
    stage.classList.toggle('is-picking', !!(tool.picker && tool.picker(settingsOf(state.tool)) && src));
    stage.classList.toggle('is-brushing', !!(tool.brush && tool.brush(settingsOf(state.tool)) && src));
    // Indicación flotante del modo activo (gotero, pincel, etc.)
    const ts = settingsOf(state.tool);
    const hint = !src || !ts ? '' : tool.hint ? tool.hint(ts) : ts.pickPaint ? 'Tocá la imagen para tomar el color'
      : tool.colorOps && ts.mode === 'dropper' ? (state.tool === 'semitono' ? 'Tocá el color que querés eliminar' : 'Tocá el color que querés eliminar o reemplazar')
      : tool.colorOps && ts.mode === 'erase' ? 'Pintá para borrar'
      : tool.colorOps && ts.mode === 'restore' ? 'Pintá para recuperar el original'
      : tool.colorOps && ts.mode === 'paint' ? 'Pintá sobre la imagen' : '';
    $('#viewer-hint').textContent = hint;
    $('#viewer-hint').hidden = !hint;
    if (!(tool.brush && tool.brush(settingsOf(state.tool)))) { const cur = $('#brush-cursor'); if (cur) cur.hidden = true; }

    // Herramientas de composición: siempre muestran su documento
    if (tool.interactive) {
      $('#dropzone').hidden = true;
      stage.hidden = false;
      let out;
      if (state.tool === 'lienzo') {
        const sheet = state.compose.lienzo;
        let pxPerCm = Math.min(PREVIEW_MAX, 1000) / sheet.widthCm;
        pxPerCm = Math.min(pxPerCm, 14000 / sheet.heightCm);
        previewScale.k = pxPerCm;
        out = createCanvas(sheet.widthCm * pxPerCm, sheet.heightCm * pxPerCm);
        drawSheet(out, pxPerCm, true);
        if (!sheet.items.length) {
          const c = out.getContext('2d');
          c.fillStyle = '#4b5470';
          c.font = '600 22px Inter, Arial';
          c.textAlign = 'center';
          c.fillText('Subí imágenes para armar tu lienzo', out.width / 2, Math.min(out.height / 2, 300));
        }
      } else {
        const d = state.compose[state.tool];
        const k = Math.min(1, PREVIEW_MAX / Math.max(d.w, d.h));
        previewScale.k = k;
        out = createCanvas(d.w * k, d.h * k);
        if (state.tool === 'diseno') { drawDesign(out, k, true); renderPagesStrip(); }
        else drawMockup(out, k, true);
        const sel = selectedItem(state.tool);
        if (sel) drawSelection(out.getContext('2d'), sel, k);
        if (drag.mode === 'move') drawCenterGuides(out.getContext('2d'), out.width, out.height);
        if (state.tool === 'mockup' && !d.items.length) {
          const c = out.getContext('2d');
          c.fillStyle = '#4b5470';
          c.font = '600 22px Inter, Arial';
          c.textAlign = 'center';
          c.fillText('Subí tu diseño con “Cambiar diseño”', out.width / 2, out.height * 0.93);
        }
      }
      showCanvas(out, null);
      renderHeading();
      return;
    }

    if (!src) {
      $('#dropzone').hidden = false;
      stage.hidden = true;
      return;
    }
    $('#dropzone').hidden = true;
    stage.hidden = false;
    let out;
    try {
      out = await tool.live(src.preview, settingsOf(state.tool));
    } catch (err) {
      console.error(err);
      setStatus('No se pudo generar la vista previa.', true);
      return;
    }
    if (token !== previewToken) return;
    previewScale.k = out.width / src.full.width;
    showCanvas(out, src.preview);
    if (state.openPanel) renderNotesOnly();
  }

  /* Actualiza solo las notas dinámicas del panel (sin perder el foco de los controles) */
  function renderNotesOnly() {
    const tool = TOOLS[state.tool];
    const panel = tool.panels.find((p) => p.id === state.openPanel);
    if (!panel || panel.render) return;
    const notes = $$('#settings-content .panel-note');
    const s = settingsOf(state.tool);
    const defs = panel.controls.filter((c) => c.type === 'note' && (!c.when || c.when(s)));
    notes.forEach((n, i) => { if (defs[i]) n.innerHTML = defs[i].text(s); });
  }

  function showCanvas(out, before) {
    const canvas = $('#result-canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    canvas.getContext('2d').drawImage(out, 0, 0);
    const bc = $('#before-canvas');
    if (before && state.compare) {
      bc.width = out.width;
      bc.height = out.height;
      const c = bc.getContext('2d');
      c.imageSmoothingQuality = 'high';
      c.drawImage(before, 0, 0, out.width, out.height);
      bc.hidden = false;
      $('#compare-handle').hidden = false;
      updateCompareClip();
    } else {
      bc.hidden = true;
      $('#compare-handle').hidden = true;
    }
    applyZoom();
  }

  /* --- Zoom: 100% = ajustado al visor --- */
  function fitScale() {
    const canvas = $('#result-canvas');
    const vp = $('#viewport');
    const availW = Math.max(100, vp.clientWidth - 32);
    const availH = Math.max(160, Math.min(window.innerHeight * 0.65, 900) - 40);
    const kw = availW / canvas.width;
    if (TOOLS[state.tool].fitWidth) return Math.min(kw, 1.5);
    return Math.min(kw, availH / canvas.height, 3);
  }
  function applyZoom() {
    const canvas = $('#result-canvas');
    const s = fitScale() * state.zoom;
    const w = canvas.width * s, h = canvas.height * s;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    $('#stage').classList.toggle('is-pixelated', s > 2.5);
    $('#zoom-fit').textContent = Math.round(state.zoom * 100) + '%';
  }
  function setZoom(z, anchor) {
    const vp = $('#viewport');
    const old = state.zoom;
    state.zoom = clamp(z, 0.25, 8);
    // Mantiene el punto bajo el cursor/dedos en su lugar
    const ax = anchor ? anchor[0] : vp.clientWidth / 2;
    const ay = anchor ? anchor[1] : vp.clientHeight / 2;
    const fx = (vp.scrollLeft + ax) / Math.max(1, vp.scrollWidth);
    const fy = (vp.scrollTop + ay) / Math.max(1, vp.scrollHeight);
    applyZoom();
    if (old !== state.zoom) {
      vp.scrollLeft = fx * vp.scrollWidth - ax;
      vp.scrollTop = fy * vp.scrollHeight - ay;
    }
  }

  function initZoom() {
    const vp = $('#viewport');
    $('#zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.25));
    $('#zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.25));
    $('#zoom-fit').addEventListener('click', () => setZoom(1));

    // Ctrl + rueda del mouse (o gesto de pellizco en trackpad)
    vp.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      setZoom(state.zoom * Math.exp(-e.deltaY * 0.0025), [e.clientX - r.left, e.clientY - r.top]);
    }, { passive: false });

    // Pellizco con dos dedos
    let pinch = null;
    vp.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches;
        pinch = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom: state.zoom };
        drag.mode = null;
      }
    }, { passive: true });
    vp.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const [a, b] = e.touches;
      const r = vp.getBoundingClientRect();
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      setZoom(pinch.zoom * dist / pinch.dist, [(a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top]);
    }, { passive: false });
    vp.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });

    window.addEventListener('resize', () => applyZoom());
  }

  /* --- Comparador antes / después --- */
  function updateCompareClip() {
    const pct = state.comparePos * 100;
    $('#before-canvas').style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    const h = $('#compare-handle');
    h.style.left = pct + '%';
    h.setAttribute('aria-valuenow', String(Math.round(pct)));
  }
  function initCompare() {
    $('#compare-toggle').addEventListener('click', () => {
      state.compare = !state.compare;
      $('#compare-toggle').setAttribute('aria-pressed', String(state.compare));
      schedulePreview(true);
    });
    const handle = $('#compare-handle');
    const move = (e) => {
      const r = $('#result-canvas').getBoundingClientRect();
      state.comparePos = clamp((e.clientX - r.left) / r.width, 0, 1);
      updateCompareClip();
    };
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      move(e);
      handle.addEventListener('pointermove', move);
    });
    handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move));
    handle.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0;
      if (!step) return;
      e.preventDefault();
      state.comparePos = clamp(state.comparePos + step, 0, 1);
      updateCompareClip();
    });
  }

  /* --- Fondo del visor --- */
  function initBgSwitch() {
    $$('.bg-switch button').forEach((b) => b.addEventListener('click', () => setViewerBg(b.dataset.bg)));
    // Color de fondo a elección (para ver el diseño sobre el color de la prenda)
    $('#bg-custom').addEventListener('input', (e) => {
      $('#viewport').style.setProperty('--viewer-custom', e.target.value);
      setViewerBg('custom');
    });
  }
  function setViewerBg(bg) {
    state.bg = bg;
    const vp = $('#viewport');
    vp.classList.remove('bg-checker', 'bg-white', 'bg-black', 'bg-sky', 'bg-pink', 'bg-color');
    vp.classList.add(bg === 'custom' ? 'bg-color' : 'bg-' + bg);
    $$('.bg-switch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bg === bg)));
    $('.bg-custom').classList.toggle('is-active', bg === 'custom');
  }

  /* --- Estado de ocupado, mensajes y avisos --- */
  let busyCancel = null;
  function setBusy(on, text = 'Procesando…', onCancel = null) {
    $('#busy').hidden = !on;
    $('#busy-text').textContent = text;
    $('#download-btn').setAttribute('aria-busy', String(on));
    busyCancel = on ? onCancel : null;
    $('#busy-cancel').hidden = !busyCancel;
  }
  function setStatus(text, isError) {
    const el = $('#status');
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }
  let toastTimer = 0;
  function toast(text, action) {
    const el = $('#toast');
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.addEventListener('click', () => { el.hidden = true; action.fn(); });
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 8000 : 4000);
  }

  /* =========================================================
     9. CARGA DE IMÁGENES, DESCARGAS Y ENVÍOS
     ========================================================= */
  async function loadFile(file) {
    if (!file) return null;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Formato no admitido. Usá PNG, JPG o WEBP.'); return null; }
    if (file.size > MAX_FILE_BYTES) { toast('La imagen supera los 100 MB.'); return null; }
    let canvas = await blobToCanvas(file);
    // Limita el tamaño para no agotar la memoria del dispositivo
    if (canvas.width * canvas.height > MAX_SOURCE_AREA) {
      const k = Math.sqrt(MAX_SOURCE_AREA / (canvas.width * canvas.height));
      canvas = resizeCanvas(canvas, canvas.width * k, canvas.height * k);
      toast('La imagen era muy grande y se redujo para poder trabajarla.');
    }
    return registerImage(canvas, file.name.replace(/\.[^.]+$/, '') || 'imagen');
  }

  /** Imagen nueva: según la herramienta, se usa como base o se agrega a la composición. */
  function useNewImage(imgId) {
    pushHistory();
    state.sourceId = imgId;
    delete state.cache.bgMask;
    if (state.tool === 'diseno') {
      placeDesignImage(imgId);
    } else if (state.tool === 'mockup') {
      setMockupDesign(imgId);
    } else if (state.tool === 'lienzo') {
      addToSheet(imgId);
    }
    state.zoom = 1;
    afterStateChange();
    setStatus('');
  }

  async function handleFiles(files, forceAdd) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBusy(true, 'Cargando imagen…');
    try {
      for (const f of list) {
        const id = await loadFile(f);
        if (!id) continue;
        if (forceAdd && state.tool === 'lienzo') changeCompose(() => addToSheet(id));
        else if (forceAdd && state.tool === 'diseno') changeCompose(() => placeDesignImage(id));
        else useNewImage(id);
      }
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir la imagen.');
    } finally {
      setBusy(false);
    }
  }

  function initUploads() {
    const input = $('#file-input');
    const extra = $('#extra-file-input');
    const openPicker = () => (TOOLS[state.tool].multiple ? extra : input).click();
    $('#upload-shortcut').addEventListener('click', openPicker);
    $('#dropzone-button').addEventListener('click', openPicker);
    input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });
    extra.addEventListener('change', () => { handleFiles(extra.files, true); extra.value = ''; });

    // Foto propia para el mockup
    const photo = document.createElement('input');
    photo.type = 'file';
    photo.accept = 'image/png,image/jpeg,image/webp';
    photo.id = 'photo-file-input';
    photo.className = 'sr-only';
    photo.setAttribute('aria-label', 'Subir foto para el mockup');
    document.body.appendChild(photo);
    photo.addEventListener('change', async () => {
      const id = await loadFile(photo.files[0]);
      photo.value = '';
      if (!id) return;
      changeCompose(() => { state.compose.mockup.photoId = id; setMockupBase('photo'); });
    });

    // Arrastrar y soltar
    const vp = $('#viewport');
    ['dragenter', 'dragover'].forEach((ev) => vp.addEventListener(ev, (e) => { e.preventDefault(); vp.classList.add('is-dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => vp.addEventListener(ev, () => vp.classList.remove('is-dragover')));
    vp.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files, TOOLS[state.tool].multiple); });

    // Pegar con Ctrl + V
    document.addEventListener('paste', (e) => {
      if (e.target.closest('input, textarea')) return;
      const files = Array.from(e.clipboardData.items || []).filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
      if (files.length) handleFiles(files);
    });
  }

  /** Genera el resultado en máxima calidad. Devuelve [{canvas, name}] */
  async function renderFull(toolId = state.tool, opts = {}) {
    const tool = TOOLS[toolId];
    const s = settingsOf(toolId);
    const base = (source() || {}).name || 'diseno';
    if (toolId === 'diseno') {
      const c = state.compose;
      const docs = opts.single || c.designScope !== 'all' ? [c.diseno] : c.designs;
      return docs.map((d, i) => {
        const out = createCanvas(d.w, d.h);
        drawDesign(out, 1, false, d, !!opts.noBg);
        const name = (d.name || 'diseno').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `diseno-${i + 1}`;
        return { canvas: out, name, jpg: c.designFormat === 'jpg' && !d.transparent && !opts.noBg };
      });
    }
    if (toolId === 'mockup') {
      const m = state.compose.mockup;
      const png = m.format === 'png';
      const out = createCanvas(m.w, m.h);
      drawMockup(out, 1, false, png);
      return [{ canvas: out, name: 'mockup', jpg: !png }];
    }
    if (toolId === 'lienzo') {
      const sheet = state.compose.lienzo;
      if (!sheet.items.length) throw new Error('Primero agregá imágenes al lienzo.');
      const pxPerCm = DPI / CM_PER_INCH;
      const widthPx = cmToPx(sheet.widthCm);
      const totalPx = cmToPx(sheet.heightCm);
      const maxH = Math.min(MAX_CANVAS_SIDE, Math.floor(MAX_CANVAS_AREA / widthPx));
      const parts = Math.ceil(totalPx / maxH);
      const files = [];
      for (let i = 0; i < parts; i++) {
        const h = Math.min(maxH, totalPx - i * maxH);
        const out = createCanvas(widthPx, h);
        drawSheet(out, pxPerCm, false, i * maxH / pxPerCm);
        const base = `lienzo-dtf-${fmtNum(sheet.widthCm)}x${fmtNum(sheet.heightCm)}cm`.replace(/,/g, '.');
        files.push({ canvas: out, name: parts > 1 ? `${base}-parte-${i + 1}` : base });
        await nextFrame();
      }
      return files;
    }
    const src = source();
    const out = await tool.full(src.full, s);
    return [{ canvas: out, name: `${base}-${toolId}` }];
  }

  async function download() {
    const tool = TOOLS[state.tool];
    setBusy(true, 'Preparando descarga…');
    setStatus('');
    await nextFrame();
    try {
      const files = await renderFull();
      for (const f of files) {
        let blob;
        if (f.jpg) blob = await canvasToBlob(f.canvas, 'image/jpeg', 0.92);
        else blob = await pngWithDpi(await canvasToBlob(f.canvas, 'image/png'));
        const name = `${f.name}.${f.jpg ? 'jpg' : 'png'}`;
        downloadBlob(blob, name);
        saveCreation(blob, name, tool.title, f.canvas);
        await nextFrame();
      }
      setStatus(files.length > 1 ? `✓ Se descargaron ${files.length} partes.` : '✓ Descarga lista. También quedó en “Mis creaciones”.');
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'No se pudo generar la descarga.', true);
    } finally {
      setBusy(false);
    }
  }

  /** Envía el resultado actual a otra herramienta. */
  async function sendTo(target) {
    setBusy(true, 'Preparando…');
    await nextFrame();
    try {
      // Un diseño pasa al lienzo sin el fondo y sin márgenes vacíos (listo para DTF)
      const fromDesign = state.tool === 'diseno' && target === 'lienzo';
      const [file] = await renderFull(state.tool, { single: true, noBg: fromDesign });
      if (fromDesign) {
        const trimmed = trimTransparent(binaryAlpha(file.canvas));
        if (!trimmed) throw new Error('El diseño está vacío: agregá textos, formas o imágenes.');
        file.canvas = trimmed;
      }
      const name = ((source() || {}).name || 'diseno') + '-' + state.tool;
      const id = registerImage(file.canvas, name);
      pushHistory();
      state.sourceId = id;
      delete state.cache.bgMask;
      // Las herramientas con medida de impresión (semitono, efectos) la conservan en el lienzo
      if (target === 'lienzo') addToSheet(id, ['semitono', 'efectos', 'semitransparencias'].includes(state.tool) ? settingsOf(state.tool).widthCm : null);
      if (target === 'mockup') setMockupDesign(id);
      if (target === 'diseno') { const d = state.compose.diseno; const it = makeImageItem(d, id); d.items.push(it); d.selected = it.id; }
      selectTool(target);
      updateHistoryButtons();
      toast(`Listo: se envió a “${TOOLS[target].title}”.`);
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'No se pudo enviar.', true);
    } finally {
      setBusy(false);
    }
  }

  /** "Aplicar": el resultado pasa a ser la nueva imagen base (ej. editar varios colores). */
  async function commitResult() {
    setBusy(true, 'Aplicando…');
    await nextFrame();
    try {
      const [file] = await renderFull(state.tool, { single: true });
      const id = registerImage(file.canvas, (source() || {}).name || 'imagen');
      pushHistory();
      state.sourceId = id;
      const tool = TOOLS[state.tool];
      if (tool.afterCommit) tool.afterCommit(settingsOf(state.tool));
      afterStateChange();
      toast('Cambio aplicado. Podés elegir otro color.');
    } finally {
      setBusy(false);
    }
  }

  /* --- Restaurar: vuelve la herramienta a sus valores iniciales --- */
  function restoreTool() {
    pushHistory();
    state.settings[state.tool] = JSON.parse(JSON.stringify(TOOLS[state.tool].defaults));
    if (state.tool === 'eliminar-fondo') delete state.cache.bgMask;
    if (TOOLS[state.tool].interactive) {
      if (state.tool === 'diseno') {
        const c = state.compose;
        const fresh = newDesign(c.designIndex + 1);
        fresh.name = c.diseno.name;
        c.designs[c.designIndex] = fresh;
        syncDesignRef();
      } else {
        state.compose[state.tool] = newComposeState()[state.tool];
      }
    }
    afterStateChange();
    toast('Se restauraron los ajustes.', { label: 'Deshacer', fn: undo });
  }

  /* --- Guardado automático del proyecto ("Guardado temporal privado") --- */
  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    $('#draft-status').classList.remove('saved');
    saveTimer = setTimeout(saveProject, 1200);
  }
  async function saveProject() {
    try {
      await DB.put('kv', {
        tool: state.tool,
        sourceId: state.sourceId,
        settings: state.settings,
        compose: state.compose,
        bg: state.bg,
        savedAt: Date.now(),
      }, 'project');
      const el = $('#draft-status');
      el.classList.add('saved');
      el.title = 'Borrador guardado en este dispositivo';
      cleanupImages();
    } catch (err) {
      console.warn('No se pudo guardar el borrador', err);
    }
  }
  /* Borra del almacenamiento las imágenes que ya no se usan */
  async function cleanupImages() {
    const used = new Set([state.sourceId, state.compose.mockup.photoId]);
    composeDocs(state.compose).forEach((d) => d.items.forEach((it) => it.imgId && used.add(it.imgId)));
    history.past.concat(history.future).forEach((snap) => {
      used.add(snap.sourceId);
      composeDocs(snap.compose).forEach((d) => d.items.forEach((it) => it.imgId && used.add(it.imgId)));
    });
    const keys = await DB.keys('images');
    keys.filter((k) => !used.has(k)).forEach((k) => DB.del('images', k));
  }
  async function loadProject() {
    try {
      const p = await DB.get('kv', 'project');
      if (!p) return false;
      const ids = new Set([p.sourceId, p.compose && p.compose.mockup.photoId]);
      if (p.compose) composeDocs(p.compose).forEach((d) => d.items.forEach((it) => it.imgId && ids.add(it.imgId)));
      for (const id of ids) {
        if (!id) continue;
        const rec = await DB.get('images', id);
        if (rec) registerImage(await blobToCanvas(rec.blob), rec.name, id, false);
      }
      state.sourceId = p.sourceId && images.has(p.sourceId) ? p.sourceId : null;
      Object.keys(TOOLS).forEach((t) => { state.settings[t] = { ...TOOLS[t].defaults, ...(p.settings && p.settings[t]) }; });
      if (p.compose) {
        // Quita elementos cuya imagen ya no existe
        composeDocs(p.compose).forEach((d) => { d.items = d.items.filter((it) => !it.imgId || images.has(it.imgId)); });
        if (!p.compose.designs) { p.compose.designs = [{ ...p.compose.diseno, name: 'Diseño 1' }]; p.compose.designIndex = 0; }
        state.compose = { ...newComposeState(), ...p.compose };
        syncDesignRef();
        // Lienzo guardado con el formato anterior (filas automáticas con copias)
        const lz = state.compose.lienzo;
        if (lz.heightCm === undefined) {
          const items = [];
          (lz.items || []).forEach((it) => { for (let n = 0; n < (it.copies || 1); n++) items.push({ id: uid(), imgId: it.imgId, name: it.name || 'Diseño', x: 0, y: 0, w: it.widthCm || it.w || 10, rot: it.rotate ? 90 : 0 }); });
          state.compose.lienzo = { ...newComposeState().lienzo, widthCm: Math.min(lz.widthCm || 57, 200), items };
          if (items.length) {
            const pk = packSheet(state.compose.lienzo, false);
            pk.pieces.forEach((p) => { p.it.x = p.x; p.it.y = p.y; p.it.rot = p.rot; });
            ensureHeight(state.compose.lienzo);
          }
        }
        if (!Array.isArray(state.compose.lienzo.selected)) state.compose.lienzo.selected = [];
        // Proyectos guardados con el mockup anterior: se adaptan al formato nuevo
        const mk = state.compose.mockup;
        if (!mk.template) {
          const items = mk.items;
          state.compose.mockup = { ...newComposeState().mockup, photoId: mk.photoId, shirtColor: mk.shirtColor || '#9ea3ab' };
          if (items[0] && items[0].imgId) setMockupDesign(items[0].imgId);
        }
      }
      if (p.bg) setViewerBg(p.bg === 'custom' ? 'checker' : p.bg);
      state.tool = TOOLS[p.tool] ? p.tool : state.tool;
      return !!(state.sourceId || hasComposeContent());
    } catch (err) {
      console.warn('No se pudo recuperar el borrador', err);
      return false;
    }
  }

  /* =========================================================
     10. MIS CREACIONES / MI CUENTA
     ========================================================= */
  async function saveCreation(blob, name, toolTitle, canvas) {
    try {
      const thumb = fitInside(canvas, 320);
      const thumbBlob = await canvasToBlob(thumb, 'image/png');
      await DB.put('creations', { id: uid(), name, tool: toolTitle, date: Date.now(), blob, thumb: thumbBlob });
      // Conserva las 40 más recientes
      const all = await DB.all('creations');
      all.sort((a, b) => b.date - a.date).slice(40).forEach((c) => DB.del('creations', c.id));
    } catch (err) {
      console.warn('No se pudo guardar en Mis creaciones', err);
    }
  }

  const thumbUrls = [];
  async function openCreations() {
    const dlg = $('#creations-dialog');
    const grid = $('#creations-grid');
    thumbUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    grid.innerHTML = '<p class="creations-empty">Cargando…</p>';
    if (!dlg.open) dlg.showModal();
    let all = [];
    try { all = await DB.all('creations'); } catch (e) { /* sin almacenamiento */ }
    all.sort((a, b) => b.date - a.date);
    grid.innerHTML = all.length ? '' : '<p class="creations-empty">Todavía no hay creaciones. Cada vez que descargues algo, se guarda acá.</p>';
    all.forEach((c) => {
      const url = URL.createObjectURL(c.thumb || c.blob);
      thumbUrls.push(url);
      const card = document.createElement('article');
      card.className = 'creation';
      card.innerHTML = `<img src="${url}" alt="Vista de ${c.name.replace(/"/g, '')}" loading="lazy" width="160" height="130">
        <strong title="${c.name.replace(/"/g, '')}">${c.name.replace(/</g, '&lt;')}</strong>
        <small>${c.tool} · ${new Date(c.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
        <div class="creation-actions"><button type="button">Abrir</button><button type="button">Descargar</button><button type="button" aria-label="Eliminar ${c.name.replace(/"/g, '')}">✕</button></div>`;
      const [openB, dlB, delB] = card.querySelectorAll('button');
      openB.addEventListener('click', async () => {
        const id = registerImage(await blobToCanvas(c.blob), c.name.replace(/\.[^.]+$/, ''));
        dlg.close();
        useNewImage(id);
      });
      dlB.addEventListener('click', () => downloadBlob(c.blob, c.name));
      delB.addEventListener('click', async () => { await DB.del('creations', c.id); openCreations(); });
      grid.appendChild(card);
    });
  }

  function initDialogs() {
    $('#open-creations').addEventListener('click', (e) => { e.preventDefault(); openCreations(); });
    $('#open-account').addEventListener('click', (e) => { e.preventDefault(); $('#account-dialog').showModal(); });
    $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    // Cerrar tocando fuera de la ventana
    $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
    $('#clear-data').addEventListener('click', async () => {
      if (!confirm('¿Borrar el borrador y todas tus creaciones de este dispositivo?')) return;
      await Promise.all(['kv', 'images', 'creations'].map((s) => DB.clear(s).catch(() => {})));
      location.reload();
    });
  }

  /* =========================================================
     11. INICIO
     ========================================================= */
  function initHeaderControls() {
    $('#undo-btn').addEventListener('click', undo);
    $('#redo-btn').addEventListener('click', redo);
    $('#restore-btn').addEventListener('click', restoreTool);
    $('#settings-close').addEventListener('click', closePanel);
    $('#settings-shortcut').addEventListener('click', () => {
      if (state.openPanel) closePanel();
      else openPanel(TOOLS[state.tool].panels.find((p) => !p.action).id);
    });
    $('#download-btn').addEventListener('click', () => {
      const tool = TOOLS[state.tool];
      const s = settingsOf(state.tool);
      if (state.sourceId && tool.ready && !tool.ready(s) && tool.primaryAction) tool.primaryAction(s).run();
      else download();
    });
    $('#busy-cancel').addEventListener('click', () => { if (busyCancel) busyCancel(); });
  }

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      const typing = e.target.closest('input, textarea, select');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === 'Escape' && state.openPanel && !$('dialog[open]')) { closePanel(); return; }
      // Diseño: borrar y mover el elemento seleccionado con el teclado
      if (typing || !TOOLS[state.tool].interactive || state.tool === 'lienzo') return;
      const it = selectedItem(state.tool);
      if (!it) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.tool === 'diseno') {
        e.preventDefault();
        changeCompose(() => { const d = state.compose.diseno; d.items = d.items.filter((x) => x !== it); d.selected = null; });
      }
      const step = e.shiftKey ? 20 : 4;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv && e.target === $('#result-canvas')) {
        e.preventDefault();
        it.x += mv[0]; it.y += mv[1];
        schedulePreview(true);
        scheduleSave();
      }
    });
    $('#result-canvas').tabIndex = 0;
  }

  /* Modo embebido: las herramientas se abren dentro del panel (pestaña "Editar imagen") */
  const EMBED = new URLSearchParams(location.search).has('embed');
  if (EMBED) document.documentElement.classList.add('is-embed');
  // El panel puede mandar una imagen de un pedido para editarla acá
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'te-load-image' || !d.blob) return;
    const type = /^image\/(png|jpeg|webp)$/.test(d.blob.type) ? d.blob.type : 'image/png';
    handleFiles([new File([d.blob], d.name || 'imagen.png', { type })]);
  });

  async function init() {
    Object.keys(TOOLS).forEach((t) => { state.settings[t] = JSON.parse(JSON.stringify(TOOLS[t].defaults)); });
    state.compose = newComposeState();

    createHeaderSparks();
    initToolMenu();
    initHeaderControls();
    initUploads();
    initZoom();
    initCompare();
    initBgSwitch();
    initComposeInteraction();
    initDialogs();
    initKeyboard();

    const restored = await loadProject();
    selectTool(state.tool, { silent: true });
    updateHistoryButtons();
    if (restored) {
      $('#draft-status').classList.add('saved');
      toast('Recuperamos tu proyecto guardado.', {
        label: 'Empezar de cero',
        fn: async () => { await DB.del('kv', 'project'); location.reload(); },
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
