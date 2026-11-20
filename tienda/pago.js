/* ==========================================================
   Pago con Mercado Pago (compartido por la tienda y el DTF)

   El navegador solo pide el link de pago: el monto lo calcula
   el servidor (worker.js) leyendo el pedido de la base, así
   nadie puede cambiarlo desde el navegador.
   ========================================================== */
(function () {
  'use strict';

  /* Mercado Pago está activo si el dueño lo habilitó en el panel
     (Ajustes → Tienda) y la web está publicada (no con doble clic). */
  function disponible(negocio) {
    return !!(negocio && negocio.mp) && location.protocol.startsWith('http');
  }

  /* Pide el link de pago y lleva al cliente a Mercado Pago */
  async function iniciar(pedidoId) {
    const res = await fetch('/api/pago', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedido: pedidoId }),
    });
    const data = await res.json().catch(() => ({}));
    // El motivo (con el código) ayuda a saber qué revisar si algo falla
    if (!res.ok || !data.url) throw new Error(`${data.error || 'sin respuesta'} · ${res.status}`);
    location.href = data.url;
  }

  /* Monto a pagar con Mercado Pago (incluye el recargo configurado en el panel).
     Es solo para mostrarlo: el monto real lo calcula el servidor con la misma cuenta. */
  function montoConRecargo(base, negocio) {
    const pct = Math.min(Math.max(Number(negocio && negocio.mpRecargo) || 0, 0), 30);
    return pct > 0 ? Math.ceil(base / (1 - pct / 100) / 10) * 10 : base;
  }

  /* Pantalla de la seña después de enviar el pedido, con tres caminos claros:
     1) Mercado Pago (se confirma solo), 2) transferencia + "Ya transferí",
     3) coordinar antes por WhatsApp (avisa que está interesado, sin pagar). */
  function pantallaSena(box, o) {
    const money = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const p = o.pedido, codigo = p.id.slice(-6).toUpperCase();
    const wa = (txt) => (o.whatsapp ? `https://wa.me/${o.whatsapp}?text=${encodeURIComponent(txt)}` : null);
    const pie = [...o.detalle, `Total: ${money(p.total)}`, `Soy ${p.cliente}.`].join('\n');
    const msgPago = `¡Hola! Ya transferí la seña de ${money(p.sena)} del pedido ${codigo}. Te mando el comprobante.\n${pie}`;
    const msgConsulta = `¡Hola! Hice el pedido ${codigo} en la web y me interesa. Antes de pagar la seña quiero coordinar con ustedes.\n${pie}`;
    const montoMP = montoConRecargo(p.sena, o.negocio);
    let n = 0;
    const paso = () => `<span class="pay-num">${++n}</span>`;
    const dato = (lbl, val, id) => `<div class="pay-alias"><span>${lbl}</span><b>${esc(val)}</b><button type="button" class="panel-btn" data-copiar="${esc(val)}" data-que="${lbl}">⧉ Copiar</button></div>`;
    box.innerHTML = `
      <p class="pay-label">Seña para confirmar el pedido</p>
      <p class="pay-amount">${money(p.sena)}</p>
      <p class="pay-note">Elegí cómo seguir:</p>
      <div class="pay-opts">
        ${o.mp ? `<section class="pay-opt"><h3>${paso()} Pagar con Mercado Pago</h3>
          <button type="button" class="mp-btn" data-mp>Pagar ${money(montoMP)} con Mercado Pago</button>
          <p class="pay-note">${montoMP > p.sena ? 'Incluye el costo del servicio de Mercado Pago. ' : ''}Se confirma solo, no hace falta mandar comprobante.</p></section>` : ''}
        <section class="pay-opt"><h3>${paso()} Transferir la seña</h3>
          ${o.alias ? dato('Alias', o.alias) : ''}
          ${o.cbu ? dato('CBU/CVU', o.cbu) : ''}
          ${o.titular ? `<p class="pay-note">A nombre de <b>${esc(o.titular)}</b></p>` : ''}
          ${!o.alias && !o.cbu ? '<p class="pay-note">Te pasamos los datos por WhatsApp.</p>' : ''}
          ${wa(msgPago) ? `<a class="download" href="${wa(msgPago)}" target="_blank" rel="noopener">Ya transferí: enviar comprobante</a>` : ''}
          ${o.mp ? '<p class="pay-note">Por transferencia pagás la seña sin recargo.</p>' : ''}</section>
        ${wa(msgConsulta) ? `<section class="pay-opt pay-opt-alt"><h3>${paso()} ¿Preferís hablar antes?</h3>
          <p class="pay-note">Te escribimos para coordinar la seña y resolver dudas. El pedido queda reservado.</p>
          <a class="panel-btn" href="${wa(msgConsulta)}" target="_blank" rel="noopener">Quiero coordinar por WhatsApp</a></section>` : ''}
      </div>
      <p class="pay-note">${esc(o.vence)}</p>`;
    box.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copiar); o.toast(`${b.dataset.que} copiado: ${b.dataset.copiar}`); } catch (e) { o.toast(`${b.dataset.que}: ${b.dataset.copiar}`); }
    }));
    const mpBtn = box.querySelector('[data-mp]');
    if (mpBtn) mpBtn.addEventListener('click', async () => {
      const txt = mpBtn.textContent;
      mpBtn.disabled = true; mpBtn.textContent = 'Abriendo Mercado Pago…';
      try { await iniciar(p.id); } catch (e) { o.toast(`No se pudo abrir Mercado Pago (${e.message}). Probá de nuevo o pagá por transferencia.`); mpBtn.disabled = false; mpBtn.textContent = txt; }
    });
  }

  window.TEPago = { disponible, iniciar, montoConRecargo, pantallaSena };
})();
