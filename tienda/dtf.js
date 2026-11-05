/* ==========================================================
   Tu Estampa SF · Lienzo DTF por metro para clientes

   El cliente sube sus diseños, elige la medida (cm) y cuántas
   copias quiere. Se acomodan solos en un lienzo de ancho fijo
   (59 cm) y se cobra por largo: desde 1 m y de a medio metro.
   El pedido llega al panel con cada imagen, su medida y la
   ubicación en el lienzo, listo para abrir en "Armar lienzo".

   Índice
    1. Utilidades
    2. Configuración y precios
    3. Diseños (subir, medida, copias)
    4. Acomodar en el lienzo
    5. Dibujo del lienzo
    6. Pedido y pago
    7. Inicio
   ========================================================== */
(function () {
  'use strict';

  /* =========================================================
     1. UTILIDADES
     ========================================================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const money = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const cm = (n) => (Math.round(n * 10) / 10).toLocaleString('es-AR');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30) || 'diseno';
  const metrosTxt = (c) => { const m = c / 100; return `${m.toLocaleString('es-AR')} ${m === 1 ? 'metro' : 'metros'}`; };

  function createCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function fitInside(src, max) {
    const s = Math.min(1, max / Math.max(src.width, src.height));
    if (s >= 1) return src;
    const c = createCanvas(src.width * s, src.height * s);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  async function fileToCanvas(file) {
    const bmp = await createImageBitmap(file);
    const c = createCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    return c;
  }
  const toBlob = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));
  function hasAlpha(canvas) {
    const s = fitInside(canvas, 200);
    const d = s.getContext('2d').getImageData(0, 0, s.width, s.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }

  let toastTimer = 0;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }
  function setBusy(on, text = 'Procesando…') { $('#busy').hidden = !on; $('#busy-text').textContent = text; }
  function waNumber(n) {
    let d = String(n || '').replace(/\D/g, '');
    if (d && !d.startsWith('54')) d = '549' + d.replace(/^0/, '');
    return d;
  }
  /* WhatsApp argentino: 10 dígitos (área + número) o '' si no es válido */
  function telefonoAR(txt) {
    let d = String(txt || '').replace(/\D/g, '');
    if (d.startsWith('54')) d = d.slice(2);
    if (d.startsWith('9') && d.length === 11) d = d.slice(1);
    if (d.startsWith('0')) d = d.slice(1);
    if (d.length === 12) for (const n of [2, 3, 4]) if (d.slice(n, n + 2) === '15') { d = d.slice(0, n) + d.slice(n + 2); break; }
    return /^[1-9]\d{9}$/.test(d) ? d : '';
  }

  /* =========================================================
     2. CONFIGURACIÓN Y PRECIOS
     ========================================================= */
  const CFG = Object.assign({ supabaseUrl: '', supabaseKey: '', whatsapp: '', alias: '', sena: 0 }, window.TIENDA_CONFIG || {});
  // Todo se configura en Panel → Cotizador → «DTF a la venta» (ancho del rollo, mínimo, paso, forma de cobrar)
  const COTIZADOR_INICIAL = { metro: 14000, ancho: 60, merma: 15, ganancia: 100, fijo: 1500, redondeo: 500, dtfModo: 'metro', dtfAncho: 59, dtfMin: 100, dtfPaso: 50, dtfMetro: 0, dtfFijo: 500, dtfMinimo: 0 };
  let cot = { ...COTIZADOR_INICIAL };
  let negocio = {};
  let sb = null;
  let modo = 'demo';

  async function cargarConfig() {
    if (CFG.supabaseUrl && CFG.supabaseKey && window.supabase) {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
      modo = 'nube';
      try {
        const tarde = new Promise((_, rej) => setTimeout(() => rej(new Error('Supabase no responde')), 6000));
        const { data, error } = await Promise.race([sb.from('config').select('*'), tarde]);
        if (error) throw error;
        (data || []).forEach((r) => {
          if (r.clave === 'cotizador') cot = { ...COTIZADOR_INICIAL, ...r.valor };
          if (r.clave === 'tienda') negocio = r.valor || {};
        });
      } catch (e) { console.warn('No se pudo leer la configuración; se usan los valores de siempre', e); }
      return;
    }
    try {
      const d = JSON.parse(localStorage.getItem('te_panel_data_v1') || 'null');
      if (d && d.config && d.config.cotizador) cot = { ...COTIZADOR_INICIAL, ...d.config.cotizador };
      if (d && d.config && d.config.tienda) negocio = d.config.tienda;
    } catch (e) { /* sin datos del panel */ }
  }
  const ANCHO = () => Number(cot.dtfAncho) || 59;
  const MINIMO = () => Number(cot.dtfMin) || 100;
  const PASO = () => Number(cot.dtfPaso) || 50;
  /* Precio de venta del metro (si no se cargó, el costo del metro con la ganancia del cotizador) */
  const PRECIO_METRO = () => Number(cot.dtfMetro) || Math.ceil(cot.metro * (1 + cot.ganancia / 100) / 500) * 500;
  const MODO = () => (cot.dtfModo === 'sueltas' ? 'sueltas' : 'metro');
  /* Estampas sueltas: cada una se cobra por sus cm² (misma cuenta que el cotizador) + un fijo por estampa */
  function precioSuelta(w, h) {
    const costoCm2 = cot.metro / (cot.ancho * 100) * (1 + cot.merma / 100);
    const precioCm2 = costoCm2 * (1 + cot.ganancia / 100);
    const r = Number(cot.redondeo) || 1;
    return Math.ceil((w * h * precioCm2 + (Number(cot.dtfFijo) || 0)) / r) * r;
  }
  const GAP = 0.5;   // separación entre diseños para poder recortarlos (cm)
  const aliasPago = () => negocio.alias || CFG.alias || '';
  const senaDe = (total) => Math.min(Number(negocio.sena ?? CFG.sena ?? 0) || 0, total);
  const whatsappNegocio = () => waNumber(negocio.whatsapp || CFG.whatsapp);

  /* =========================================================
     3. DISEÑOS
     ========================================================= */
  const MAX_DISENOS = 30;
  const MAX_COPIAS = 200;
  let piezas = [];   // { id, img, prev, thumb, name, w (cm), cant, alpha }

  const altoDe = (p) => p.w * p.img.height / p.img.width;
  const usable = () => ANCHO() - GAP * 2;

  async function agregarArchivos(files) {
    const list = Array.from(files || []).filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (!list.length) { toast('Usá imágenes PNG, JPG o WEBP.'); return; }
    setBusy(true, 'Cargando diseños…');
    try {
      for (const f of list) {
        if (piezas.length >= MAX_DISENOS) { toast(`Hasta ${MAX_DISENOS} diseños distintos por lienzo. Para más, hacé otro pedido.`); break; }
        if (f.size > 40 * 1024 * 1024) { toast(`«${f.name}» pesa demasiado (máximo 40 MB).`); continue; }
        const img = fitInside(await fileToCanvas(f), 4200);
        // Medida inicial: el tamaño real de la imagen a 300 ppp, entre 5 y 28 cm
        const natural = img.width / 300 * 2.54;
        const w = Math.round(clamp(natural, 5, Math.min(28, usable())) * 10) / 10;
        const thumb = fitInside(img, 120).toDataURL('image/png');
        piezas.push({ id: uid(), img, prev: fitInside(img, 700), thumb, name: f.name, w, cant: 1, alpha: hasAlpha(img) });
      }
      if (piezas.some((p) => !p.alpha)) toast('Algún diseño tiene fondo: se va a imprimir con ese fondo. Lo ideal es PNG con fondo transparente.');
    } catch (e) {
      console.error(e);
      toast('No se pudo abrir alguna imagen.');
    } finally {
      setBusy(false);
      actualizar();
    }
  }

  function renderLista() {
    const ul = $('#list');
    ul.innerHTML = piezas.map((p, i) => {
      const h = altoDe(p);
      const ppp = Math.round(p.img.width / (p.w / 2.54));
      return `<li class="dtf-item" data-id="${p.id}">
        <img src="${p.thumb}" alt="" width="64" height="64">
        <div class="dtf-item-body">
          <b title="${esc(p.name)}">${i + 1}. ${esc(p.name)}</b>
          <div class="dtf-item-ctrls">
            <label>Ancho <span class="unit-input"><input type="number" data-k="w" min="1" max="${Math.floor(Math.max(usable(), h))}" step="0.5" value="${cm(p.w).replace(',', '.')}" inputmode="decimal"><i>cm</i></span></label>
            <span class="dtf-alto">× ${cm(h)} cm</span>
            <label>Copias <span class="qty small"><button type="button" data-act="menos" aria-label="Una copia menos">−</button><input type="number" data-k="cant" min="1" max="${MAX_COPIAS}" value="${p.cant}" inputmode="numeric"><button type="button" data-act="mas" aria-label="Una copia más">+</button></span></label>
          </div>
          ${MODO() === 'sueltas' ? `<small class="dtf-price">${money(precioSuelta(p.w, h))} c/u${p.cant > 1 ? ` · ${money(precioSuelta(p.w, h) * p.cant)}` : ''}</small>` : ''}
          ${ppp < 150 ? `<small class="dtf-warn">Poca resolución para ${cm(p.w)} cm (${ppp} ppp): puede verse pixelado.</small>` : ''}
          ${!p.alpha ? '<small class="dtf-warn">Tiene fondo: se imprime con ese fondo.</small>' : ''}
        </div>
        <button type="button" class="icon-btn danger" data-act="quitar" aria-label="Quitar ${esc(p.name)}">✕</button>
      </li>`;
    }).join('');
    $$('.dtf-item', ul).forEach((li) => {
      const p = piezas.find((x) => x.id === li.dataset.id);
      li.querySelector('[data-k="w"]').addEventListener('change', (e) => {
        const max = Math.max(usable(), 0);
        let w = clamp(Number(String(e.target.value).replace(',', '.')) || p.w, 1, 1000);
        // Si es más ancho que el lienzo, solo entra girado: el alto tiene que caber en el ancho
        const ratio = p.img.height / p.img.width;
        if (w > max && w * ratio > max) { w = max; toast(`Lo más grande que entra es ${cm(max)} cm de ancho.`); }
        p.w = Math.round(w * 10) / 10;
        actualizar();
      });
      li.querySelector('[data-k="cant"]').addEventListener('change', (e) => { p.cant = clamp(Math.round(Number(e.target.value) || 1), 1, MAX_COPIAS); actualizar(); });
      li.querySelector('[data-act="menos"]').addEventListener('click', () => { p.cant = Math.max(1, p.cant - 1); actualizar(); });
      li.querySelector('[data-act="mas"]').addEventListener('click', () => { p.cant = Math.min(MAX_COPIAS, p.cant + 1); actualizar(); });
      li.querySelector('[data-act="quitar"]').addEventListener('click', () => { piezas = piezas.filter((x) => x !== p); actualizar(); });
    });
  }

  /* =========================================================
     4. ACOMODAR EN EL LIENZO (por estantes, como "Armar lienzo")
     ========================================================= */
  function acomodar(girar) {
    const U = usable();
    const unidades = [];
    piezas.forEach((p) => {
      const w0 = p.w, h0 = altoDe(p);
      let rot = 0;
      if (w0 > U && h0 <= U) rot = 90;                         // solo entra girada
      else if (girar && h0 > w0 && h0 <= U) rot = 90;          // girada ocupa menos largo
      for (let i = 0; i < p.cant; i++) unidades.push({ p, rot, w: rot ? h0 : w0, h: rot ? w0 : h0 });
    });
    unidades.sort((a, b) => b.h - a.h);
    const estantes = [];
    let y = GAP;
    unidades.forEach((u) => {
      let sh = estantes.find((s) => s.x + u.w <= ANCHO() - GAP + 0.001 && u.h <= s.h + 0.001);
      if (!sh) { sh = { y, x: GAP, h: u.h }; estantes.push(sh); y += u.h + GAP; }
      u.x = sh.x; u.y = sh.y;
      sh.x += u.w + GAP;
    });
    return { unidades, usado: unidades.length ? y : 0 };
  }
  let plan = { unidades: [], usado: 0, largo: 100 };
  function calcular() {
    const a = acomodar(false), b = acomodar(true);
    const best = b.usado < a.usado - 0.01 ? b : a;
    let largo, total;
    if (MODO() === 'sueltas') {
      // Sueltas: el largo es el que ocupan y se paga cada estampa (con un pedido mínimo opcional)
      largo = Math.max(10, Math.ceil(best.usado));
      total = piezas.reduce((a, p) => a + precioSuelta(p.w, altoDe(p)) * p.cant, 0);
      total = Math.max(total, piezas.length ? Number(cot.dtfMinimo) || 0 : 0);
    } else {
      largo = Math.max(MINIMO(), Math.ceil((best.usado - 0.001) / PASO()) * PASO());
      total = Math.round(largo / 100 * PRECIO_METRO());
    }
    plan = { ...best, largo };
    return { ...plan, total, copias: best.unidades.length };
  }

  /* =========================================================
     5. DIBUJO DEL LIENZO
     ========================================================= */
  function dibujarLienzo(canvas, pxPorCm, opts = {}) {
    const W = Math.round(ANCHO() * pxPorCm), H = Math.round(plan.largo * pxPorCm);
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    if (opts.guias !== false) {
      // Cuadrícula cada 10 cm y línea roja cada medio metro
      c.strokeStyle = '#e7ebf3';
      c.lineWidth = 1;
      for (let x = 10; x < ANCHO(); x += 10) { c.beginPath(); c.moveTo(x * pxPorCm, 0); c.lineTo(x * pxPorCm, H); c.stroke(); }
      for (let y = 10; y < plan.largo; y += 10) { c.beginPath(); c.moveTo(0, y * pxPorCm); c.lineTo(W, y * pxPorCm); c.stroke(); }
    }
    plan.unidades.forEach((u) => {
      const src = opts.full ? u.p.img : u.p.prev;
      c.save();
      c.imageSmoothingQuality = 'high';
      if (u.rot) {
        c.translate((u.x + u.w) * pxPorCm, u.y * pxPorCm);
        c.rotate(Math.PI / 2);
        c.drawImage(src, 0, 0, u.h * pxPorCm, u.w * pxPorCm);
      } else {
        c.drawImage(src, u.x * pxPorCm, u.y * pxPorCm, u.w * pxPorCm, u.h * pxPorCm);
      }
      c.restore();
    });
    if (opts.guias !== false && MODO() === 'metro') {
      c.save();
      c.strokeStyle = '#e5157a';
      c.fillStyle = '#e5157a';
      c.setLineDash([8, 6]);
      c.lineWidth = 2;
      c.font = `700 ${Math.max(11, Math.round(pxPorCm * 1.6))}px Inter, Arial, sans-serif`;
      for (let y = 50; y <= plan.largo; y += 50) {
        const yy = Math.min(H - 1, y * pxPorCm);
        c.beginPath(); c.moveTo(0, yy); c.lineTo(W, yy); c.stroke();
        c.fillText(`${(y / 100).toLocaleString('es-AR')} m`, 6, yy - 6);
      }
      c.restore();
    }
  }
  function renderLienzo() {
    const cv = $('#sheet');
    const css = $('#sheet-scroll').clientWidth || 360;
    const px = css * (window.devicePixelRatio || 1) / ANCHO();
    dibujarLienzo(cv, px);
    cv.style.width = '100%';
  }

  function actualizar() {
    renderLista();
    const r = calcular();
    renderLienzo();
    $('#sheet-size').textContent = `${cm(ANCHO())} × ${cm(r.largo)} cm`;
    $('#sheet-use').textContent = r.copias ? `${r.copias} ${r.copias === 1 ? 'diseño' : 'diseños'} · usan ${cm(r.usado)} cm de largo` : 'Subí tus diseños para empezar';
    // Aviso: lo que queda libre dentro del largo que se paga (mínimo o múltiplo del paso)
    const libre = MODO() === 'metro' && r.copias ? r.largo - r.usado : 0;
    const aviso = $('#dtf-libre');
    aviso.hidden = libre < 8;
    aviso.innerHTML = libre >= 8 ? `Te quedan <b>${cm(libre)} cm libres</b> en tu lienzo de ${metrosTxt(r.largo)}: podés sumar más diseños o copias <b>sin pagar más</b>.` : '';
    $('#upload-btn').querySelector('strong').textContent = piezas.length ? 'Sumar más diseños' : 'Subir diseños';
    const sum = $('#dtf-sum');
    sum.hidden = !piezas.length;
    const sena = senaDe(r.total);
    sum.innerHTML = MODO() === 'sueltas' ? `
      ${piezas.map((p, i) => `<div><dt>${i + 1}. ${cm(p.w)} × ${cm(altoDe(p))} cm × ${p.cant}</dt><dd>${money(precioSuelta(p.w, altoDe(p)) * p.cant)}</dd></div>`).join('')}
      ${Number(cot.dtfMinimo) && r.total === Number(cot.dtfMinimo) ? `<div><dt>Pedido mínimo</dt><dd>${money(cot.dtfMinimo)}</dd></div>` : ''}
      <hr>
      <div class="profit"><dt><b>Total</b></dt><dd>${money(r.total)}</dd></div>
      ${sena ? `<div class="sena-row"><dt>Seña para confirmar</dt><dd>${money(sena)}</dd></div>` : ''}` : `
      <div><dt>Lienzo ${cm(ANCHO())} cm × ${metrosTxt(r.largo)}</dt><dd>${money(r.total)}</dd></div>
      <div><dt>Precio por metro</dt><dd>${money(PRECIO_METRO())}</dd></div>
      <div><dt>Copias en total</dt><dd>${r.copias}</dd></div>
      ${r.largo - r.usado >= 10 && r.copias ? `<div><dt>Espacio libre al final</dt><dd>${cm(r.largo - r.usado)} cm</dd></div>` : ''}
      <hr>
      <div class="profit"><dt><b>Total</b></dt><dd>${money(r.total)}</dd></div>
      ${sena ? `<div class="sena-row"><dt>Seña para confirmar</dt><dd>${money(sena)}</dd></div>` : ''}`;
    $('#buy-total').textContent = money(piezas.length ? r.total : 0);
    $('#buy-detail').textContent = MODO() === 'sueltas'
      ? (piezas.length ? `${r.copias} ${r.copias === 1 ? 'estampa' : 'estampas'}` : 'Estampas DTF sueltas')
      : (piezas.length ? `${metrosTxt(r.largo)} · ${r.copias} ${r.copias === 1 ? 'copia' : 'copias'}` : `Desde ${metrosTxt(MINIMO())}`);
    $('#next-btn').disabled = !piezas.length;
    $('#pay-help').innerHTML = sena
      ? `Para <b>confirmar</b> se paga una seña de <b>${money(sena)}</b>${TEPago.disponible(negocio) ? ' con Mercado Pago o' : ''} por transferencia${aliasPago() ? ` al alias <b>${esc(aliasPago())}</b>` : ''}. Te pasamos los datos al enviarlo.`
      : 'Te escribimos por WhatsApp para confirmar el pedido, el pago y la entrega.';
  }

  /* =========================================================
     6. PEDIDO Y PAGO
     ========================================================= */
  let paso3Desde = 0;
  function abrirDatos() {
    $('#order-form').hidden = false;
    $('#next-btn').textContent = 'Enviar pedido';
    paso3Desde = Date.now();
    $('#order-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('#o-name').focus({ preventScroll: true }), 400);
  }

  function idbPut(key, blob) {
    return new Promise((res, rej) => {
      const r = indexedDB.open('te-panel', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('img');
      r.onsuccess = () => { const tx = r.result.transaction('img', 'readwrite'); tx.objectStore('img').put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); };
      r.onerror = () => rej(r.error);
    });
  }
  async function guardarDemo(pedido, files) {
    for (const f of files) { const key = `${uid()}-${f.name}`; await idbPut(key, f.blob); pedido.imagenes.push({ ref: 'idb:' + key, name: f.name }); }
    let d = null;
    try { d = JSON.parse(localStorage.getItem('te_panel_data_v1') || 'null'); } catch (e) { d = null; }
    if (!d) d = { modelos: [], variantes: [], movimientos: [], pedidos: [], config: {} };
    pedido.numero = (d.pedidos || []).reduce((a, p) => Math.max(a, p.numero || 0), 0) + 1;
    d.pedidos = [...(d.pedidos || []), pedido];
    localStorage.setItem('te_panel_data_v1', JSON.stringify(d));
  }

  async function enviar() {
    const err = $('#o-error');
    err.textContent = '';
    const name = $('#o-name').value.trim();
    const tel = telefonoAR($('#o-phone').value);
    if (!name) { err.textContent = 'Escribí tu nombre.'; $('#o-name').focus(); return; }
    if (!tel) { err.textContent = 'Revisá tu WhatsApp: escribilo con código de área, por ejemplo 342 4123456.'; $('#o-phone').focus(); return; }
    if ($('#o-web').value) return;   // campo trampa: robot
    if (Date.now() - paso3Desde < 3000) { err.textContent = 'Revisá tus datos y volvé a tocar «Enviar pedido».'; paso3Desde = 0; return; }
    const btn = $('#next-btn');
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const r = calcular();
      const id = uid();
      // Archivos: cada diseño con su medida + una vista previa del lienzo
      const files = [];
      const piezasPedido = [];
      for (let i = 0; i < piezas.length; i++) {
        const p = piezas[i];
        const nombre = `dtf-${i + 1}-${slug(p.name)}-${cm(p.w).replace(',', '.')}x${cm(altoDe(p)).replace(',', '.')}cm.png`;
        files.push({ blob: await toBlob(p.img, 'image/png'), name: nombre });
        piezasPedido.push({ archivo: nombre, nombre: p.name.slice(0, 80), ancho: Math.round(p.w * 10) / 10, alto: Math.round(altoDe(p) * 10) / 10, cantidad: p.cant, precio: MODO() === 'sueltas' ? precioSuelta(p.w, altoDe(p)) : null });
      }
      const vista = createCanvas(1, 1);
      dibujarLienzo(vista, Math.min(20, 3000 / r.largo));
      files.push({ blob: await toBlob(vista, 'image/jpeg', 0.85), name: 'lienzo-vista-previa.jpg' });
      const pedido = {
        id, origen: 'tienda', estado: 'sena', fecha: new Date().toISOString(),
        cliente: name.slice(0, 80), telefono: tel, notas: $('#o-notes').value.trim().slice(0, 600), total: r.total,
        sena: senaDe(r.total), sena_pagada: false, stock_descontado: false, imagenes: [],
        items: [{
          tipo: 'dtf', modo: MODO(), cantidad: 1, ancho: ANCHO(), largo: r.largo, usado: Math.round(r.usado * 10) / 10, precio_metro: MODO() === 'metro' ? PRECIO_METRO() : null,
          piezas: piezasPedido,
          // Ubicación de cada copia en el lienzo (cm), para abrirlo en "Armar lienzo"
          layout: r.unidades.map((u) => ({ f: piezas.indexOf(u.p), x: Math.round(u.x * 100) / 100, y: Math.round(u.y * 100) / 100, w: Math.round(u.p.w * 100) / 100, rot: u.rot })),
        }],
      };
      if (modo === 'nube') {
        pedido.imagenes = files.map((f) => ({ ref: `sb:tienda/${id}/${f.name}`, name: f.name }));
        const sinRespuesta = new Promise((res) => setTimeout(() => res({ error: new Error('Sin respuesta del servidor') }), 20000));
        const { error } = await Promise.race([sb.from('pedidos').insert(pedido), sinRespuesta]);
        if (error) {
          if (/demasiados|limite|límite/i.test(error.message || '')) { err.textContent = 'Recibimos muchos pedidos desde este número en la última hora. Escribinos por WhatsApp y lo vemos.'; return; }
          throw error;
        }
        setBusy(true, 'Subiendo tus diseños…');
        for (let i = 0; i < files.length; i++) {
          setBusy(true, `Subiendo tus diseños… ${i + 1} de ${files.length}`);
          const { error: e2 } = await sb.storage.from('pedidos').upload(`tienda/${id}/${files[i].name}`, files[i].blob, { contentType: files[i].blob.type });
          if (e2) throw e2;
        }
      } else {
        await guardarDemo(pedido, files);
      }
      confirmar(pedido, vista);
    } catch (e) {
      console.error(e);
      err.textContent = 'No se pudo enviar el pedido. Revisá tu conexión e intentá de nuevo, o escribinos por WhatsApp.';
    } finally {
      setBusy(false);
      btn.disabled = false;
      btn.textContent = 'Enviar pedido';
    }
  }

  function confirmar(p, vista) {
    $('#armar').hidden = true;
    $('#listo').hidden = false;
    $('#buybar').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const it = p.items[0];
    const codigo = p.id.slice(-6).toUpperCase();
    const que = it.modo === 'sueltas' ? `pedido de <b>${it.layout.length} ${it.layout.length === 1 ? 'estampa DTF' : 'estampas DTF'}</b>` : `lienzo DTF <b>${cm(it.ancho)} × ${cm(it.largo)} cm</b>`;
    $('#ok-text').innerHTML = `Gracias, ${esc(p.cliente)}. Tu ${que} (pedido <b>${codigo}</b>) por <b>${money(p.total)}</b> queda reservado.${p.sena ? ' Para <b>confirmarlo</b>, pagá la seña.' : ''}${modo === 'demo' ? '<br><small>(Modo demo: el pedido quedó en el panel de este dispositivo.)</small>' : ''}`;
    $('#ok-pay').hidden = !p.sena;
    if (p.sena) {
      $('#ok-sena').textContent = money(p.sena);
      $('#ok-alias').textContent = aliasPago() || 'te lo pasamos por WhatsApp';
      $('#ok-copy').hidden = !aliasPago();
      $('#ok-vence').textContent = `Si no recibimos la seña en 3 días, el pedido se cancela solo. El resto (${money(p.total - p.sena)}) se paga al retirar.`;
      const mp = TEPago.disponible(negocio) && modo === 'nube';
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
    $('#ok-img').src = vista.toDataURL('image/jpeg', 0.8);
    const wa = whatsappNegocio();
    const link = $('#ok-wa');
    link.hidden = !wa;
    const lineas = [`¡Hola! Hice un pedido de DTF en la web (código ${codigo}):`, it.modo === 'sueltas' ? `• ${it.layout.length} estampas DTF sueltas` : `• Lienzo ${cm(it.ancho)} × ${cm(it.largo)} cm con ${it.layout.length} ${it.layout.length === 1 ? 'copia' : 'copias'}`, `Total: ${money(p.total)}`];
    if (p.sena) lineas.push(`Te mando el comprobante de la seña de ${money(p.sena)}.`);
    lineas.push(`Soy ${p.cliente}.`);
    if (wa) link.href = `https://wa.me/${wa}?text=${encodeURIComponent(lineas.join('\n'))}`;
  }

  /* =========================================================
     7. INICIO
     ========================================================= */
  async function init() {
    const energy = $('.header-energy');
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('i');
      s.className = 'header-energy-spark';
      s.style.left = ((i * 37) % 100) + '%';
      s.style.top = (15 + ((i * 23) % 70)) + '%';
      s.style.animationDelay = (-0.67 * i).toFixed(2) + 's';
      s.style.animationDuration = [3.8, 4.5, 5.2, 5.9][i % 4] + 's';
      energy.appendChild(s);
    }
    await cargarConfig();
    if (MODO() === 'sueltas') {
      $('#dtf-title').textContent = 'Imprimí tus estampas DTF';
      $('.shop-opts .lead').innerHTML = `Estampas DTF sueltas, de hasta <b>${cm(usable())} cm</b> de ancho. Subí tus diseños, elegí la medida y cuántas copias querés: cada estampa se cobra según su tamaño. Te las entregamos listas para planchar.`;
      $('.shop-opts .eyebrow').textContent = 'DTF por estampa';
      $('.dtf-sheet-box .hint').textContent = 'Así se acomodan tus estampas para imprimirlas. Cada una se cobra según su tamaño.';
    } else {
      $('#ancho-txt').textContent = `${cm(ANCHO())} cm`;
      $('#min-txt').textContent = metrosTxt(MINIMO());
      $('#paso-txt').textContent = PASO() === 50 ? 'medio metro' : `${cm(PASO())} cm`;
    }
    const wa = whatsappNegocio();
    $('#contact-link').href = wa ? `https://wa.me/${wa}` : 'https://www.instagram.com/tuestampasf';

    $('#upload-btn').addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', (e) => { agregarArchivos(e.target.files); e.target.value = ''; });
    // Arrastrar archivos a la página (computadora)
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => { e.preventDefault(); if (!$('#armar').hidden) agregarArchivos(e.dataTransfer.files); });
    document.addEventListener('paste', (e) => {
      if (e.target.closest('input, textarea')) return;
      const f = Array.from(e.clipboardData.items || []).filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
      if (f.length) agregarArchivos(f);
    });
    $('#next-btn').addEventListener('click', () => { if ($('#order-form').hidden) abrirDatos(); else enviar(); });
    $('#order-form').addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
    $('#ok-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(aliasPago()); toast('Alias copiado: ' + aliasPago()); } catch (e) { toast('Alias: ' + aliasPago()); } });
    let rz = 0;
    window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(renderLienzo); });
    actualizar();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
