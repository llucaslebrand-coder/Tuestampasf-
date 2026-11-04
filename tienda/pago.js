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

  window.TEPago = { disponible, iniciar };
})();
