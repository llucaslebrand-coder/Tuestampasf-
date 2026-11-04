/* ==========================================================
   Tu Estampa SF · Worker de Cloudflare
   - La web (HTML, CSS, imágenes) la sirve Cloudflare directamente.
   - /api/pago            → arma el link de pago de Mercado Pago de un pedido.
   - /api/pago/estado     → dice si un pedido ya está pagado (página de regreso).
   - /api/mp/webhook      → Mercado Pago avisa los pagos: se verifican y se marca el pedido.
   - Una vez por día visita la base de Supabase para que no se pause.

   Claves (se cargan en Cloudflare → tuestampasf → Configuración →
   Variables y secretos, NUNCA en el código):
     MP_ACCESS_TOKEN       Access Token de producción de Mercado Pago
     SUPABASE_SECRET_KEY   clave secreta (sb_secret_…) o service_role de Supabase
   ========================================================== */
const SUPABASE_URL = 'https://mqbmmzoutrexqebszpqt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SbFNSnBsBg-4safCAEsErA_ZUFEMZ93'; // clave pública (la misma de tienda/config.js)

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const ID_OK = /^[a-z0-9]{6,40}$/;

/* ---------- Supabase con la clave secreta (lee y marca pedidos) ---------- */
function sbHeaders(env) {
  const k = env.SUPABASE_SECRET_KEY || '';
  const h = { apikey: k, 'Content-Type': 'application/json' };
  if (k.startsWith('eyJ')) h.Authorization = `Bearer ${k}`;   // clave service_role antigua
  return h;
}
async function leerPedido(env, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${encodeURIComponent(id)}&select=id,numero,origen,estado,total,sena,sena_pagada,cliente,pago`, { headers: sbHeaders(env) });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}
async function marcarPagado(env, id, pago, cubreTodo) {
  const body = { sena_pagada: true, pago };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(env), Prefer: 'return=minimal' },
    body: JSON.stringify(cubreTodo ? { ...body, pago: { ...pago, total: true } } : body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}`);
}
/* Monto a cobrar: la seña si hay, si no el total (siempre calculado acá, nunca desde el navegador) */
const montoDe = (p) => Math.round(Number(p.sena) > 0 ? Number(p.sena) : Number(p.total));

/* ---------- Crear el link de pago ---------- */
async function crearPago(request, env) {
  if (!env.MP_ACCESS_TOKEN || !env.SUPABASE_SECRET_KEY) return json({ error: 'Mercado Pago no está configurado' }, 503);
  const { pedido: id } = await request.json().catch(() => ({}));
  if (!ID_OK.test(String(id || ''))) return json({ error: 'Pedido inválido' }, 400);
  const p = await leerPedido(env, id);
  if (!p || p.origen !== 'tienda') return json({ error: 'No encontramos el pedido' }, 404);
  if (p.sena_pagada) return json({ error: 'Este pedido ya está pagado' }, 409);
  if (p.estado === 'cancelado') return json({ error: 'El pedido está cancelado' }, 409);
  const monto = montoDe(p);
  if (!(monto > 0)) return json({ error: 'Monto inválido' }, 400);
  const origin = new URL(request.url).origin;
  const codigo = p.id.slice(-6).toUpperCase();
  const pref = {
    items: [{
      id: p.id,
      title: `${Number(p.sena) > 0 ? 'Seña' : 'Pago'} pedido ${codigo} · Tu Estampa SF`,
      quantity: 1,
      unit_price: monto,
      currency_id: 'ARS',
    }],
    external_reference: p.id,
    metadata: { pedido: p.id },
    back_urls: {
      success: `${origin}/tienda/pago.html?r=ok&p=${p.id}`,
      pending: `${origin}/tienda/pago.html?r=pendiente&p=${p.id}`,
      failure: `${origin}/tienda/pago.html?r=error&p=${p.id}`,
    },
    auto_return: 'approved',
    notification_url: `${origin}/api/mp/webhook`,
    statement_descriptor: 'TU ESTAMPA SF',
  };
  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `${p.id}-${monto}-${Date.now()}` },
    body: JSON.stringify(pref),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.init_point) {
    console.log('Mercado Pago rechazó la preferencia', res.status, JSON.stringify(data).slice(0, 500));
    return json({ error: 'Mercado Pago no respondió' }, 502);
  }
  return json({ url: data.init_point });
}

/* ---------- Aviso de Mercado Pago (webhook) ---------- */
async function webhook(request, env) {
  if (!env.MP_ACCESS_TOKEN || !env.SUPABASE_SECRET_KEY) return json({ ok: false }, 200);
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const tipo = body.type || body.topic || url.searchParams.get('type') || url.searchParams.get('topic');
  const pagoId = (body.data && body.data.id) || url.searchParams.get('data.id') || url.searchParams.get('id');
  if (tipo !== 'payment' || !/^\d+$/.test(String(pagoId || ''))) return json({ ok: true, ignorado: true });
  // Se consulta el pago directo a Mercado Pago: así nadie puede mandar un aviso falso
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${pagoId}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  if (!res.ok) return json({ ok: false }, 500);   // Mercado Pago reintenta más tarde
  const pago = await res.json();
  const id = pago.external_reference;
  if (pago.status !== 'approved' || !ID_OK.test(String(id || ''))) return json({ ok: true, estado: pago.status });
  const p = await leerPedido(env, id);
  if (!p) return json({ ok: true, sinPedido: true });
  if (p.sena_pagada && p.pago && String(p.pago.id) === String(pago.id)) return json({ ok: true, repetido: true });
  const monto = Number(pago.transaction_amount) || 0;
  if (monto + 1 < montoDe(p)) {
    console.log('Pago menor al esperado', id, monto, montoDe(p));
    return json({ ok: true, montoInsuficiente: true });
  }
  await marcarPagado(env, id, {
    proveedor: 'mercadopago', id: pago.id, estado: pago.status, monto,
    metodo: pago.payment_method_id || '', fecha: pago.date_approved || new Date().toISOString(),
  }, monto + 1 >= Number(p.total));
  return json({ ok: true });
}

/* ---------- Estado del pago (página de regreso) ---------- */
async function estadoPago(request, env) {
  const id = new URL(request.url).searchParams.get('p') || '';
  if (!ID_OK.test(id) || !env.SUPABASE_SECRET_KEY) return json({ pagado: false });
  const p = await leerPedido(env, id).catch(() => null);
  return json({ pagado: !!(p && p.sena_pagada), monto: p ? montoDe(p) : 0, total: p ? Number(p.total) : 0 });
}

async function visitarBase() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/modelos?select=id&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return res.status;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/api/pago' && request.method === 'POST') return await crearPago(request, env);
      if (pathname === '/api/pago/estado') return await estadoPago(request, env);
      if (pathname === '/api/mp/webhook') return await webhook(request, env);
      if (pathname.startsWith('/api/')) return json({ error: 'No encontrado' }, 404);
    } catch (e) {
      console.log('Error en la API', pathname, e && e.message);
      return json({ error: 'Error del servidor' }, 500);
    }
    // Todo lo demás: la web de siempre (o la página 404)
    return env.ASSETS.fetch(request);
  },
  // Visita diaria (ver "triggers" en wrangler.jsonc)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(visitarBase().then((s) => console.log('Visita diaria a Supabase:', s)));
  },
};
