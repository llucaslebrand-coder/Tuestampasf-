/* ==========================================================
   Tienda Tu Estampa SF — el cliente elige la remera, sube su
   diseño, lo ubica sobre la remera y hace el pedido.

   El pedido llega al panel (tabla "pedidos" de Supabase) con la
   imagen original, la medida exacta de cada estampa y el mockup.
   Sin Supabase configurado funciona en "modo demo": el pedido se
   guarda en el panel de este mismo dispositivo.

   Índice
    1. Utilidades y configuración
    2. Catálogo y precios
    3. Estado del pedido
    4. Dibujo de la remera con el diseño
    5. Paso 1 · Remera
    6. Paso 2 · Diseño (subir, mover, tamaño, quitar fondo)
    7. Paso 3 · Pedido y envío
    8. Navegación entre pasos
    9. Inicio
   ========================================================== */
(function () {
  'use strict';

  /* =========================================================
     1. UTILIDADES Y CONFIGURACIÓN
     ========================================================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const money = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const cmTxt = (n) => (Math.round(n * 10) / 10).toLocaleString('es-AR');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const roundUp = (x, r) => (r > 0 ? Math.ceil(x / r) * r : Math.round(x));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  const CFG = Object.assign({ supabaseUrl: '', supabaseKey: '', whatsapp: '', instagram: 'tuestampasf' }, window.TIENDA_CONFIG || {});
  const M = window.TEMock;
  let sb = null;

  let toastTimer = 0;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }
  function setBusy(on, text = 'Procesando…') {
    $('#busy').hidden = !on;
    $('#busy-text').textContent = text;
  }
  function waNumber(n) {
    let d = String(n || '').replace(/\D/g, '');
    if (d && !d.startsWith('54')) d = '549' + d.replace(/^0/, '');
    return d;
  }

  /* =========================================================
     2. CATÁLOGO Y PRECIOS
     Se leen de Supabase (los carga el panel). Si no hay
     conexión, se usan los del panel de este dispositivo o
     los valores iniciales.
     ========================================================= */
  const CATALOGO_INICIAL = [{
    id: 'unisex', nombre: 'Remera unisex', sigla: 'U', precio: 20000, activo: true,
    colores: [
      { nombre: 'Blanca', hex: '#f4f2ee' }, { nombre: 'Negra', hex: '#1d1d1f' }, { nombre: 'Azul marino', hex: '#1b2a6e' },
      { nombre: 'Gris melange', hex: '#9ea3ab' }, { nombre: 'Beige', hex: '#e8d9bf' }, { nombre: 'Verde inglés', hex: '#1f4d3a' },
    ],
    talles: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  }];
  const COTIZADOR_INICIAL = { metro: 14000, ancho: 60, merma: 15, ganancia: 100, fijo: 1500, diseno: 5000, redondeo: 500 };
  let catalogo = CATALOGO_INICIAL;
  let cotizador = COTIZADOR_INICIAL;
  let negocio = {};
  let modo = 'demo';      // 'nube' o 'demo'

  async function cargarCatalogo() {
    if (CFG.supabaseUrl && CFG.supabaseKey && window.supabase) {
      try {
        sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
        // Si la conexión tarda más de 6 segundos, se sigue con los datos de siempre
        const tarde = new Promise((_, rej) => setTimeout(() => rej(new Error('Supabase no responde')), 6000));
        const [{ data: mods, error: e1 }, { data: cfg, error: e2 }] = await Promise.race([Promise.all([
          sb.from('modelos').select('*').eq('activo', true),
          sb.from('config').select('*'),
        ]), tarde]);
        if (e1 || e2) throw e1 || e2;
        if (mods && mods.length) catalogo = mods;
        (cfg || []).forEach((r) => {
          if (r.clave === 'cotizador') cotizador = { ...COTIZADOR_INICIAL, ...r.valor };
          if (r.clave === 'tienda') negocio = r.valor || {};
        });
        modo = 'nube';
        return;
      } catch (err) {
        // Con la nube configurada nunca se usa el modo demo: el pedido se intenta enviar
        // igual y, si no hay conexión, el cliente ve el aviso para reintentar o escribir.
        console.warn('No se pudo leer el catálogo de la nube; se usan los valores de siempre', err);
        modo = 'nube';
        return;
      }
    }
    // Modo demo: datos del panel de este mismo dispositivo
    try {
      const d = JSON.parse(localStorage.getItem('te_panel_data_v1') || 'null');
      if (d && d.modelos && d.modelos.length) catalogo = d.modelos.filter((m) => m.activo !== false);
      if (d && d.config && d.config.cotizador) cotizador = { ...COTIZADOR_INICIAL, ...d.config.cotizador };
      if (d && d.config && d.config.tienda) negocio = d.config.tienda;
    } catch (e) { /* sin datos del panel */ }
  }
  const whatsappNegocio = () => waNumber(negocio.whatsapp || CFG.whatsapp);
  /* Seña para confirmar el pedido (se cambia en Panel → Ajustes → Tienda) */
  const aliasPago = () => negocio.alias || CFG.alias || '';
  const senaMonto = (total) => Math.min(Number(negocio.sena ?? CFG.sena ?? 0) || 0, total);
  const VENCE_DIAS = 3;

  /* WhatsApp argentino: devuelve los 10 dígitos (área + número) o '' si no es válido.
     Acepta 342 4123456, 0342 15 4123456, +54 9 342 4123456, etc. */
  function telefonoAR(txt) {
    let d = String(txt || '').replace(/\D/g, '');
    if (d.startsWith('54')) d = d.slice(2);
    if (d.startsWith('9') && d.length === 11) d = d.slice(1);
    if (d.startsWith('0')) d = d.slice(1);
    if (d.length === 12) {
      // Saca el 15 que va después del código de área (2, 3 o 4 dígitos)
      for (const n of [2, 3, 4]) if (d.slice(n, n + 2) === '15') { d = d.slice(0, n) + d.slice(n + 2); break; }
    }
    return /^[1-9]\d{9}$/.test(d) ? d : '';
  }
  /* Límite en este dispositivo: hasta 3 pedidos por hora */
  function puedePedir() {
    try {
      const h = JSON.parse(localStorage.getItem('te_tienda_envios') || '[]').filter((t) => Date.now() - t < 3600e3);
      return h.length < 3;
    } catch (e) { return true; }
  }
  function anotarEnvio() {
    try {
      const h = JSON.parse(localStorage.getItem('te_tienda_envios') || '[]').filter((t) => Date.now() - t < 3600e3);
      h.push(Date.now());
      localStorage.setItem('te_tienda_envios', JSON.stringify(h));
    } catch (e) { /* sin almacenamiento */ }
  }
  let paso3Desde = 0;

  /* Precio de una estampa según sus cm² (misma fórmula que el cotizador del panel) */
  function precioEstampa(ancho, alto) {
    const c = cotizador;
    const costoCm2 = c.metro / (c.ancho * 100) * (1 + c.merma / 100);
    const precioCm2 = costoCm2 * (1 + c.ganancia / 100);
    return roundUp(ancho * alto * precioCm2 + c.fijo, c.redondeo);
  }

  /* =========================================================
     3. ESTADO DEL PEDIDO
     Las estampas se guardan en centímetros reales:
     x, y = desplazamiento desde el centro de la zona de estampa.
     ========================================================= */
  const ZONAS = {
    // lim: área de trabajo = todo el cuerpo de la remera (sin mangas), en cm desde el centro del pecho
    frente: { label: 'Frente', lim: { l: -23, r: 23, t: -23, b: 40 }, area: { x: 600, y: 520, w: 380, h: 470 }, max: [30, 38], presets: [['Logo pecho', 9], ['Mediano', 20], ['Grande', 28], ['Extra grande', 40]] },
    espalda: { label: 'Espalda', lim: { l: -23, r: 23, t: -22, b: 42 }, area: { x: 600, y: 540, w: 440, h: 540 }, max: [32, 42], presets: [['Nuca', 8], ['Mediano', 22], ['Grande', 30], ['Extra grande', 40]] },
    // Manga: solo con las fotos de costado (en percha o puesta)
    manga: { label: 'Manga', area: null, max: [10, 12], presets: [['Chica', 6], ['Mediana', 8], ['Grande', 10]] },
  };
  const UNITS_PER_CM = 12.9;   // la remera dibujada mide ~50 cm de ancho

  const st = {
    step: 1,
    modelo: null,
    color: null,
    talle: null,
    cantidad: 1,
    side: 'frente',
    vista: 'percha',   // percha, modelo o plana
    designs: { frente: [], espalda: [], manga: [] },   // varias estampas por lado: { id, img (canvas), name, w (cm), x, y, bgRemoved }
    sel: { frente: null, espalda: null, manga: null },   // estampa elegida en cada lado
    reemplazar: false,                      // «Cambiar imagen» reemplaza la elegida en vez de sumar otra
    pedidoId: null,
  };
  const modeloActual = () => catalogo.find((m) => m.id === st.modelo) || catalogo[0];
  const colorActual = () => (modeloActual().colores.find((c) => c.nombre === st.color) || modeloActual().colores[0]);
  const MAX_POR_LADO = 4;
  /* Límites del área de trabajo (cm, respecto del centro de la zona) */
  function limites(side) {
    // En las fotos: el área de trabajo es el cuerpo de la remera que se ve en esa foto
    const v = vistaReal(side);
    const r = CUERPO[`${v}-${side}`];
    if (r) {
      const c = calDe(v, side);
      return { l: (r[0] - c.cx) / c.k, r: (r[1] - c.cx) / c.k, t: (r[2] - c.cy) / c.k, b: (r[3] - c.cy) / c.k };
    }
    const z = ZONAS[side];
    if (z.lim) return z.lim;
    return { l: -z.max[0] / 2, r: z.max[0] / 2, t: -z.max[1] / 2, b: z.max[1] / 2 };
  }
  const anchoMax = (side) => { const L = limites(side); return L.r - L.l; };
  const LADOS = ['frente', 'espalda', 'manga'];
  const CON_ARTICULO = { frente: 'el frente', espalda: 'la espalda', manga: 'la manga' };
  const lista = (side) => st.designs[side];
  const hayEn = (side) => st.designs[side].length > 0;
  /* Estampa elegida del lado que se está editando */
  const actual = (side = st.side) => lista(side).find((d) => d.id === st.sel[side]) || lista(side)[lista(side).length - 1] || null;
  const nombreEstampa = (side, d) => (lista(side).length > 1 ? `${ZONAS[side].label} ${lista(side).indexOf(d) + 1}` : ZONAS[side].label);

  function totales() {
    const m = modeloActual();
    const est = [];
    LADOS.forEach((side) => lista(side).forEach((d, i) => {
      const h = d.w * d.img.height / d.img.width;
      est.push({ side, d, n: i + 1, zona: nombreEstampa(side, d), ancho: d.w, alto: h, precio: precioEstampa(d.w, h) });
    }));
    const porPrenda = Number(m.precio || 0) + est.reduce((a, e) => a + e.precio, 0);
    return { est, porPrenda, total: porPrenda * st.cantidad };
  }

  /* =========================================================
     4. DIBUJO DE LA REMERA CON EL DISEÑO
     ========================================================= */
  const DOC = M.MOCK_SIZE;
  const T = () => M.shirtTransform('flat');

  /* ---------- Vistas: foto en percha, foto puesta (modelo) o remera plana ----------
     Las fotos están en img/mockups/fotos/<color>-<vista>-<lado>.jpg (640 × 640).
     Calibración en píxeles de la foto: centro de la zona de estampa y píxeles por cm. */
  const VISTAS = [
    { id: 'percha', label: 'En percha' },
    { id: 'modelo', label: 'Puesta' },
    { id: 'plana', label: 'Plana' },
  ];
  const CAL = {
    'percha-frente': { cx: 311, cy: 344, k: 6.0 },
    'percha-espalda': { cx: 314, cy: 340, k: 6.3 },
    'modelo-frente': { cx: 322, cy: 403, k: 4.7 },
    'modelo-espalda': { cx: 308, cy: 480, k: 4.5 },
    'percha-manga': { cx: 322, cy: 300, k: 9.5 },
    'modelo-manga': { cx: 366, cy: 292, k: 8.4 },
  };
  /* Pequeñas correcciones por color (la foto blanca quedó un poco más baja en la grilla) */
  const AJUSTE = { 'blanca-modelo-frente': { cy: 17 }, 'blanca-modelo-espalda': { cy: 17 } };
  const calDe = (v, side) => {
    const base = CAL[`${v}-${side}`], aj = AJUSTE[`${slug(colorActual().nombre)}-${v}-${side}`] || {};
    return { cx: base.cx + (aj.cx || 0), cy: base.cy + (aj.cy || 0), k: base.k };
  };
  const FOTO_PX = 640;
  /* Cuerpo de la remera (sin mangas) en cada foto, en píxeles de la foto: x0, x1, y0 (cuello), y1 (ruedo) */
  const CUERPO = {
    'percha-frente': [165, 457, 195, 630],
    'percha-espalda': [170, 457, 150, 628],
    'modelo-frente': [205, 440, 270, 600],
    'modelo-espalda': [200, 420, 352, 632],
  };
  const CON_FOTO = ['blanca', 'negra', 'azul-marino', 'gris-melange', 'beige', 'verde-ingles'];
  const slug = (txt) => String(txt).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  /* Vista que se puede usar de verdad (si el color no tiene foto, se muestra plana) */
  let fotosFallaron = false;
  const hayFotos = () => !fotosFallaron && CON_FOTO.includes(slug(colorActual().nombre));
  const vistaReal = (side = st.side) => {
    if (!hayFotos()) return 'plana';
    if (side === 'manga' && st.vista === 'plana') return 'modelo';   // la manga no tiene dibujo plano
    return st.vista;
  };

  const fotos = {};      // src → { img, shade, ok }
  function foto(side) {
    const v = vistaReal(side);
    if (v === 'plana') return null;
    const src = `../img/mockups/fotos/${slug(colorActual().nombre)}-${v}-${side}.jpg`;
    if (!fotos[src]) {
      const f = fotos[src] = { img: new Image(), shade: null, ok: false };
      f.img.onload = () => { f.ok = true; f.shade = shadeMap(f.img, calDe(v, side)); redraw(); };
      f.img.onerror = () => { fotosFallaron = true; renderVistas(); redraw(); };
      if (location.protocol === 'file:') {
        // Abierta con doble clic: las fotos vienen incrustadas (si no, el navegador no deja exportarlas)
        cargarFotosIncrustadas().then(() => { f.img.src = (window.TE_FOTOS || {})[src.split('/').pop().replace('.jpg', '')] || src; });
      } else {
        f.img.src = src;
      }
    }
    return fotos[src];
  }
  let fotosScript = null;
  function cargarFotosIncrustadas() {
    if (!fotosScript) fotosScript = new Promise((res) => { const el = document.createElement('script'); el.src = '../img/mockups/fotos.js'; el.onload = res; el.onerror = res; document.head.appendChild(el); });
    return fotosScript;
  }
  /* Espera a que estén las fotos de los dos lados (para el resumen y el pedido) */
  function fotosListas() {
    const fs = LADOS.filter((l) => l !== 'manga' || hayEn('manga')).map(foto).filter(Boolean);
    return Promise.race([
      Promise.all(fs.map((f) => (f.ok ? null : new Promise((res) => { const prev = f.img.onload; f.img.onload = (e) => { prev && prev(e); res(); }; f.img.addEventListener('error', res); })))),
      new Promise((res) => setTimeout(res, 6000)),
    ]);
  }
  /* Mapa de sombras de la tela: luminancia relativa al tono medio de la zona de estampa.
     Multiplicado sobre el diseño, le da los pliegues reales de la remera. */
  function shadeMap(img, cal) {
    const cv = M.createCanvas(FOTO_PX, FOTO_PX);
    const cx = M.ctx2d(cv);
    cx.drawImage(img, 0, 0, FOTO_PX, FOTO_PX);
    const id = cx.getImageData(0, 0, FOTO_PX, FOTO_PX);
    const d = id.data;
    const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let sum = 0, n = 0;
    const r = cal.k * 8;
    for (let y = cal.cy - r; y < cal.cy + r; y += 2) for (let x = cal.cx - r; x < cal.cx + r; x += 2) { sum += lum((Math.round(y) * FOTO_PX + Math.round(x)) * 4); n++; }
    const mean = Math.max(8, sum / n);
    for (let i = 0; i < d.length; i += 4) {
      // Pliegues suaves: 1 = tono medio, menos = sombra. Se limita para no ensuciar el diseño.
      const v = clamp(0.55 + 0.45 * (lum(i) / mean), 0.6, 1) * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    cx.putImageData(id, 0, 0);
    return cv;
  }

  /* Geometría de la zona de estampa (en píxeles del documento) según la vista */
  function geo(side) {
    const v = vistaReal(side);
    if (v !== 'plana') {
      const c = calDe(v, side), s = DOC / FOTO_PX;
      return { x: c.cx * s, y: c.cy * s, k: c.k * s };
    }
    const t = T(), a = ZONAS[side].area;
    return { x: t.tx + a.x * t.sc, y: t.ty + a.y * t.sc, k: UNITS_PER_CM * t.sc };
  }
  const pxPerCm = (side = st.side) => geo(side).k;
  const areaCenter = (side) => geo(side);
  /* Rectángulo del diseño en píxeles del documento */
  function designRect(side, d = actual(side)) {
    if (!d) return null;
    const c = geo(side), k = c.k;
    const w = d.w * k, h = w * d.img.height / d.img.width;
    return { x: c.x + d.x * k - w / 2, y: c.y + d.y * k - h / 2, w, h };
  }

  function drawMock(canvas, side, opts = {}) {
    const size = canvas.width;
    const k = size / DOC;
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, size, size);
    const view = side === 'espalda' ? 'back' : 'front';
    const f = foto(side);
    const usaFoto = f && f.ok;
    const t = T();
    if (usaFoto) {
      c.imageSmoothingQuality = 'high';
      c.drawImage(f.img, 0, 0, size, size);
    } else if (!f) {
      const shirt = M.renderShirt(k, colorActual().hex, 'flat', view);
      c.save();
      c.shadowColor = 'rgba(20,30,70,.22)';
      c.shadowBlur = 30 * k;
      c.shadowOffsetY = 12 * k;
      c.drawImage(shirt, 0, 0);
      c.restore();
    } else {
      return;   // la foto todavía está cargando: se redibuja sola al terminar
    }
    if (hayEn(side)) {
      const layer = M.createCanvas(size, size);
      const lc = layer.getContext('2d');
      lc.imageSmoothingQuality = 'high';
      lista(side).forEach((d) => { const r = designRect(side, d); lc.drawImage(d.preview || d.img, r.x * k, r.y * k, r.w * k, r.h * k); });
      if (usaFoto) {
        // Pliegues reales de la foto, solo dentro de las estampas (se recorta con una copia de todas juntas)
        const forma = M.createCanvas(size, size);
        forma.getContext('2d').drawImage(layer, 0, 0);
        lc.globalCompositeOperation = 'multiply';
        lc.drawImage(f.shade, 0, 0, size, size);
        lc.globalCompositeOperation = 'destination-in';
        lc.drawImage(forma, 0, 0);
        c.save();
        c.globalAlpha = 0.96;
        c.drawImage(layer, 0, 0);
        c.restore();
      } else {
        // El diseño sigue las sombras y la textura de la remera dibujada
        const L = M.getFabricLayers('flat', view);
        lc.globalCompositeOperation = 'source-atop';
        lc.setTransform(k * t.sc, 0, 0, k * t.sc, k * t.tx, k * t.ty);
        lc.globalAlpha = 0.35; lc.drawImage(L.shadow, 0, 0);
        lc.globalAlpha = 0.12; lc.drawImage(L.light, 0, 0);
        lc.globalAlpha = 0.25; lc.drawImage(L.texture, 0, 0);
        c.save();
        c.setTransform(k * t.sc, 0, 0, k * t.sc, k * t.tx, k * t.ty);
        c.clip(new Path2D(M.shirtPath('flat', view)));
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(layer, 0, 0);
        c.restore();
      }
      if (opts.edit) {
        // Recuadro: la estampa elegida resaltada, las otras apenas marcadas
        const elegida = actual(side);
        lista(side).forEach((d) => {
          const r = designRect(side, d);
          c.save();
          if (d === elegida) {
            c.strokeStyle = usaFoto ? '#ffffff' : '#0d4fa3';
            c.lineWidth = 2;
            c.setLineDash([6, 4]);
            c.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k);
            if (usaFoto) { c.strokeStyle = '#0d4fa3'; c.lineDashOffset = 5; c.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k); }
          } else {
            c.strokeStyle = usaFoto ? 'rgba(255,255,255,.45)' : 'rgba(13,79,163,.3)';
            c.lineWidth = 1;
            c.setLineDash([3, 4]);
            c.strokeRect(r.x * k, r.y * k, r.w * k, r.h * k);
          }
          c.restore();
        });
      }
    }
    if (opts.edit) {
      // Zona máxima de estampa (guía suave)
      // Área de trabajo (guía suave): todo el cuerpo de la remera
      const g = geo(side), L = limites(side);
      c.save();
      c.strokeStyle = usaFoto ? 'rgba(255,255,255,.55)' : 'rgba(13,79,163,.28)';
      c.setLineDash([4, 6]);
      c.lineWidth = 1.5;
      c.strokeRect((g.x + L.l * g.k) * k, (g.y + L.t * g.k) * k, (L.r - L.l) * g.k * k, (L.b - L.t) * g.k * k);
      if (opts.guideX) { c.strokeStyle = '#e5157a'; c.setLineDash([]); c.beginPath(); c.moveTo(g.x * k, 0); c.lineTo(g.x * k, size); c.stroke(); }
      c.restore();
    }
  }

  /* Botones de vista debajo de la remera */
  function renderVistas() {
    $$('.view-tabs').forEach((box) => {
      const ladoManga = st.step === 2 && st.side === 'manga';
      box.innerHTML = VISTAS.map((v) => `<button type="button" data-vista="${v.id}" aria-pressed="${vistaReal(st.step === 2 ? st.side : 'frente') === v.id}" ${(v.id !== 'plana' && !hayFotos()) || (v.id === 'plana' && ladoManga) ? 'disabled' : ''}>${v.label}</button>`).join('');
      $$('button', box).forEach((b) => b.addEventListener('click', () => {
        st.vista = b.dataset.vista;
        // Cada foto muestra un poco distinto el cuerpo: las estampas se acomodan dentro del área de esta vista
        LADOS.forEach((side) => lista(side).forEach((d) => fitInside(d, side)));
        renderVistas();
        if (st.step === 2) renderStep2(); else redraw();
      }));
    });
  }

  function canvasSize(canvas) {
    const css = canvas.getBoundingClientRect().width || 460;
    const px = Math.round(clamp(css * (window.devicePixelRatio || 1), 400, 1254));
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  }
  let drawTimer = 0;
  function redraw() {
    cancelAnimationFrame(drawTimer);
    drawTimer = requestAnimationFrame(() => {
      if (st.step === 1) { const c = $('#mock-1'); canvasSize(c); drawMock(c, 'frente'); }
      if (st.step === 2) {
        const c = $('#mock-2'); canvasSize(c); drawMock(c, st.side, { edit: true, guideX: drag.guideX });
        drawMock($('#mock-mini'), otroLado());   // el otro lado, en chiquito
      }
      updatePrice();
    });
  }

  /* =========================================================
     5. PASO 1 · REMERA
     ========================================================= */
  function renderStep1() {
    const models = $('#models');
    models.innerHTML = catalogo.length > 1 ? catalogo.map((m) => `<button type="button" class="model-card" role="radio" aria-checked="${m.id === st.modelo}" data-id="${esc(m.id)}"><span><strong>${esc(m.nombre)}</strong></span><small>desde ${money(m.precio)}</small></button>`).join('') : '';
    $$('.model-card', models).forEach((b) => b.addEventListener('click', () => { st.modelo = b.dataset.id; st.color = null; st.talle = null; renderStep1(); }));
    const m = modeloActual();
    if (!st.color || !m.colores.some((c) => c.nombre === st.color)) st.color = m.colores[0].nombre;
    const colors = $('#colors');
    colors.innerHTML = m.colores.map((c) => `<button type="button" role="radio" aria-checked="${c.nombre === st.color}" aria-label="${esc(c.nombre)}" title="${esc(c.nombre)}" style="background:${c.hex}" data-c="${esc(c.nombre)}"></button>`).join('');
    $$('button', colors).forEach((b) => b.addEventListener('click', () => { st.color = b.dataset.c; renderStep1(); }));
    $('#color-name').textContent = st.color;
    const sizes = $('#sizes');
    sizes.innerHTML = m.talles.map((t) => `<button type="button" role="radio" aria-checked="${t === st.talle}" data-t="${esc(t)}">${esc(t)}</button>`).join('');
    $$('button', sizes).forEach((b) => b.addEventListener('click', () => { st.talle = b.dataset.t; renderStep1(); }));
    $('#qty').value = st.cantidad;
    renderVistas();
    foto('espalda');
    redraw();
  }

  /* =========================================================
     6. PASO 2 · DISEÑO
     ========================================================= */
  const drag = { on: false, guideX: false };

  const otroLado = () => (st.side === 'frente' ? 'espalda' : 'frente');
  /* Lado que conviene sugerir para sumar una estampa */
  const sugerido = () => ['espalda', 'manga', 'frente'].find((l) => l !== st.side && !hayEn(l) && (l !== 'manga' || hayFotos()));
  function renderStep2() {
    const otro = otroLado();
    $('#mini-label').textContent = hayEn(otro) ? ZONAS[otro].label : `＋ ${ZONAS[otro].label}`;
    $('#mini-side').setAttribute('aria-label', `Ver y editar ${ZONAS[otro].label.toLowerCase()}`);
    const sug = sugerido();
    $('#add-other').hidden = !hayEn(st.side) || !sug;
    if (sug) { $('#other-name').textContent = CON_ARTICULO[sug]; $('#add-other').dataset.side = sug; }
    $('#tab-manga').hidden = !hayFotos();
    $('#dot-manga').classList.toggle('on', hayEn('manga'));
    $$('.side-tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === st.side)));
    $('#dot-frente').classList.toggle('on', hayEn('frente'));
    $('#dot-espalda').classList.toggle('on', hayEn('espalda'));
    $('#side-name').textContent = CON_ARTICULO[st.side];
    renderVistas();
    const d = actual();
    $('#upload-btn').hidden = !!d;
    $('#design-tools').hidden = !d;
    // Lista de estampas de este lado + botón para sumar otra
    const L = lista(st.side);
    $('#stamps').hidden = !d;
    $('#stamps').innerHTML = L.map((x, i) => `<button type="button" class="stamp-chip" data-id="${x.id}" aria-pressed="${x === d}"><img src="${x.thumb}" alt="" width="34" height="34"><span>${L.length > 1 ? `Estampa ${i + 1}` : 'Estampa'}<small>${cmTxt(x.w)} cm</small></span></button>`).join('')
      + (L.length < MAX_POR_LADO ? `<button type="button" class="stamp-chip add" id="add-same">＋ Otra en ${ZONAS[st.side].label.toLowerCase()}</button>` : '');
    $$('#stamps .stamp-chip[data-id]').forEach((b) => b.addEventListener('click', () => { st.sel[st.side] = b.dataset.id; renderStep2(); }));
    const addSame = $('#add-same');
    if (addSame) addSame.addEventListener('click', () => { st.reemplazar = false; $('#file').click(); });
    $('#drag-hint').hidden = !d;
    $('#mock-2').classList.toggle('has-design', !!d);
    if (d) {
      const mw = anchoMax(st.side);
      const size = $('#size');
      size.max = mw;
      size.value = d.w;
      const h = d.w * d.img.height / d.img.width;
      $('#size-label').textContent = `${cmTxt(d.w)} × ${cmTxt(h)} cm`;
      $('#presets').innerHTML = ZONAS[st.side].presets.map(([n, w]) => `<button type="button" data-w="${w}" aria-pressed="${Math.abs(d.w - w) < 0.3}">${n} · ${w} cm</button>`).join('');
      $$('#presets button').forEach((b) => b.addEventListener('click', () => { setWidth(Number(b.dataset.w)); if (Number(b.dataset.w) <= 10 && st.side === 'frente') { d.x = -6; d.y = -8; } else if (L.length === 1) { d.x = 0; d.y = 0; } fitInside(d); renderStep2(); }));
      // Resolución efectiva (ppp) para el tamaño elegido
      const ppp = Math.round(d.img.width / (d.w / 2.54));
      const warn = $('#res-warn');
      warn.hidden = ppp >= 150;
      warn.textContent = `Tu imagen tiene poca resolución para ${cmTxt(d.w)} cm (${ppp} ppp): puede verse pixelada. Probá un tamaño más chico o una imagen más grande.`;
      $('#stamp-price').innerHTML = `${L.length > 1 ? `Estampa ${L.indexOf(d) + 1}` : 'Esta estampa'}: <b>${money(precioEstampa(d.w, h))}</b>`;
      $('#bg-btn').disabled = d.bgRemoved;
      $('#bg-btn').textContent = d.bgRemoved ? '✓ Fondo quitado' : '✦ Quitar fondo';
    }
    redraw();
  }

  /* Mantiene el diseño dentro de la zona de estampa */
  function fitInside(d, side = st.side) {
    const L = limites(side), mw = L.r - L.l, mh = L.b - L.t;
    let h = d.w * d.img.height / d.img.width;
    if (h > mh) { d.w = mh * d.img.width / d.img.height; h = mh; }
    d.w = Math.min(d.w, mw);
    h = d.w * d.img.height / d.img.width;
    d.x = clamp(d.x, L.l + d.w / 2, L.r - d.w / 2);
    d.y = clamp(d.y, L.t + h / 2, L.b - h / 2);
  }
  function setWidth(w) {
    const d = actual();
    if (!d) return;
    d.w = clamp(w, 3, anchoMax(st.side));
    fitInside(d);
  }

  async function loadFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Usá una imagen PNG, JPG o WEBP.'); return; }
    if (file.size > 40 * 1024 * 1024) { toast('La imagen pesa demasiado (máximo 40 MB).'); return; }
    setBusy(true, 'Cargando imagen…');
    try {
      let img = await M.blobToCanvas(file);
      img = M.fitInside(img, 4200);                 // suficiente para 35 cm a 300 ppp
      const prev = st.reemplazar ? actual() : null;
      if (!prev && lista(st.side).length >= MAX_POR_LADO) { toast(`Hasta ${MAX_POR_LADO} estampas por lado.`); return; }
      const nueva = !prev && lista(st.side).length > 0;
      // Una estampa nueva junto a otra arranca chica y corrida, para que no queden encimadas
      const d = {
        id: uid(), img, preview: M.fitInside(img, 900), thumb: miniatura(img), name: file.name, bgRemoved: false,
        w: prev ? prev.w : (nueva ? 9 : ZONAS[st.side].presets[1][1]),
        x: prev ? prev.x : (nueva ? 6 : 0), y: prev ? prev.y : (nueva ? -8 : 0),
      };
      if (prev) lista(st.side).splice(lista(st.side).indexOf(prev), 1, d);
      else lista(st.side).push(d);
      st.sel[st.side] = d.id;
      st.reemplazar = false;
      fitInside(d);
      renderStep2();
      if (!hasAlpha(img)) toast('¿Tu imagen tiene fondo? Tocá «Quitar fondo» para que se estampe solo el dibujo.');
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir la imagen.');
    } finally {
      setBusy(false);
    }
  }
  /* Miniatura para la lista de estampas */
  function miniatura(img) {
    const c = M.createCanvas(68, 68);
    const x = c.getContext('2d');
    const s = Math.min(68 / img.width, 68 / img.height);
    x.drawImage(img, (68 - img.width * s) / 2, (68 - img.height * s) / 2, img.width * s, img.height * s);
    return c.toDataURL('image/png');
  }
  function hasAlpha(canvas) {
    const s = M.fitInside(canvas, 200);
    const d = M.ctx2d(s).getImageData(0, 0, s.width, s.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }

  /* Quitar fondo: IA en el navegador; si no está disponible, por color de las esquinas */
  let bgLib = null;
  async function quitarFondo() {
    const d = actual();
    if (!d) return;
    setBusy(true, 'Quitando el fondo…');
    try {
      let mask;
      try {
        if (!bgLib) bgLib = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
        const remove = bgLib.removeBackground || bgLib.default;
        const blob = await M.canvasToBlob(M.fitInside(d.img, 2048));
        const res = await remove(blob, {
          model: 'isnet_quint8',
          output: { format: 'image/png', type: 'mask' },
          progress: (k, cur, tot) => { if (tot) setBusy(true, `Preparando… ${Math.round(cur / tot * 100)}%`); },
        });
        mask = await M.blobToCanvas(res);
      } catch (e) {
        console.warn('IA no disponible, quito el fondo por color', e);
        mask = maskByCorners(d.img);
      }
      applyMask(d.img, mask);
      d.preview = M.fitInside(d.img, 900);
      d.thumb = miniatura(d.img);
      d.bgRemoved = true;
      renderStep2();
      toast('Listo: fondo quitado.');
    } catch (err) {
      console.error(err);
      toast('No se pudo quitar el fondo.');
    } finally {
      setBusy(false);
    }
  }
  function applyMask(img, mask) {
    const m = M.resizeCanvas(mask, img.width, img.height);
    const md = M.ctx2d(m).getImageData(0, 0, img.width, img.height).data;
    const c = M.ctx2d(img);
    const id = c.getImageData(0, 0, img.width, img.height);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = md[i + 3] * md[i] / 255;   // sirve para máscaras en gris (IA) o en alfa (respaldo)
      id.data[i + 3] = Math.min(id.data[i + 3], v >= 128 ? 255 : 0);   // borde sólido, apto DTF
    }
    c.putImageData(id, 0, 0);
  }
  function maskByCorners(img) {
    const s = M.fitInside(img, 1500);
    const w = s.width, h = s.height;
    const d = M.ctx2d(s).getImageData(0, 0, w, h).data;
    const t = [0, 0, 0];
    [0, w - 1, (h - 1) * w, h * w - 1].forEach((p) => { for (let k = 0; k < 3; k++) t[k] += d[p * 4 + k] / 4; });
    const tol2 = 40 * 40;
    const bg = new Uint8Array(w * h);
    const stack = [];
    const push = (p) => {
      if (bg[p]) return;
      const dr = d[p * 4] - t[0], dg = d[p * 4 + 1] - t[1], db = d[p * 4 + 2] - t[2];
      if (dr * dr + dg * dg + db * db <= tol2) { bg[p] = 1; stack.push(p); }
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop(), x = p % w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (p >= w) push(p - w);
      if (p < w * (h - 1)) push(p + w);
    }
    const out = M.createCanvas(w, h);
    const oc = M.ctx2d(out);
    const od = oc.createImageData(w, h);
    for (let p = 0; p < w * h; p++) { od.data[p * 4] = od.data[p * 4 + 1] = od.data[p * 4 + 2] = 255; od.data[p * 4 + 3] = bg[p] ? 0 : 255; }
    oc.putImageData(od, 0, 0);
    return out;
  }

  /* Arrastrar el diseño (mouse y dedo) */
  function initDrag() {
    const cv = $('#mock-2');
    let start = null;
    const toDoc = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * DOC, (e.clientY - r.top) / r.height * DOC]; };
    cv.addEventListener('pointerdown', (e) => {
      if (!hayEn(st.side)) return;
      const [px, py] = toDoc(e);
      const dentro = (d, pad) => { const r = designRect(st.side, d); return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad; };
      // Primero la que está arriba; si no, la elegida con un margen para el dedo
      const L = lista(st.side);
      const d = L.slice().reverse().find((x) => dentro(x, 0)) || (dentro(actual(), 30) ? actual() : null);
      if (!d) return;
      if (st.sel[st.side] !== d.id) { st.sel[st.side] = d.id; renderStep2(); }
      start = { px, py, x: d.x, y: d.y, d };
      drag.on = true;
      cv.setPointerCapture(e.pointerId);
      cv.classList.add('is-dragging');
    });
    cv.addEventListener('pointermove', (e) => {
      if (!start) return;
      const d = start.d;
      const [px, py] = toDoc(e);
      const k = pxPerCm();
      d.x = start.x + (px - start.px) / k;
      d.y = start.y + (py - start.py) / k;
      drag.guideX = Math.abs(d.x) < 0.6;          // imán al centro
      if (drag.guideX) d.x = 0;
      fitInside(d);
      redraw();
    });
    const end = () => { if (!start) return; start = null; drag.on = false; drag.guideX = false; cv.classList.remove('is-dragging'); redraw(); };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    // Teclado: flechas mueven el diseño medio centímetro
    cv.addEventListener('keydown', (e) => {
      const d = actual();
      const mv = { ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0], ArrowUp: [0, -0.5], ArrowDown: [0, 0.5] }[e.key];
      if (!d || !mv) return;
      e.preventDefault();
      d.x += mv[0]; d.y += mv[1];
      fitInside(d);
      redraw();
    });
  }

  /* =========================================================
     7. PASO 3 · PEDIDO Y ENVÍO
     ========================================================= */
  function mockBlobs(size = 900) {
    const sides = LADOS.filter((s) => s === 'frente' || hayEn(s));
    return sides.map((s) => {
      const c = M.createCanvas(size, size);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      const tmp = M.createCanvas(size, size);
      drawMock(tmp, s);
      ctx.drawImage(tmp, 0, 0);
      return { side: s, canvas: c };
    });
  }

  /* Frente y espalda juntos en una sola imagen (si hay estampa atrás) */
  function mockCompleto(h = 900) {
    const partes = mockBlobs(h);
    if (partes.length === 1) return partes[0].canvas;
    const pad = Math.round(h * 0.03), label = Math.round(h * 0.07);
    const c = M.createCanvas(h * partes.length + pad * (partes.length - 1), h + label);
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, c.width, c.height);
    partes.forEach(({ side, canvas }, i) => {
      x.drawImage(canvas, i * (h + pad), 0);
      x.fillStyle = '#1b2a6e';
      x.font = `700 ${Math.round(label * 0.45)}px Inter, Arial, sans-serif`;
      x.textAlign = 'center';
      x.fillText(ZONAS[side].label, i * (h + pad) + h / 2, h + label * 0.68);
    });
    return c;
  }

  function renderStep3() {
    const m = modeloActual();
    const t = totales();
    const box = $('#summary-mocks');
    box.innerHTML = '';
    fotosListas().then(() => {
      box.innerHTML = '';
      mockBlobs(700).forEach(({ side, canvas }) => {
        const fig = document.createElement('figure');
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Tu remera, ${ZONAS[side].label.toLowerCase()}`);
        fig.appendChild(canvas);
        fig.insertAdjacentHTML('beforeend', `<figcaption>${ZONAS[side].label}</figcaption>`);
        box.appendChild(fig);
      });
    });
    $('#summary').innerHTML = `
      <div><dt>${esc(m.nombre)} · ${esc(st.color)} · talle ${esc(st.talle)}</dt><dd>${money(m.precio)}</dd></div>
      ${t.est.map((e) => `<div><dt>Estampa ${e.zona.toLowerCase()} ${cmTxt(e.ancho)} × ${cmTxt(e.alto)} cm</dt><dd>${money(e.precio)}</dd></div>`).join('')}
      <hr>
      <div><dt>Por remera</dt><dd>${money(t.porPrenda)}</dd></div>
      <div><dt>Cantidad</dt><dd>× ${st.cantidad}</dd></div>
      <div class="profit"><dt><b>Total</b></dt><dd>${money(t.total)}</dd></div>
      ${senaMonto(t.total) ? `<div class="sena-row"><dt>Seña para confirmar</dt><dd>${money(senaMonto(t.total))}</dd></div>
      <div><dt>Resto al retirar</dt><dd>${money(t.total - senaMonto(t.total))}</dd></div>` : ''}`;
    const sena = senaMonto(t.total);
    $('#pay-help').innerHTML = sena
      ? `Para <b>confirmar</b> tu pedido se paga una seña de <b>${money(sena)}</b>${window.TEPago && TEPago.disponible(negocio) ? ' con Mercado Pago o' : ''} por transferencia${aliasPago() ? ` al alias <b>${esc(aliasPago())}</b>` : ''}. Te pasamos los datos al enviarlo. Producción en 3 a 5 días desde la seña.`
      : 'Te escribimos por WhatsApp para confirmar el pedido, el pago y la entrega. Producción en 3 a 5 días.';
  }

  async function enviarPedido() {
    const err = $('#o-error');
    err.textContent = '';
    const name = $('#o-name').value.trim();
    const phone = $('#o-phone').value.trim();
    if (!name) { err.textContent = 'Escribí tu nombre.'; $('#o-name').focus(); return; }
    const tel = telefonoAR(phone);
    if (!tel) { err.textContent = 'Revisá tu WhatsApp: escribilo con código de área, por ejemplo 342 4123456.'; $('#o-phone').focus(); return; }
    // Campo trampa: las personas no lo ven; si viene completo, es un robot
    if ($('#o-web').value) { mostrarConfirmacion({ id: uid(), cliente: name, total: 0, sena: 0, items: [{ estampas: [] }] }, true); return; }
    if (Date.now() - paso3Desde < 3000) { err.textContent = 'Revisá tus datos y volvé a tocar «Enviar pedido».'; paso3Desde = 0; return; }
    if (!puedePedir()) { err.textContent = 'Ya enviaste varios pedidos en la última hora. Si necesitás otro, escribinos por WhatsApp.'; return; }
    const btn = $('#next-btn');
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const id = uid();
      const t = totales();
      const files = [];
      // Archivos de impresión: la imagen original con su medida en el nombre
      for (const e of t.est) {
        const n = lista(e.side).length > 1 ? `-${e.n}` : '';
        files.push({ blob: await M.canvasToBlob(e.d.img, 'image/png'), name: `${e.side}${n}-${cmTxt(e.ancho).replace(',', '.')}x${cmTxt(e.alto).replace(',', '.')}cm.png` });
      }
      await fotosListas();
      for (const { side, canvas } of mockBlobs(1000)) files.push({ blob: await M.canvasToBlob(canvas, 'image/jpeg', 0.9), name: `mockup-${side}.jpg` });
      if (hayEn('espalda') || hayEn('manga')) files.push({ blob: await M.canvasToBlob(mockCompleto(800), 'image/jpeg', 0.9), name: 'mockup-completo.jpg' });
      const pedido = {
        id, origen: 'tienda', estado: 'sena', fecha: new Date().toISOString(),
        cliente: name.slice(0, 80), telefono: tel, notas: $('#o-notes').value.trim().slice(0, 600), total: t.total,
        sena: senaMonto(t.total), sena_pagada: false,
        items: [{
          modelo_id: modeloActual().id, color: st.color, talle: st.talle, cantidad: st.cantidad,
          estampas: t.est.map((e) => ({ zona: e.zona, ancho: Math.round(e.ancho * 10) / 10, alto: Math.round(e.alto * 10) / 10, cantidad: 1, precio: e.precio, x: Math.round(e.d.x * 10) / 10, y: Math.round(e.d.y * 10) / 10 })),
        }],
        imagenes: [], stock_descontado: false,
      };
      if (modo === 'nube') {
        // Primero se registra el pedido (la base controla los límites) y después se suben las imágenes
        pedido.imagenes = files.map((f) => ({ ref: `sb:tienda/${id}/${f.name}`, name: f.name }));
        const sinRespuesta = new Promise((res) => setTimeout(() => res({ error: new Error('Sin respuesta del servidor') }), 20000));
        const { error } = await Promise.race([sb.from('pedidos').insert(pedido), sinRespuesta]);
        if (error) {
          if (/demasiados|limite|límite/i.test(error.message || '')) { err.textContent = 'Recibimos muchos pedidos desde este número en la última hora. Escribinos por WhatsApp y lo vemos.'; return; }
          throw error;
        }
        for (const f of files) {
          const { error: e2 } = await sb.storage.from('pedidos').upload(`tienda/${id}/${f.name}`, f.blob, { contentType: f.blob.type });
          if (e2) throw e2;
        }
      } else {
        await guardarDemo(pedido, files);
      }
      st.pedidoId = id;
      anotarEnvio();
      mostrarConfirmacion(pedido);
    } catch (e) {
      console.error(e);
      err.textContent = 'No se pudo enviar el pedido. Revisá tu conexión e intentá de nuevo, o escribinos por WhatsApp.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar pedido';
    }
  }

  /* Modo demo: guarda el pedido en el panel de este dispositivo */
  function idbPut(key, blob) {
    return new Promise((res, rej) => {
      const r = indexedDB.open('te-panel', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('img');
      r.onsuccess = () => {
        const tx = r.result.transaction('img', 'readwrite');
        tx.objectStore('img').put(blob, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      };
      r.onerror = () => rej(r.error);
    });
  }
  async function guardarDemo(pedido, files) {
    for (const f of files) {
      const key = `${uid()}-${f.name}`;
      await idbPut(key, f.blob);
      pedido.imagenes.push({ ref: 'idb:' + key, name: f.name });
    }
    let d = null;
    try { d = JSON.parse(localStorage.getItem('te_panel_data_v1') || 'null'); } catch (e) { d = null; }
    if (!d) d = { modelos: [], variantes: [], movimientos: [], pedidos: [], config: {} };
    pedido.numero = (d.pedidos || []).reduce((a, p) => Math.max(a, p.numero || 0), 0) + 1;
    d.pedidos = [...(d.pedidos || []), pedido];
    localStorage.setItem('te_panel_data_v1', JSON.stringify(d));
  }

  function resumenTexto(p) {
    const it = p.items[0];
    const lines = [`¡Hola! Hice un pedido en la tienda (código ${p.id.slice(-6).toUpperCase()}):`,
      `• ${it.cantidad} × ${modeloActual().nombre} ${it.color}, talle ${it.talle}`];
    it.estampas.forEach((e) => lines.push(`• Estampa ${e.zona.toLowerCase()} ${cmTxt(e.ancho)} × ${cmTxt(e.alto)} cm`));
    lines.push(`Total: ${money(p.total)}`);
    if (p.sena) lines.push(`Te mando el comprobante de la seña de ${money(p.sena)}.`);
    lines.push(`Soy ${p.cliente}.`);
    return lines.join('\n');
  }

  function mostrarConfirmacion(p, trampa = false) {
    goStep('ok');
    const codigo = p.id.slice(-6).toUpperCase();
    const alias = aliasPago();
    $('#ok-title').textContent = p.sena ? '¡Pedido reservado!' : '¡Pedido enviado!';
    $('#ok-text').innerHTML = p.sena
      ? `Gracias, ${esc(p.cliente)}. Tu pedido <b>${codigo}</b> por <b>${money(p.total)}</b> queda reservado. Para <b>confirmarlo</b>, transferí la seña y mandanos el comprobante por WhatsApp.${modo === 'demo' && !trampa ? '<br><small>(Modo demo: el pedido quedó en el panel de este dispositivo.)</small>' : ''}`
      : `Gracias, ${esc(p.cliente)}. Recibimos tu pedido <b>${codigo}</b> por <b>${money(p.total)}</b>. Te escribimos por WhatsApp para confirmar el pago y la entrega.`;
    const pay = $('#ok-pay');
    pay.hidden = !p.sena;
    if (p.sena) {
      $('#ok-sena').textContent = money(p.sena);
      $('#ok-alias').textContent = alias || 'te lo pasamos por WhatsApp';
      $('#ok-copy').hidden = !alias;
      $('#ok-vence').textContent = `Si no recibimos la seña en ${VENCE_DIAS} días, el pedido se cancela solo. El resto (${money(p.total - p.sena)}) se paga al retirar.`;
      // Mercado Pago (si el dueño lo activó en el panel y la web está publicada)
      const mp = !trampa && window.TEPago && TEPago.disponible(negocio) && modo === 'nube';
      $('#ok-mp').hidden = !mp;
      $('#ok-or').hidden = !mp;
      // Botón con el monto exacto (con el costo de Mercado Pago si está configurado)
      const montoMP = TEPago.montoConRecargo(p.sena, negocio);
      const etiquetaMP = `Pagar ${money(montoMP)} con Mercado Pago`;
      $('#ok-mp').textContent = etiquetaMP;
      $('#ok-mp-nota').hidden = !mp || montoMP <= p.sena;
      $('#ok-mp-nota').textContent = 'Incluye el costo del servicio de Mercado Pago. Por transferencia pagás el precio sin recargo.';
      $('#ok-mp').onclick = async () => {
        $('#ok-mp').disabled = true;
        $('#ok-mp').textContent = 'Abriendo Mercado Pago…';
        try { await TEPago.iniciar(p.id); } catch (e) { toast(`No se pudo abrir Mercado Pago (${e.message}). Probá de nuevo o pagá por transferencia.`); $('#ok-mp').disabled = false; $('#ok-mp').textContent = etiquetaMP; }
      };
    }
    const box = $('#ok-mocks');
    box.innerHTML = '';
    const f = document.createElement('figure');
    f.className = 'wide';
    const img = mockCompleto(500);
    img.setAttribute('role', 'img');
    img.setAttribute('aria-label', 'Tu remera terminada');
    f.appendChild(img);
    box.appendChild(f);
    const wa = whatsappNegocio();
    const link = $('#ok-wa');
    link.hidden = !wa;
    if (wa) link.href = `https://wa.me/${wa}?text=${encodeURIComponent(trampa ? '¡Hola!' : resumenTexto(p))}`;
    link.textContent = p.sena ? 'Enviar comprobante por WhatsApp' : 'Avisar por WhatsApp';
  }

  /* =========================================================
     8. NAVEGACIÓN ENTRE PASOS
     ========================================================= */
  function goStep(n) {
    st.step = n;
    $('#toast').hidden = true;
    ['1', '2', '3', 'ok'].forEach((k) => { $(`#step-${k}`).hidden = String(n) !== k; });
    $$('.steps button').forEach((b) => {
      const s = Number(b.dataset.step);
      b.setAttribute('aria-current', s === n ? 'step' : 'false');
      if (s !== n) b.removeAttribute('aria-current');
      b.classList.toggle('is-done', typeof n === 'number' && s < n);
      b.disabled = n === 'ok';
    });
    $('#buybar').hidden = n === 'ok';
    $('#back-btn').hidden = n === 1 || n === 'ok';
    $('#next-btn').textContent = n === 3 ? 'Enviar pedido' : 'Siguiente';
    if (n === 1) renderStep1();
    if (n === 2) renderStep2();
    if (n === 3) { renderStep3(); paso3Desde = Date.now(); }
    updatePrice();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#contenido').focus({ preventScroll: true });
  }

  function updatePrice() {
    const t = totales();
    $('#buy-total').textContent = money(t.total);
    const parts = [`${st.cantidad} ${st.cantidad === 1 ? 'remera' : 'remeras'}`];
    if (t.est.length) parts.push(`${t.est.length} ${t.est.length === 1 ? 'estampa' : 'estampas'}`);
    $('#buy-detail').textContent = parts.join(' + ');
  }

  function next() {
    if (st.step === 1) {
      if (!st.talle) { toast('Elegí tu talle para seguir.'); $('#sizes button')?.focus(); return; }
      goStep(2);
    } else if (st.step === 2) {
      if (!LADOS.some(hayEn)) { toast('Subí al menos una imagen para estampar.'); return; }
      goStep(3);
    } else if (st.step === 3) {
      enviarPedido();
    }
  }

  /* =========================================================
     9. INICIO
     ========================================================= */
  async function init() {
    // Chispas del header (como en el resto de la app)
    const energy = $('.header-energy');
    const dur = [3.8, 4.5, 5.2, 5.9];
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('i');
      s.className = 'header-energy-spark';
      s.style.left = ((i * 37) % 100) + '%';
      s.style.top = (15 + ((i * 23) % 70)) + '%';
      s.style.animationDelay = (-0.67 * i).toFixed(2) + 's';
      s.style.animationDuration = dur[i % 4] + 's';
      energy.appendChild(s);
    }
    await cargarCatalogo();
    st.modelo = catalogo[0].id;
    const pedido = new URLSearchParams(location.search).get('color');
    if (pedido && catalogo[0].colores.some((c) => c.nombre === pedido)) st.color = pedido;
    const wa = whatsappNegocio();
    const contact = $('#contact-link');
    if (wa) contact.href = `https://wa.me/${wa}`;
    else if (CFG.instagram) contact.href = `https://www.instagram.com/${CFG.instagram}`;
    else contact.hidden = true;

    $('#qty-minus').addEventListener('click', () => { st.cantidad = Math.max(1, st.cantidad - 1); $('#qty').value = st.cantidad; updatePrice(); });
    $('#qty-plus').addEventListener('click', () => { st.cantidad = Math.min(200, st.cantidad + 1); $('#qty').value = st.cantidad; updatePrice(); });
    $('#qty').addEventListener('change', (e) => { st.cantidad = clamp(Math.round(Number(e.target.value) || 1), 1, 200); e.target.value = st.cantidad; updatePrice(); });

    $$('.side-tabs button').forEach((b) => b.addEventListener('click', () => { st.side = b.dataset.side; renderStep2(); }));
    $('#upload-btn').addEventListener('click', () => { st.reemplazar = false; $('#file').click(); });
    $('#change-btn').addEventListener('click', () => { st.reemplazar = true; $('#file').click(); });
    $('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
    $('#remove-btn').addEventListener('click', () => { const d = actual(); if (d) { lista(st.side).splice(lista(st.side).indexOf(d), 1); st.sel[st.side] = null; } renderStep2(); });
    $('#center-btn').addEventListener('click', () => { const d = actual(); if (d) { d.x = 0; fitInside(d); renderStep2(); } });
    $('#bg-btn').addEventListener('click', quitarFondo);
    const irAlOtroLado = () => { st.side = otroLado(); renderStep2(); $('#mock-2').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
    $('#mini-side').addEventListener('click', irAlOtroLado);
    $('#add-other').addEventListener('click', (e) => { st.side = e.currentTarget.dataset.side || otroLado(); renderStep2(); st.reemplazar = false; $('#file').click(); });
    $('#size').addEventListener('input', (e) => { setWidth(Number(e.target.value)); renderStep2(); });
    initDrag();

    $('#next-btn').addEventListener('click', next);
    $('#back-btn').addEventListener('click', () => goStep(st.step - 1));
    $$('.steps button').forEach((b) => b.addEventListener('click', () => {
      const s = Number(b.dataset.step);
      if (s < st.step) goStep(s);
      else if (s === st.step + 1) next();
    }));
    $('#order-form').addEventListener('submit', (e) => { e.preventDefault(); enviarPedido(); });
    $('#ok-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(aliasPago()); toast('Alias copiado: ' + aliasPago()); } catch (e) { toast('Alias: ' + aliasPago()); }
    });
    $('#ok-new').addEventListener('click', () => { st.designs = { frente: [], espalda: [], manga: [] }; st.sel = { frente: null, espalda: null, manga: null }; st.side = 'frente'; goStep(1); });
    $('#ok-dl').addEventListener('click', async () => {
      await fotosListas();
      const blob = await M.canvasToBlob(mockCompleto(1100), 'image/jpeg', 0.92);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mi-remera-tu-estampa-sf.jpg';
      a.click();
    });
    // Pegar una imagen con Ctrl + V en el paso 2
    document.addEventListener('paste', (e) => {
      if (st.step !== 2 || e.target.closest('input, textarea')) return;
      const f = Array.from(e.clipboardData.items || []).find((i) => i.type.startsWith('image/'));
      if (f) loadFile(f.getAsFile());
    });
    window.addEventListener('resize', redraw);
    goStep(1);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
