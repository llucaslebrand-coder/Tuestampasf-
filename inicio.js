/* ==========================================================
   Página de inicio de Tu Estampa SF
   - Colores y precios desde el panel (Supabase o este dispositivo).
   - Enlaces de WhatsApp con el número del negocio.
   - Chispas del header y botón fijo en celular.
   ========================================================== */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const roundUp = (x, r) => (r > 0 ? Math.ceil(x / r) * r : Math.round(x));
  const CFG = Object.assign({ supabaseUrl: '', supabaseKey: '', whatsapp: '' }, window.TIENDA_CONFIG || {});

  /* Valores iniciales (los mismos del panel) */
  const COLORES = [
    { nombre: 'Blanca', hex: '#f4f2ee' }, { nombre: 'Negra', hex: '#1d1d1f' }, { nombre: 'Azul marino', hex: '#1b2a6e' },
    { nombre: 'Gris melange', hex: '#9ea3ab' }, { nombre: 'Beige', hex: '#e8d9bf' }, { nombre: 'Verde inglés', hex: '#1f4d3a' },
  ];
  const COTIZADOR = { metro: 14000, ancho: 60, merma: 15, ganancia: 100, fijo: 1500, diseno: 5000, redondeo: 500 };

  /* Fotos de cada color (img/colores/<nombre>-percha.webp y -modelo.webp) */
  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const FOTOS = ['blanca', 'negra', 'azul-marino', 'gris-melange', 'beige', 'verde-ingles'];

  async function cargarDatos() {
    let modelo = { precio: 20000, colores: COLORES };
    let cotizador = COTIZADOR;
    let tienda = {};
    if (CFG.supabaseUrl && CFG.supabaseKey && window.supabase) {
      try {
        const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
        const tarde = new Promise((_, rej) => setTimeout(() => rej(new Error('Supabase no responde')), 6000));
        const [{ data: mods }, { data: cfg }] = await Promise.race([Promise.all([
          sb.from('modelos').select('*').eq('activo', true),
          sb.from('config').select('*'),
        ]), tarde]);
        if (mods && mods.length) modelo = mods[0];
        (cfg || []).forEach((r) => {
          if (r.clave === 'cotizador') cotizador = { ...COTIZADOR, ...r.valor };
          if (r.clave === 'tienda') tienda = r.valor || {};
        });
        return { modelo, cotizador, tienda };
      } catch (e) { console.warn('Supabase no disponible', e); }
    }
    try {
      const d = JSON.parse(localStorage.getItem('te_panel_data_v1') || 'null');
      const mods = d && d.modelos ? d.modelos.filter((m) => m.activo !== false) : [];
      if (mods.length) modelo = mods[0];
      if (d && d.config && d.config.cotizador) cotizador = { ...COTIZADOR, ...d.config.cotizador };
      if (d && d.config && d.config.tienda) tienda = d.config.tienda;
    } catch (e) { /* sin datos del panel */ }
    return { modelo, cotizador, tienda };
  }

  function precioEstampa(c, ancho, alto) {
    const costoCm2 = c.metro / (c.ancho * 100) * (1 + c.merma / 100);
    return roundUp(ancho * alto * costoCm2 * (1 + c.ganancia / 100) + c.fijo, c.redondeo);
  }

  function waNumber(n) {
    let d = String(n || '').replace(/\D/g, '');
    if (d && !d.startsWith('54')) d = '549' + d.replace(/^0/, '');
    return d;
  }
  function waPretty(d) {
    const local = d.replace(/^549/, '');
    return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)}-${local.slice(6)}` : local;
  }

  function renderColores(colores) {
    $('#color-grid').innerHTML = colores.map((c) => {
      const s = slug(c.nombre);
      const tieneFoto = FOTOS.includes(s);
      const foto = tieneFoto
        ? `<img src="img/colores/${s}-percha.webp" alt="Remera ${esc(c.nombre.toLowerCase())} lisa" width="246" height="242" loading="lazy"><img src="img/colores/${s}-modelo.webp" alt="" width="246" height="244" loading="lazy" aria-hidden="true">`
        : `<span style="position:absolute;inset:0;background:${esc(c.hex)}"></span>`;
      return `<a class="color-card" href="tienda/index.html?color=${encodeURIComponent(c.nombre)}">
        <div class="color-photo">${foto}</div>
        <div class="color-info"><span class="color-dot" style="background:${esc(c.hex)}"></span><strong>${esc(c.nombre)}</strong><span>Diseñar →</span></div>
      </a>`;
    }).join('');
  }

  function sparks() {
    const energy = $('.header-energy');
    if (!energy) return;
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
  }

  /* En celular aparece un botón fijo "Diseñá tu remera" al pasar la portada */
  function stickyCta() {
    const btn = $('.home-sticky');
    const hero = $('.hero-cta');
    if (!btn || !hero || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(([e]) => btn.classList.toggle('is-visible', !e.isIntersecting)).observe(hero);
  }

  function pintarPrecios(modelo, cotizador) {
    $('#p-remera').textContent = money(modelo.precio);
    $('#p-chica').textContent = money(precioEstampa(cotizador, 9, 9));
    $('#p-mediana').textContent = money(precioEstampa(cotizador, 20, 20));
    $('#p-grande').textContent = money(precioEstampa(cotizador, 28, 28));
  }

  async function init() {
    sparks();
    stickyCta();
    renderColores(COLORES);
    pintarPrecios({ precio: 20000 }, COTIZADOR);
    const { modelo, cotizador, tienda } = await cargarDatos();
    renderColores(modelo.colores && modelo.colores.length ? modelo.colores : COLORES);
    pintarPrecios(modelo, cotizador);
    const wa = waNumber(tienda.whatsapp || CFG.whatsapp);
    $$('[data-wa]').forEach((a) => {
      if (wa) a.href = `https://wa.me/${wa}?text=${encodeURIComponent('¡Hola Tu Estampa SF! Quería consultar por una remera personalizada.')}`;
      else a.href = 'https://www.instagram.com/tuestampasf';
    });
    if (wa) $('#wa-text').textContent = waPretty(wa);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
