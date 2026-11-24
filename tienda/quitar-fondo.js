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
      .qf { width: min(760px, calc(100vw - 20px)); max-height: calc(100vh - 20px); padding: 0; border: 0; border-radius: 18px; box-shadow: 0 20px 60px #0007; }
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
      .qf-row input[type=checkbox] { width: 18px; height: 18px; }
      .qf button { min-height: 38px; padding: 6px 12px; border: 1px solid #c9d3ea; border-radius: 10px; background: #fff; color: #1b2a6e; font: 700 14px inherit; cursor: pointer; }
      .qf button.qf-ok { background: #0d4fa3; border-color: #0d4fa3; color: #fff; }
      .qf button.on { background: #e8eefc; border-color: #0d4fa3; }
      .qf button:disabled { opacity: .5; cursor: default; }
      .qf-acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }`;
    document.head.appendChild(css);
  }

  function abrir(original, nombre) {
    ponerEstilos();
    return new Promise((resolve) => {
      const base = copiar(original);
      const W = base.width, H = base.height;
      const baseData = base.getContext('2d').getImageData(0, 0, W, H);
      const ops = [];
      let actual = baseData;
      const dlg = document.createElement('dialog');
      dlg.className = 'qf';
      dlg.innerHTML = `<div class="qf-in">
        <div class="qf-head"><h2>Quitar fondo · ${String(nombre || '').replace(/[<>&"]/g, '')}</h2><button type="button" data-a="cerrar" aria-label="Cerrar">✕</button></div>
        <p class="qf-help"><b>Tocá el color que querés borrar</b> (por ejemplo el fondo). Podés tocar varias veces. Si quedan restos, subí la tolerancia.</p>
        <div class="qf-stage bg-cuadros"><canvas aria-label="Vista del diseño: tocá el color a borrar"></canvas></div>
        <div class="qf-row">
          <label>Tolerancia <input type="range" min="0" max="100" value="30" data-a="tol"> <span data-a="tolv">30</span></label>
          <label><input type="checkbox" data-a="global"> En toda la imagen (también adentro de letras)</label>
        </div>
        <div class="qf-row">
          <span>Ver sobre:</span>
          <button type="button" class="on" data-bg="cuadros">Cuadriculado</button><button type="button" data-bg="blanco">Blanco</button><button type="button" data-bg="negro">Negro</button>
          <button type="button" data-a="auto">✨ Fondo automático</button>
        </div>
        <div class="qf-acts">
          <button type="button" data-a="deshacer" disabled>↶ Deshacer</button>
          <button type="button" data-a="original" disabled>Volver al original</button>
          <button type="button" data-a="cancelar">Cancelar</button>
          <button type="button" class="qf-ok" data-a="ok">Usar así</button>
        </div></div>`;
      document.body.appendChild(dlg);
      const q = (s) => dlg.querySelector(s);
      const cv = q('canvas');
      cv.width = W; cv.height = H;
      const cx = cv.getContext('2d');
      const pintar = () => { cx.clearRect(0, 0, W, H); cx.putImageData(actual, 0, 0); q('[data-a="deshacer"]').disabled = !ops.length; q('[data-a="original"]').disabled = !ops.length; };
      const recalcular = () => {
        const img = new ImageData(new Uint8ClampedArray(baseData.data), W, H);
        ops.forEach((o) => o.puntos.forEach(([x, y]) => quitarColor(img, W, H, x, y, o.tol, o.global)));
        actual = img;
        pintar();
      };
      const aplicar = (puntos) => {
        const o = { puntos, tol: Number(q('[data-a="tol"]').value), global: q('[data-a="global"]').checked };
        ops.push(o);
        o.puntos.forEach(([x, y]) => quitarColor(actual, W, H, x, y, o.tol, o.global));
        pintar();
      };
      cv.addEventListener('click', (e) => {
        const r = cv.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        if (actual.data[(y * W + x) * 4 + 3] < 10) return;   // ya es transparente
        aplicar([[x, y]]);
      });
      q('[data-a="tol"]').addEventListener('input', (e) => { q('[data-a="tolv"]').textContent = e.target.value; });
      // Cambiar la tolerancia rehace el último toque con el valor nuevo
      q('[data-a="tol"]').addEventListener('change', (e) => { if (ops.length) { ops[ops.length - 1].tol = Number(e.target.value); recalcular(); } });
      q('[data-a="auto"]').addEventListener('click', () => {
        // Borra desde las cuatro esquinas y el medio de cada borde
        const pts = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [W >> 1, 0], [W >> 1, H - 1], [0, H >> 1], [W - 1, H >> 1]];
        aplicar(pts.filter(([x, y]) => actual.data[(y * W + x) * 4 + 3] >= 10));
      });
      q('[data-a="deshacer"]').addEventListener('click', () => { ops.pop(); recalcular(); });
      q('[data-a="original"]').addEventListener('click', () => { ops.length = 0; recalcular(); });
      dlg.querySelectorAll('[data-bg]').forEach((b) => b.addEventListener('click', () => {
        q('.qf-stage').className = `qf-stage bg-${b.dataset.bg}`;
        dlg.querySelectorAll('[data-bg]').forEach((x) => x.classList.toggle('on', x === b));
      }));
      const cerrar = (res) => { dlg.close(); dlg.remove(); resolve(res); };
      q('[data-a="cerrar"]').addEventListener('click', () => cerrar(null));
      q('[data-a="cancelar"]').addEventListener('click', () => cerrar(null));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(null); });
      q('[data-a="ok"]').addEventListener('click', () => {
        if (!ops.length) { cerrar(null); return; }
        const out = lienzo(W, H);
        out.getContext('2d').putImageData(actual, 0, 0);
        cerrar(out);
      });
      pintar();
      dlg.showModal();
    });
  }

  window.TEFondo = { abrir };
})();
