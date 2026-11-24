/* ==========================================================
   Modo vendedor de la tienda (compartido por la tienda y el DTF)

   - Link del vendedor  (…?v=CODIGO): lo saluda por su nombre, le
     muestra el stock como "hay / pocas / sin stock" y los pedidos
     que carga quedan a su nombre.
   - Link para clientes (…?r=CODIGO): el cliente compra normal y el
     pedido también queda a nombre del vendedor.
   El servidor (worker.js) controla que el código exista y esté activo.
   ========================================================= */
(function () {
  'use strict';
  const KEY = 'te_vendedor';
  const DIAS_CLIENTE = 30;   // el link de cliente "recuerda" al vendedor 30 días
  let guardado = null;
  let info = null;           // { nombre, pctVenta, pctEntrega, stock } (solo en modo vendedor)

  const leer = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const escribir = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* sin almacenamiento */ } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function desdeUrl() {
    const q = new URLSearchParams(location.search);
    const v = (q.get('v') || '').toLowerCase(), r = (q.get('r') || '').toLowerCase();
    const ok = (c) => /^[a-z0-9]{4,16}$/.test(c);
    if (ok(v)) return { codigo: v, vendedor: true, t: Date.now() };
    if (ok(r)) return { codigo: r, vendedor: false, t: Date.now() };
    return null;
  }

  async function iniciar() {
    guardado = desdeUrl() || leer();
    if (guardado && !guardado.vendedor && Date.now() - guardado.t > DIAS_CLIENTE * 864e5) guardado = null;
    escribir(guardado);
    if (!guardado || !guardado.vendedor || !location.protocol.startsWith('http')) return;
    try {
      const res = await fetch(`/api/vendedor?v=${encodeURIComponent(guardado.codigo)}`);
      if (res.status === 404) { guardado = null; escribir(null); return; }   // link dado de baja
      if (!res.ok) return;
      info = await res.json();
      mostrarAviso();
    } catch (e) { /* sin conexión al servidor: la tienda sigue normal */ }
  }

  function mostrarAviso() {
    const main = document.querySelector('main');
    if (!main || !info || document.getElementById('vend-bar')) return;
    const linkCliente = `${location.origin}/tienda/index.html?r=${guardado.codigo}`;
    main.insertAdjacentHTML('afterbegin', `<div class="vend-bar" id="vend-bar" role="status">
      <span>👋 Hola, <b>${esc(info.nombre)}</b>. Estás cargando pedidos como vendedor: te quedan a tu nombre.</span>
      <span class="vend-bar-actions">
        <button type="button" class="panel-btn" id="vend-copy">⧉ Link para tu cliente</button>
        <a class="panel-btn" href="dtf.html">Solo la estampa</a>
        <button type="button" class="panel-btn" id="vend-salir" title="Dejar de cargar a tu nombre en este dispositivo">Salir</button>
      </span></div>`);
    document.getElementById('vend-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(linkCliente); aviso('Link copiado: mandáselo a tu cliente.'); } catch (e) { prompt('Copiá el link:', linkCliente); }
    });
    document.getElementById('vend-salir').addEventListener('click', () => {
      if (!confirm('¿Dejar de cargar pedidos a tu nombre en este dispositivo?')) return;
      escribir(null);
      location.href = location.pathname;
    });
  }
  function aviso(t) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = t; el.hidden = false;
    clearTimeout(aviso.t); aviso.t = setTimeout(() => { el.hidden = true; }, 3500);
  }

  /* En modo vendedor el formulario pide los datos del cliente y si él cobra y entrega */
  function prepararFormulario() {
    if (!info) return;
    const label = (id, t) => { const el = document.getElementById(id); const l = el && el.closest('label') && el.closest('label').querySelector('.field-label'); if (l) l.textContent = t; return el; };
    label('o-name', 'Nombre de tu cliente');
    label('o-phone', 'WhatsApp de tu cliente');
    const notas = label('o-notes', 'Algo más del pedido (opcional)');
    if (notas && !document.getElementById('o-entrega')) {
      notas.closest('label').insertAdjacentHTML('afterend', `<label class="vend-check"><input type="checkbox" id="o-entrega">
        <span><b>Yo le cobro y se lo entrego</b><br><small>Venta con entrega: ${Number(info.pctEntrega) || 0} % del pedido. Sin marcar, solo venta: ${Number(info.pctVenta) || 0} %.</small></span></label>`);
    }
  }

  /* Anota el pedido a nombre del vendedor (no frena el pedido si falla) */
  async function asignar(pedidoId) {
    const chk = document.getElementById('o-entrega');
    const entrega = !!(chk && chk.checked);
    if (!guardado || !location.protocol.startsWith('http')) return;
    try {
      await Promise.race([
        fetch('/api/vendedor/asignar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedido: pedidoId, v: guardado.codigo, entrega: !!(entrega && guardado.vendedor) }) }),
        new Promise((res) => setTimeout(res, 8000)),
      ]);
    } catch (e) { /* el dueño lo puede asignar a mano en el panel */ }
  }

  window.TEVend = {
    iniciar,
    asignar,
    prepararFormulario,
    esVendedor: () => !!(guardado && guardado.vendedor && info),
    info: () => info,
    /* 'hay' | 'pocas' | 'sin' | null (null = no se sabe) */
    stock: (modelo, color, talle) => (info && info.stock ? info.stock[`${modelo}|${color}|${talle}`] || null : null),
  };
})();
