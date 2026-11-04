/* ==========================================================
   Tu Estampa SF · Worker de Cloudflare
   - La web (HTML, CSS, imágenes) la sirve Cloudflare directamente.
   - Una vez por día visita la base de Supabase para que el plan
     gratis no pause el proyecto por falta de movimiento.
   ========================================================== */
const SUPABASE_URL = 'https://mqbmmzoutrexqebszpqt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SbFNSnBsBg-4safCAEsErA_ZUFEMZ93'; // clave pública (la misma de tienda/config.js)

async function visitarBase() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/modelos?select=id&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return res.status;
}

export default {
  // Cualquier dirección que no sea un archivo de la web: la página 404 de siempre
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
  // Visita diaria (ver "triggers" en wrangler.jsonc)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(visitarBase().then((s) => console.log('Visita diaria a Supabase:', s)));
  },
};
