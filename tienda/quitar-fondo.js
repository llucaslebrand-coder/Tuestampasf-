/* ==========================================================
   Quitar el fondo de un diseño (página de DTF)

   TEFondo.abrir(canvas, nombre) abre una ventana donde se toca el
   color a quitar (como una varita mágica), con tolerancia, quitar
   ese color en toda la imagen, deshacer y ver el resultado sobre
   cuadriculado, blanco o negro. Devuelve un canvas nuevo o null.
   Las operaciones se guardan como una lista y se vuelven a aplicar
   sobre el original: así deshacer no ocupa memoria.
   ========================================================= */
(function () {
  'use strict';
  const MAX_LADO = 3200;   // resolución máxima de trabajo (≈ 290 ppp a 28 cm)

  function lienzo(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function copiar(src) {
    const s = Math.min(1, MAX_LADO / Math.max(src.width, src.height));
    const c = lienzo(Math.round(src.width * s), Math.round(src.height * s));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  /* Borra el color tocado. tol: 0-100. global: en toda la imagen (también huecos de letras).
     Los bordes quedan suaves para que no se vean serruchados. */
  function quitarColor(img, W, H, sx, sy, tol, global) {
    const d = img.data;
    const i0 = (sy * W + sx) * 4;
    if (d[i0 + 3] < 10) return;
    const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2];
    const lim = 8 + tol * 1.6, suave = lim * 1.45;
    const dist = (i) => Math.max(Math.abs(d[i] - r0), Math.abs(d[i + 1] - g0), Math.abs(d[i + 2] - b0));
    const borrar = (i, dd) => {
      if (dd <= lim) d[i + 3] = 0;
      else if (dd < suave) d[i + 3] = Math.min(d[i + 3], Math.round(255 * (dd - lim) / (suave - lim)));
    };
    if (global) {
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]) borrar(i, dist(i));
      return;
    }
    // Relleno desde el punto tocado (solo la zona conectada)
    const visto = new Uint8Array(W * H);
    const pila = new Int32Array(W * H);
    let n = 0;
    pila[n++] = sy * W + sx; visto[sy * W + sx] = 1;
    while (n) {
      const p = pila[--n], i = p * 4;
      const dd = dist(i);
      if (d[i + 3] === 0 && dd > suave) continue;
      if (dd >= suave) continue;
      borrar(i, dd);
      if (dd > lim) continue;   // borde suave: no sigue más allá
      const x = p % W, y = (p - x) / W;
      if (x > 0 && !visto[p - 1]) { visto[p - 1] = 1; pila[n++] = p - 1; }
      if (x < W - 1 && !visto[p + 1]) { visto[p + 1] = 1; pila[n++] = p + 1; }
      if (y > 0 && !visto[p - W]) { visto[p - W] = 1; pila[n++] = p - W; }
      if (y < H - 1 && !visto[p + W]) { visto[p + W] = 1; pila[n++] = p + W; }
    }
  }

  let estilos = false;
  function ponerEstilos() {
    if (estilos) return;
    estilos = true;
    const css = document.createElement('style');
    css.textContent = `
      .qf { width: min(760px, calc(100vw - 20px)); max-height: calc(100vh - 20px); overflow: auto; padding: 0; border: 0; border-radius: 18px; box-shadow: 0 20px 60px #0007; }
      .qf::backdrop { background: #0b1a3dcc; }
      .qf-in { display: grid; gap: 10px; padding: 14px; }
      .qf-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .qf-head h2 { margin: 0; font-size: 18px; color: #1b2a6e; }
      .qf-help { margin: 0; color: #5b6478; font-size: 14px; line-height: 1.4; }
      .qf-stage { display: grid; place-items: center; min-height: 200px; max-height: 52vh; overflow: hidden; border-radius: 12px; border: 1px solid #dfe3ec; }
      .qf-stage.bg-cuadros { background: repeating-conic-gradient(#d9dde6 0 25%, #fff 0 50%) 0 0 / 18px 18px; }
      .qf-stage.bg-blanco { background: #fff; } .qf-stage.bg-negro { background: #111; }
      .qf-stage canvas { display: block; max-width: 100%; max-height: 52vh; cursor: crosshair; touch-action: manipulation; }
      .qf-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: 14px; }
      .qf-row label { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
      .qf-row input[type=range] { width: 150px; }
      .qf-row input[type=checkbox] { width: 18px; height: 18px; flex: none; }
      .qf-row[hidden] { display: none; }
      .qf-check { display: flex; align-items: flex-start; gap: 8px; font-size: 14px; line-height: 1.35; }
      .qf-check input { flex: none; width: 18px; height: 18px; margin-top: 1px; }
      .qf-modos button { flex: 1 1 auto; }
      .qf button { min-height: 38px; padding: 6px 12px; border: 1px solid #c9d3ea; border-radius: 10px; background: #fff; color: #1b2a6e; font: 700 14px inherit; cursor: pointer; }
      .qf button.qf-ok { background: #0d4fa3; border-color: #0d4fa3; color: #fff; }
      .qf button.on { background: #e8eefc; border-color: #0d4fa3; }
      .qf button:disabled { opacity: .5; cursor: default; }
      .qf-acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }`;
    document.head.appendChild(css);
  }

  /* Caja de lo que tiene algo visible (para recortar los márgenes transparentes) */
  function cajaVisible(img, W, R) {
    const d = img.data;
    let x0 = R.x + R.w, y0 = R.y + R.h, x1 = -1, y1 = -1;
    for (let y = R.y; y < R.y + R.h; y++) {
      for (let x = R.x; x < R.x + R.w; x++) {
        if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  const AYUDA = {
    color: '<b>Tocá el color que querés borrar</b> (por ejemplo el fondo). Podés tocar varias veces. Si quedan restos, subí la tolerancia.',
    borrar: '<b>Arrastrá un rectángulo</b> sobre lo que sobra (textos, marcas, manchas) y se borra.',
    recortar: '<b>Arrastrá un rectángulo</b> alrededor de lo que querés dejar. Lo de afuera se corta.',
  };

  function abrir(original, nombre) {
    ponerEstilos();
    return new Promise((resolve) => {
      const base = copiar(original);
      const W = base.width, H = base.height;
      const baseData = base.getContext('2d').getImageData(0, 0, W, H);
      const ops = [];            // { tipo: 'color', puntos, tol, global } | { tipo: 'rect', x, y, w, h }
      const historia = [];       // para deshacer: 'op' o { recorte anterior }
      let recorte = null;        // { x, y, w, h } en píxeles de la imagen
      let modo = 'color';
      let actual = baseData;
      const dlg = document.createElement('dialog');
      dlg.className = 'qf';
      dlg.innerHTML = `<div class="qf-in">
        <div class="qf-head"><h2>Retocar diseño · ${String(nombre || '').replace(/[<>&"]/g, '')}</h2><button type="button" data-a="cerrar" aria-label="Cerrar">✕</button></div>
        <div class="qf-row qf-modos" role="group" aria-label="Herramienta">
          <button type="button" class="on" data-modo="color">🎯 Quitar color</button>
          <button type="button" data-modo="borrar">▭ Borrar zona</button>
          <button type="button" data-modo="recortar">✂ Recortar</button>
        </div>
        <p class="qf-help" data-a="ayuda">${AYUDA.color}</p>
        <div class="qf-stage bg-cuadros"><canvas aria-label="Vista del diseño"></canvas></div>
        <div class="qf-row" data-solo="color">
          <label>Tolerancia <input type="range" min="0" max="100" value="30" data-a="tol"> <span data-a="tolv">30</span></label>
          <label><input type="checkbox" data-a="global"> En toda la imagen (también adentro de letras)</label>
          <button type="button" data-a="auto">✨ Fondo automático</button>
        </div>
        <div class="qf-row">
          <span>Ver sobre:</span>
          <button type="button" class="on" data-bg="cuadros">Cuadriculado</button><button type="button" data-bg="blanco">Blanco</button><button type="button" data-bg="negro">Negro</button>
        </div>
        <label class="qf-check"><input type="checkbox" data-a="trim" checked> <span><b>Quitar los márgenes transparentes</b> al terminar (ocupa menos film)</span></label>
        <div class="qf-acts">
          <button type="button" data-a="deshacer" disabled>↶ Deshacer</button>
          <button type="button" data-a="original" disabled>Volver al original</button>
          <button type="button" data-a="cancelar">Cancelar</button>
          <button type="button" class="qf-ok" data-a="ok">Usar así</button>
        </div></div>`;
      document.body.appendChild(dlg);
      const q = (s) => dlg.querySelector(s);
      const cv = q('canvas');
      const cx = cv.getContext('2d');
      const vista = () => recorte || { x: 0, y: 0, w: W, h: H };
      let arrastre = null;   // { x0, y0, x1, y1 } en píxeles de la imagen

      function pintar() {
        const v = vista();
        if (cv.width !== v.w || cv.height !== v.h) { cv.width = v.w; cv.height = v.h; }
        cx.clearRect(0, 0, v.w, v.h);
        cx.putImageData(actual, -v.x, -v.y, v.x, v.y, v.w, v.h);
        if (arrastre) {
          const x = Math.min(arrastre.x0, arrastre.x1) - v.x, y = Math.min(arrastre.y0, arrastre.y1) - v.y;
          const w = Math.abs(arrastre.x1 - arrastre.x0), h = Math.abs(arrastre.y1 - arrastre.y0);
          const lw = Math.max(2, v.w / 300);
          if (modo === 'recortar') {   // oscurece lo que se va a cortar
            cx.fillStyle = '#0b1a3d88';
            cx.fillRect(0, 0, v.w, y); cx.fillRect(0, y + h, v.w, v.h - y - h); cx.fillRect(0, y, x, h); cx.fillRect(x + w, y, v.w - x - w, h);
          } else { cx.fillStyle = '#e0484855'; cx.fillRect(x, y, w, h); }
          cx.setLineDash([lw * 4, lw * 3]); cx.lineWidth = lw; cx.strokeStyle = modo === 'recortar' ? '#0d4fa3' : '#e04848';
          cx.strokeRect(x, y, w, h); cx.setLineDash([]);
        }
        q('[data-a="deshacer"]').disabled = !historia.length;
        q('[data-a="original"]').disabled = !historia.length;
      }
      function aplicarOp(img, o) {
        if (o.tipo === 'rect') {
          const d = img.data;
          for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) d[(y * W + x) * 4 + 3] = 0;
        } else o.puntos.forEach(([x, y]) => quitarColor(img, W, H, x, y, o.tol, o.global));
      }
      function recalcular() {
        const img = new ImageData(new Uint8ClampedArray(baseData.data), W, H);
        ops.forEach((o) => aplicarOp(img, o));
        actual = img;
        pintar();
      }
      function nuevaOp(o) { ops.push(o); historia.push('op'); aplicarOp(actual, o); pintar(); }
      function aImagen(e) {
        const r = cv.getBoundingClientRect(), v = vista();
        return [Math.max(0, Math.min(W - 1, Math.floor(v.x + (e.clientX - r.left) / r.width * v.w))), Math.max(0, Math.min(H - 1, Math.floor(v.y + (e.clientY - r.top) / r.height * v.h)))];
      }

      cv.addEventListener('pointerdown', (e) => {
        if (modo === 'color') return;
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        const [x, y] = aImagen(e);
        arrastre = { x0: x, y0: y, x1: x, y1: y };
      });
      cv.addEventListener('pointermove', (e) => { if (!arrastre) return; [arrastre.x1, arrastre.y1] = aImagen(e); pintar(); });
      const soltar = () => {
        if (!arrastre) return;
        const R = { x: Math.min(arrastre.x0, arrastre.x1), y: Math.min(arrastre.y0, arrastre.y1), w: Math.abs(arrastre.x1 - arrastre.x0) + 1, h: Math.abs(arrastre.y1 - arrastre.y0) + 1 };
        arrastre = null;
        if (R.w < 4 || R.h < 4) { pintar(); return; }
        if (modo === 'borrar') nuevaOp({ tipo: 'rect', ...R });
        else { historia.push({ recorte }); recorte = R; pintar(); }
      };
      cv.addEventListener('pointerup', soltar);
      cv.addEventListener('pointercancel', () => { arrastre = null; pintar(); });
      cv.addEventListener('click', (e) => {
        if (modo !== 'color') return;
        const [x, y] = aImagen(e);
        if (actual.data[(y * W + x) * 4 + 3] < 10) return;   // ya es transparente
        nuevaOp({ tipo: 'color', puntos: [[x, y]], tol: Number(q('[data-a="tol"]').value), global: q('[data-a="global"]').checked });
      });
      dlg.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
        modo = b.dataset.modo;
        dlg.querySelectorAll('[data-modo]').forEach((x) => x.classList.toggle('on', x === b));
        q('[data-a="ayuda"]').innerHTML = AYUDA[modo];
        q('[data-solo="color"]').hidden = modo !== 'color';
        cv.style.touchAction = modo === 'color' ? 'manipulation' : 'none';
        cv.style.cursor = modo === 'color' ? 'crosshair' : 'cell';
      }));
      q('[data-a="tol"]').addEventListener('input', (e) => { q('[data-a="tolv"]').textContent = e.target.value; });
      // Cambiar la tolerancia rehace el último toque de color con el valor nuevo
      q('[data-a="tol"]').addEventListener('change', (e) => {
        const ult = ops[ops.length - 1];
        if (ult && ult.tipo === 'color' && historia[historia.length - 1] === 'op') { ult.tol = Number(e.target.value); recalcular(); }
      });
      q('[data-a="auto"]').addEventListener('click', () => {
        // Borra desde las esquinas y el medio de cada borde de lo que se ve
        const v = vista(), X = v.x + v.w - 1, Y = v.y + v.h - 1, mx = v.x + (v.w >> 1), my = v.y + (v.h >> 1);
        const pts = [[v.x, v.y], [X, v.y], [v.x, Y], [X, Y], [mx, v.y], [mx, Y], [v.x, my], [X, my]];
        const vivos = pts.filter(([x, y]) => actual.data[(y * W + x) * 4 + 3] >= 10);
        if (vivos.length) nuevaOp({ tipo: 'color', puntos: vivos, tol: Number(q('[data-a="tol"]').value), global: false });
      });
      q('[data-a="deshacer"]').addEventListener('click', () => {
        const h = historia.pop();
        if (h === 'op') { ops.pop(); recalcular(); } else if (h) { recorte = h.recorte; pintar(); }
      });
      q('[data-a="original"]').addEventListener('click', () => { ops.length = 0; historia.length = 0; recorte = null; recalcular(); });
      dlg.querySelectorAll('[data-bg]').forEach((b) => b.addEventListener('click', () => {
        q('.qf-stage').className = `qf-stage bg-${b.dataset.bg}`;
        dlg.querySelectorAll('[data-bg]').forEach((x) => x.classList.toggle('on', x === b));
      }));
      const cerrar = (res) => { dlg.close(); dlg.remove(); resolve(res); };
      q('[data-a="cerrar"]').addEventListener('click', () => cerrar(null));
      q('[data-a="cancelar"]').addEventListener('click', () => cerrar(null));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(null); });
      q('[data-a="ok"]').addEventListener('click', () => {
        let R = vista();
        if (q('[data-a="trim"]').checked) {
          const c = cajaVisible(actual, W, R);
          if (!c) { alert('Quedó todo borrado. Deshacé algún paso.'); return; }
          R = c;
        }
        if (!historia.length && R.w === W && R.h === H) { cerrar(null); return; }   // sin cambios
        const out = lienzo(R.w, R.h);
        out.getContext('2d').putImageData(actual, -R.x, -R.y, R.x, R.y, R.w, R.h);
        out.fraccionAncho = R.w / W;   // para que el diseño mantenga su tamaño real al recortarlo
        cerrar(out);
      });
      pintar();
      dlg.showModal();
    });
  }

  window.TEFondo = { abrir };
})();
