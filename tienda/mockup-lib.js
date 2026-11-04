/* ==========================================================
   Tu Estampa SF · Remera para mockups (compartido con la tienda)
   Copia de las funciones de la herramienta "Crear mockup"
   (archivo generado a partir de script.js).
   ========================================================== */
(function () {
  'use strict';
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
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

  // La tienda usa solo las remeras dibujadas (sin fotos de modelo)
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
  const isPhotoTemplate = (tpl) => !!(MOCK_TEMPLATES[tpl] && MOCK_TEMPLATES[tpl].photo);

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

  window.TEMock = { createCanvas, ctx2d, resizeCanvas, fitInside, canvasToBlob, blobToCanvas, hexToRgb, luminance, mixHex,
    renderShirt, getFabricLayers, shirtPath, shirtTransform, MOCK_SIZE };
})();
