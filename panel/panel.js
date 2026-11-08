/* ==========================================================
   Panel Tu Estampa SF — pedidos, stock, etiquetas con código
   de barras, cotizador DTF, modelos y editor de imágenes.

   Datos: modo local (en este dispositivo) o Supabase (nube).

   Índice
    1. Utilidades
    2. Datos iniciales (modelos, colores, talles, cotizador)
    3. Almacenamiento (local / Supabase)
    4. Navegación y vistas
    5. Inicio
    6. Pedidos
    7. Stock y escáner
    8. Etiquetas con código de barras
    9. Cotizador DTF
   10. Modelos y precios
   11. Editor de imágenes
   12. Ajustes (nube y copias de seguridad)
   13. Inicio de la app
   ========================================================== */
(function () {
  'use strict';

  /* =========================================================
     1. UTILIDADES
     ========================================================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const num = (n, d = 2) => (Math.round((Number(n) || 0) * 10 ** d) / 10 ** d).toLocaleString('es-AR');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmtDate = (d) => new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const fmtDateTime = (d) => new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const roundUp = (x, r) => (r > 0 ? Math.ceil(x / r) * r : Math.round(x));

  function loadScript(src) {
    return new Promise((res, rej) => {
      if ($(`script[src="${src}"]`)) { res(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }

  let toastTimer = 0;
  function toast(text, isError) {
    const el = $('#toast');
    el.textContent = text;
    el.style.background = isError ? '#9b2c1f' : '';
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
  }

  /* Ventana genérica: título + contenido (HTML) + función para conectar eventos */
  function openModal(title, html, mount) {
    $('#modal-title').textContent = title;
    const body = $('#modal-body');
    body.innerHTML = html;
    const dlg = $('#modal');
    if (!dlg.open) dlg.showModal();
    if (mount) mount(body, dlg);
  }
  const closeModal = () => $('#modal').close();

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const ICON = {
    home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    cart: '<path d="M3 4h2l2.4 11h11l2-8H6.3"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
    orders: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    stock: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 18 9 5 9-5" opacity=".5"/>',
    barcode: '<path d="M4 5v14M7 5v14M10 5v14M14 5v14M16 5v14M20 5v14"/>',
    quote: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h6"/>',
    shirt: '<path d="m8.2 5 2.3-2h3l2.3 2 4.2 1.8-2 4-2.2-1V21H8.2V9.8L6 10.8l-2-4Z"/>',
    edit: '<path d="m14 6 4-4a2.1 2.1 0 0 1 3 3l-4 4-6 6-3-3 6-6Z"/><path d="M8 13c-5-1-3 6-6 7 4 2 9-1 8-5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  /* =========================================================
     2. DATOS INICIALES
     ========================================================= */
  const COLORES_INICIALES = [
    { nombre: 'Blanca', sigla: 'BLA', hex: '#f4f2ee' },
    { nombre: 'Negra', sigla: 'NEG', hex: '#1d1d1f' },
    { nombre: 'Azul marino', sigla: 'AZM', hex: '#1b2a6e' },
    { nombre: 'Gris melange', sigla: 'GRI', hex: '#9ea3ab' },
    { nombre: 'Beige', sigla: 'BEI', hex: '#e8d9bf' },
    { nombre: 'Verde inglés', sigla: 'VIN', hex: '#1f4d3a' },
  ];
  const TALLES_INICIALES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  const COTIZADOR_INICIAL = {
    metro: 14000,      // lo que te cobran el metro de DTF
    ancho: 60,         // ancho del rollo en cm
    merma: 15,         // % extra por separaciones y desperdicio
    ganancia: 100,     // % de ganancia sobre el costo del DTF
    fijo: 1500,        // fijo por estampa (planchado, tiempo)
    diseno: 5000,      // cargo por armar el diseño (opcional)
    redondeo: 500,     // redondear precios hacia arriba
    // DTF a la venta (página «Imprimí tu DTF» de la tienda)
    dtfModo: 'metro',  // 'metro' (lienzo por metro) o 'sueltas' (cada estampa por su tamaño)
    dtfAncho: 59,      // ancho útil del lienzo que vendés (cm)
    dtfMin: 100,       // largo mínimo (cm)
    dtfPaso: 50,       // el largo aumenta de a (cm)
    dtfMetro: 0,       // precio de venta del metro (0 = costo del metro + tu ganancia)
    dtfFijo: 500,      // sueltas: fijo por estampa (recorte, tiempo)
    dtfMinimo: 0,      // sueltas: pedido mínimo en pesos (0 = sin mínimo)
  };
  const ESTADOS = [
    ['sena', 'Esperando seña'], ['nuevo', 'Nuevo'], ['confirmado', 'Confirmado'], ['produccion', 'En producción'],
    ['listo', 'Listo para entregar'], ['entregado', 'Entregado'], ['cancelado', 'Cancelado'],
  ];
  const estadoLabel = (e) => (ESTADOS.find(([k]) => k === e) || [e, e])[1];
  const ZONAS = ['Pecho', 'Espalda', 'Frente completo', 'Manga', 'Nuca', 'Otra'];

  const codigoDe = (modelo, color, talle) => `TE-${modelo.sigla}-${color.sigla}-${String(talle).padStart(2, '0')}`;

  function nuevoModelo(nombre, sigla, costo, precio, colores, talles) {
    return { id: uid(), nombre, sigla, costo, precio, colores, talles, activo: true, creado: new Date().toISOString() };
  }
  function variantesDe(modelo, existentes = []) {
    const out = [];
    modelo.colores.forEach((c) => modelo.talles.forEach((t) => {
      const ya = existentes.find((v) => v.modelo_id === modelo.id && v.color === c.nombre && v.talle === t);
      if (!ya) out.push({ id: uid(), modelo_id: modelo.id, color: c.nombre, talle: t, codigo: codigoDe(modelo, c, t), stock: 0, minimo: 2, actualizado: new Date().toISOString() });
    }));
    return out;
  }

  /* =========================================================
     3. ALMACENAMIENTO
     Local: localStorage (+ IndexedDB para imágenes).
     Nube: Supabase (tablas del archivo supabase/schema.sql).
     ========================================================= */
  const LS_DATA = 'te_panel_data_v1';
  const LS_CONN = 'te_panel_supabase';
  const TABLES = ['modelos', 'variantes', 'movimientos', 'pedidos'];

  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('te-panel', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('img');
        r.onsuccess = () => { this.db = r.result; res(r.result); };
        r.onerror = () => rej(r.error);
      });
    },
    async op(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('img', mode);
        const q = fn(tx.objectStore('img'));
        tx.oncomplete = () => res(q && q.result);
        tx.onerror = () => rej(tx.error);
      });
    },
    put: (k, v) => idb.op('readwrite', (s) => s.put(v, k)),
    get: (k) => idb.op('readonly', (s) => s.get(k)),
    del: (k) => idb.op('readwrite', (s) => s.delete(k)),
  };

  const Store = {
    mode: 'local',
    sb: null,
    user: null,
    data: { modelos: [], variantes: [], movimientos: [], pedidos: [], config: {} },

    /* Conexión: la guardada en este navegador o, si no hay, la de tienda/config.js */
    conn() {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(LS_CONN) || 'null'); } catch (e) { saved = null; }
      if (saved && saved.off) return null;   // el usuario eligió "Desconectar"
      if (saved && saved.url) return saved;
      const t = window.TIENDA_CONFIG || {};
      return t.supabaseUrl && t.supabaseKey ? { url: t.supabaseUrl, key: t.supabaseKey } : null;
    },

    /* Devuelve 'ok' o 'login' (falta iniciar sesión en la nube) */
    async init() {
      const c = this.conn();
      const forceLocal = sessionStorage.getItem('te_force_local') === '1';
      if (c && c.url && c.key && !forceLocal && window.supabase) {
        this.sb = window.supabase.createClient(c.url, c.key);
        const { data } = await this.sb.auth.getSession();
        if (!data.session) return 'login';
        this.user = data.session.user;
        this.mode = 'cloud';
        await this.loadCloud();
      } else {
        this.mode = 'local';
        this.loadLocal();
      }
      await this.seed();
      return 'ok';
    },

    loadLocal() {
      try {
        const d = JSON.parse(localStorage.getItem(LS_DATA) || 'null');
        if (d) this.data = { ...this.data, ...d };
      } catch (e) { /* datos dañados: se empieza de cero */ }
    },
    persistLocal() {
      if (this.mode !== 'local') return;
      try {
        // Se conservan los últimos 3000 movimientos para no llenar el almacenamiento
        this.data.movimientos = this.data.movimientos.slice(-3000);
        localStorage.setItem(LS_DATA, JSON.stringify(this.data));
      } catch (e) { toast('No se pudo guardar en este dispositivo (espacio lleno).', true); }
    },

    async loadCloud() {
      for (const t of TABLES) {
        let q = this.sb.from(t).select('*');
        if (t === 'movimientos') q = q.order('fecha', { ascending: false }).limit(1000);
        const { data, error } = await q;
        if (error) throw error;
        this.data[t] = t === 'movimientos' ? data.reverse() : data;
      }
      const { data: cfg, error } = await this.sb.from('config').select('*');
      if (error) throw error;
      this.data.config = Object.fromEntries((cfg || []).map((r) => [r.clave, r.valor]));
    },

    async seed() {
      if (this.data.modelos.length) return;
      const m = nuevoModelo('Remera unisex', 'U', 9000, 20000, COLORES_INICIALES, TALLES_INICIALES);
      m.id = 'unisex';   // mismo id que el catálogo inicial de la tienda
      await this.save('modelos', m);
      await this.saveMany('variantes', variantesDe(m));
      if (!this.data.config.cotizador) await this.setConfig('cotizador', COTIZADOR_INICIAL);
    },

    put(table, row) {
      const list = this.data[table];
      const i = list.findIndex((r) => r.id === row.id);
      if (i >= 0) list[i] = row; else list.push(row);
    },
    async save(table, row) {
      this.put(table, row);
      if (this.mode === 'cloud') {
        const { data, error } = await this.sb.from(table).upsert(row).select().single();
        if (error) { toast('No se pudo guardar en la nube: ' + error.message, true); return false; }
        this.put(table, data);   // trae campos que completa la base (ej. número de pedido)
        return data;
      }
      this.persistLocal();
      return row;
    },
    async saveMany(table, rows) {
      if (!rows.length) return true;
      rows.forEach((r) => this.put(table, r));
      if (this.mode === 'cloud') {
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await this.sb.from(table).upsert(rows.slice(i, i + 200));
          if (error) { toast('No se pudo guardar en la nube: ' + error.message, true); return false; }
        }
        return true;
      }
      this.persistLocal();
      return true;
    },
    async remove(table, id) {
      this.data[table] = this.data[table].filter((r) => r.id !== id);
      if (this.mode === 'cloud') {
        const { error } = await this.sb.from(table).delete().eq('id', id);
        if (error) { toast('No se pudo borrar en la nube: ' + error.message, true); return false; }
        return true;
      }
      this.persistLocal();
      return true;
    },
    async setConfig(clave, valor) {
      this.data.config[clave] = valor;
      if (this.mode === 'cloud') {
        const { error } = await this.sb.from('config').upsert({ clave, valor });
        if (error) toast('No se pudo guardar la configuración: ' + error.message, true);
        return;
      }
      this.persistLocal();
    },

    /* Imágenes de pedidos */
    async putImage(file) {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
      const id = `${uid()}.${ext}`;
      if (this.mode === 'cloud') {
        const path = `panel/${id}`;
        const { error } = await this.sb.storage.from('pedidos').upload(path, file, { contentType: file.type });
        if (error) throw error;
        return { ref: 'sb:' + path, name: file.name };
      }
      await idb.put(id, file);
      return { ref: 'idb:' + id, name: file.name };
    },
    async imageBlob(ref) {
      if (ref.startsWith('idb:')) return idb.get(ref.slice(4));
      if (ref.startsWith('sb:') && this.sb) {
        const { data, error } = await this.sb.storage.from('pedidos').download(ref.slice(3));
        if (error) throw error;
        return data;
      }
      return null;
    },
    async removeImage(ref) {
      if (ref.startsWith('idb:')) return idb.del(ref.slice(4));
      if (ref.startsWith('sb:') && this.sb) return this.sb.storage.from('pedidos').remove([ref.slice(3)]);
      return null;
    },
  };

  /* Cambio de stock con registro en el historial */
  async function changeStock(v, delta, motivo, detalle = '') {
    if (!delta) return;
    const nv = { ...v, stock: v.stock + delta, actualizado: new Date().toISOString() };
    await Store.save('variantes', nv);
    await Store.save('movimientos', { id: uid(), fecha: new Date().toISOString(), variante_id: v.id, cantidad: delta, motivo, detalle });
    return nv;
  }
  async function setStock(v, value, motivo, detalle) {
    return changeStock(v, value - v.stock, motivo, detalle);
  }

  const modeloDe = (id) => Store.data.modelos.find((m) => m.id === id);
  const colorDe = (modelo, nombre) => (modelo && modelo.colores.find((c) => c.nombre === nombre)) || { nombre, hex: '#ccc', sigla: '?' };
  const varianteLabel = (v) => { const m = modeloDe(v.modelo_id); return `${m ? m.nombre : 'Remera'} · ${v.color} · Talle ${v.talle}`; };
  const cotizador = () => ({ ...COTIZADOR_INICIAL, ...(Store.data.config.cotizador || {}) });

  /* =========================================================
     4. NAVEGACIÓN Y VISTAS
     ========================================================= */
  const VIEWS = [
    { id: 'inicio', label: 'Inicio', sub: 'Resumen del negocio', icon: 'home', render: renderInicio },
    { id: 'pedidos', label: 'Pedidos', sub: 'Clientes y producción', icon: 'orders', render: renderPedidos },
    { id: 'resultados', label: 'Resultados', sub: 'Ventas y ganancia', icon: 'chart', render: renderResultados },
    { id: 'stock', label: 'Stock', sub: 'Remeras lisas por talle', icon: 'stock', render: renderStock },
    { id: 'reponer', label: 'Reponer', sub: 'Lo que hay que comprar', icon: 'cart', render: renderReponer },
    { id: 'etiquetas', label: 'Códigos de barra', sub: 'Etiquetas para imprimir', icon: 'barcode', render: renderEtiquetas },
    { id: 'cotizador', label: 'Cotizador', sub: 'DTF por cm²', icon: 'quote', render: renderCotizador },
    { id: 'modelos', label: 'Modelos y precios', sub: 'Colores, talles y costos', icon: 'shirt', render: renderModelos },
    { id: 'editar', label: 'Editar imagen', sub: 'Las 10 herramientas', icon: 'edit', render: renderEditor },
    { id: 'ajustes', label: 'Ajustes', sub: 'Nube y copias', icon: 'gear', render: renderAjustes },
  ];
  let current = 'inicio';

  function renderNav() {
    $('#nav').innerHTML = VIEWS.map((v) => `
      <a class="tool-link ${v.id === current ? 'active' : ''}" href="#${v.id}" ${v.id === current ? 'aria-current="page"' : ''} title="${v.label}">
        <b aria-hidden="true">${svg(v.icon)}</b>
        <span><strong>${v.label}</strong><small>${v.sub}</small></span>
        ${v.id === 'pedidos' && pedidosActivos().filter((p) => p.estado === 'nuevo').length ? `<i class="tool-ai-badge">${pedidosActivos().filter((p) => p.estado === 'nuevo').length}</i>` : ''}
        ${v.id === 'reponer' && faltantes().filter((r) => r.faltan > 0).length ? `<i class="tool-ai-badge">${faltantes().filter((r) => r.faltan > 0).length}</i>` : ''}
      </a>`).join('');
  }

  function go(id) {
    current = VIEWS.some((v) => v.id === id) ? id : 'inicio';
    renderNav();
    const v = VIEWS.find((x) => x.id === current);
    $('#contenido').classList.toggle('is-editor', current === 'editar');
    document.title = `${v.label} · Panel Tu Estampa SF`;
    v.render($('#view'));
    const link = $(`#nav a[href="#${current}"]`);
    if (link) link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const refresh = () => go(current);

  function head(title, desc, actions = '') {
    return `<div class="view-head"><div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}</div><div class="view-actions no-print">${actions}</div></div>`;
  }

  /* =========================================================
     5. INICIO
     ========================================================= */
  const pedidosActivos = () => Store.data.pedidos.filter((p) => !['entregado', 'cancelado', 'sena'].includes(p.estado));
  const esperandoSena = () => Store.data.pedidos.filter((p) => p.estado === 'sena');
  const VENCE_DIAS = 3;
  const venceEl = (p) => new Date(new Date(p.fecha).getTime() + VENCE_DIAS * 864e5);

  /* Los pedidos de la tienda sin seña se borran solos a los 3 días (con sus imágenes) */
  async function limpiarSinSena() {
    const vencidos = esperandoSena().filter((p) => p.origen === 'tienda' && !p.sena_pagada && venceEl(p) < new Date());
    for (const p of vencidos) {
      for (const im of p.imagenes || []) { try { await Store.removeImage(im.ref); } catch (e) { /* sigue */ } }
      await Store.remove('pedidos', p.id);
    }
    if (vencidos.length) toast(vencidos.length === 1 ? `Se borró 1 pedido de la tienda que no pagó la seña en ${VENCE_DIAS} días.` : `Se borraron ${vencidos.length} pedidos de la tienda que no pagaron la seña en ${VENCE_DIAS} días.`);
  }
  const bajoMinimo = () => Store.data.variantes.filter((v) => v.stock <= v.minimo);

  /* =========================================================
     REPONER: remeras que piden los clientes y no hay en stock.
     Cuenta los pedidos que todavía no descontaron stock (los que ya
     descontaron dejan el stock en negativo si no alcanzaba).
     ========================================================= */
  function faltantes() {
    const filas = new Map();
    const fila = (modelo_id, color, talle) => {
      const k = `${modelo_id}|${color}|${talle}`;
      if (!filas.has(k)) {
        const v = Store.data.variantes.find((x) => x.modelo_id === modelo_id && x.color === color && x.talle === talle) || null;
        filas.set(k, { modelo_id, color, talle, v, stock: v ? v.stock : 0, piden: 0, espera: 0, pedidos: [] });
      }
      return filas.get(k);
    };
    for (const p of Store.data.pedidos) {
      if (p.stock_descontado || ['entregado', 'cancelado'].includes(p.estado)) continue;
      const enEspera = p.estado === 'sena' && !p.sena_pagada;   // todavía no pagaron la seña
      for (const it of p.items || []) {
        if (it.tipo === 'dtf' || !it.color) continue;
        const f = fila(it.modelo_id, it.color, it.talle);
        const n = Number(it.cantidad) || 1;
        if (enEspera) f.espera += n; else { f.piden += n; if (!f.pedidos.includes(p)) f.pedidos.push(p); }
      }
    }
    // Pedidos ya en producción que dejaron el stock en negativo
    Store.data.variantes.filter((v) => v.stock < 0).forEach((v) => fila(v.modelo_id, v.color, v.talle));
    const disp = (f) => Math.max(0, f.stock);
    return [...filas.values()].map((f) => ({
      ...f,
      faltan: Math.max(0, f.piden - f.stock),
      faltanEspera: Math.max(0, f.piden + f.espera - f.stock) - Math.max(0, f.piden - f.stock),
      despues: disp(f) - f.piden,
    })).filter((f) => f.faltan > 0 || f.faltanEspera > 0);
  }
  const ordenVar = (a, b) => {
    const m = modeloDe(a.modelo_id) || { colores: [], talles: [] };
    return String(a.modelo_id).localeCompare(String(b.modelo_id))
      || m.colores.findIndex((c) => c.nombre === a.color) - m.colores.findIndex((c) => c.nombre === b.color)
      || m.talles.indexOf(a.talle) - m.talles.indexOf(b.talle);
  };
  const remeraTxt = (r) => `${(modeloDe(r.modelo_id) || {}).nombre || 'Remera'} ${r.color} T${r.talle}`;
  /* Texto para mandarle al proveedor: agrupado por modelo y color */
  function listaProveedor(items) {
    const grupos = new Map();
    items.filter((x) => x.cant > 0).sort(ordenVar).forEach((x) => {
      const k = `${(modeloDe(x.modelo_id) || {}).nombre || 'Remera'} ${x.color}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(`T${x.talle} ×${x.cant}`);
    });
    const total = items.reduce((a, x) => a + x.cant, 0);
    return [`Pedido de remeras · Tu Estampa SF · ${fmtDate(new Date())}`, ...[...grupos].map(([k, ts]) => `• ${k}: ${ts.join(', ')}`), `Total: ${total} ${total === 1 ? 'remera' : 'remeras'}`].join('\n');
  }

  let reponerConMinimo = false;
  function renderReponer(el) {
    const falt = faltantes().sort(ordenVar);
    const urg = falt.filter((r) => r.faltan > 0);
    const espera = falt.filter((r) => r.faltanEspera > 0);
    const enFaltantes = new Set(urg.map((r) => r.v && r.v.id));
    const bajos = Store.data.variantes.filter((v) => v.stock < v.minimo && !enFaltantes.has(v.id)).sort(ordenVar);
    const aPedir = [
      ...urg.map((r) => ({ modelo_id: r.modelo_id, color: r.color, talle: r.talle, cant: r.faltan })),
      ...(reponerConMinimo ? bajos.map((v) => ({ modelo_id: v.modelo_id, color: v.color, talle: v.talle, cant: v.minimo - Math.max(0, v.stock) })) : []),
    ];
    const totalFaltan = urg.reduce((a, r) => a + r.faltan, 0);
    const dot = (r) => `<span class="color-name"><i style="background:${colorDe(modeloDe(r.modelo_id), r.color).hex}"></i>${esc(remeraTxt(r))}</span>`;
    el.innerHTML = head('Reponer stock', 'Las remeras que te pidieron los clientes y no tenés, para comprarle al proveedor. Se actualiza solo con cada pedido.', `
        <button type="button" class="panel-btn" data-act="csv" ${aPedir.length ? '' : 'disabled'}>↓ Excel (CSV)</button>
        <button type="button" class="panel-btn primary" data-act="copy" ${aPedir.length ? '' : 'disabled'}>⧉ Copiar lista para el proveedor</button>`) + `
      <div class="stats">
        <div class="stat ${totalFaltan ? 'is-alert' : ''}"><small>Faltan para pedidos</small><strong>${totalFaltan}</strong><span>${urg.length} ${urg.length === 1 ? 'combinación' : 'combinaciones'} de color y talle</span></div>
        <div class="stat"><small>Si pagan la seña</small><strong>${espera.reduce((a, r) => a + r.faltanEspera, 0)}</strong><span>faltarían además</span></div>
        <div class="stat"><small>Debajo del mínimo</small><strong>${bajos.length}</strong><span>sin contar las de arriba</span></div>
      </div>
      <section class="box"><h2>🛒 Faltan para pedidos de clientes</h2>${urg.length ? `
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Remera</th><th class="num">Piden</th><th class="num">Stock</th><th class="num">Faltan</th><th>Pedidos</th><th></th></tr></thead><tbody>
        ${urg.map((r, i) => `<tr><td>${dot(r)}</td><td class="num">${r.piden}</td><td class="num">${r.stock}</td><td class="num"><b>${r.faltan}</b></td>
          <td style="white-space:normal">${r.pedidos.map((p) => `<a href="#" data-ped="${p.id}">#${p.numero || '–'} ${esc(p.cliente)}</a>`).join(', ') || '<span class="field-help">Ya en producción</span>'}</td>
          <td>${r.v ? `<button type="button" class="panel-btn" data-llego="${i}">✓ Llegó</button>` : '<span class="field-help">Sin código: agregá el color o talle en Modelos</span>'}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Tenés stock para todos los pedidos. ✓</p>'}
      </section>
      ${espera.length ? `<section class="box"><h2>⏳ Si pagan la seña</h2><p>Pedidos de la tienda que todavía no pagaron. Si los confirman, también faltarían:</p>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Remera</th><th class="num">Faltarían</th></tr></thead><tbody>
        ${espera.map((r) => `<tr><td>${dot(r)}</td><td class="num">${r.faltanEspera}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      <section class="box"><details ${bajos.length && !urg.length ? 'open' : ''}><summary><h2 style="display:inline">📉 Debajo del stock mínimo (${bajos.length})</h2></summary>
        ${bajos.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Remera</th><th class="num">Stock</th><th class="num">Mín.</th><th class="num">Para llegar</th></tr></thead><tbody>
        ${bajos.map((v) => `<tr><td>${dot(v)}</td><td class="num">${v.stock}</td><td class="num">${v.minimo}</td><td class="num">${v.minimo - Math.max(0, v.stock)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nada debajo del mínimo. ✓</p>'}
      </details>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="rp-min" ${reponerConMinimo ? 'checked' : ''}> Sumar a la lista del proveedor lo que falta para llegar al mínimo</label></section>
      ${aPedir.length ? `<section class="box"><h2>Lista para el proveedor</h2><pre class="panel-note" style="white-space:pre-wrap;font:inherit">${esc(listaProveedor(aPedir))}</pre></section>` : ''}`;
    $('#rp-min', el).addEventListener('change', (e) => { reponerConMinimo = e.target.checked; refresh(); });
    $$('[data-ped]', el).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); pedidoDetalle(a.dataset.ped); }));
    $$('[data-llego]', el).forEach((b) => b.addEventListener('click', async () => {
      const r = urg[Number(b.dataset.llego)];
      const q = Math.round(Number(prompt(`¿Cuántas ${remeraTxt(r)} llegaron?`, String(r.faltan))) || 0);
      if (q <= 0) return;
      await changeStock(r.v, q, 'Ingreso de mercadería', 'Reposición para pedidos');
      toast(`＋${q} ${remeraTxt(r)} cargadas al stock.`);
      refresh();
    }));
    const copiar = el.querySelector('[data-act="copy"]');
    copiar.addEventListener('click', async () => {
      const t = listaProveedor(aPedir);
      try { await navigator.clipboard.writeText(t); toast('Lista copiada: pegala en el WhatsApp del proveedor.'); } catch (e) { prompt('Copiá la lista:', t); }
    });
    el.querySelector('[data-act="csv"]').addEventListener('click', () => {
      const filas = [['Modelo', 'Color', 'Talle', 'Cantidad a pedir', 'Stock actual', 'Pedidos']];
      aPedir.slice().sort(ordenVar).forEach((x) => {
        const r = urg.find((u) => u.modelo_id === x.modelo_id && u.color === x.color && u.talle === x.talle);
        const v = Store.data.variantes.find((y) => y.modelo_id === x.modelo_id && y.color === x.color && y.talle === x.talle);
        filas.push([(modeloDe(x.modelo_id) || {}).nombre || '', x.color, x.talle, x.cant, v ? v.stock : 0, r ? r.pedidos.map((p) => `#${p.numero || ''} ${p.cliente}`).join(' / ') : 'Stock mínimo']);
      });
      const csv = '\ufeff' + filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `reponer-${new Date().toISOString().slice(0, 10)}.csv`);
    });
  }

  function renderInicio(el) {
    const vars = Store.data.variantes;
    const unidades = vars.reduce((a, v) => a + Math.max(0, v.stock), 0);
    const valor = vars.reduce((a, v) => a + Math.max(0, v.stock) * ((modeloDe(v.modelo_id) || {}).costo || 0), 0);
    const bajos = bajoMinimo().sort((a, b) => a.stock - b.stock);
    const faltan = faltantes().reduce((a, r) => a + r.faltan, 0);
    const activos = pedidosActivos();
    const recientes = Store.data.pedidos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 6);
    const mes = new Date().getMonth();
    const ventasMes = Store.data.pedidos.filter((p) => p.estado === 'entregado' && fechaCierre(p).getMonth() === mes && fechaCierre(p).getFullYear() === new Date().getFullYear()).reduce((a, p) => a + Number(p.total || 0), 0);
    el.innerHTML = head('Hola 👋', 'Así está Tu Estampa SF hoy.', `
        <button type="button" class="panel-btn" data-act="scan">▦ Escanear</button>
        <button type="button" class="panel-btn" data-act="quote">＄ Cotizar</button>
        <button type="button" class="panel-btn primary" data-act="new">＋ Nuevo pedido</button>`) + `
      <div class="stats">
        <div class="stat"><small>Pedidos activos</small><strong>${activos.length}</strong><span>${activos.filter((p) => p.estado === 'nuevo').length} nuevos · ${esperandoSena().length} esperando seña</span></div>
        <div class="stat"><small>Remeras en stock</small><strong>${unidades}</strong><span>${vars.length} combinaciones</span></div>
        <div class="stat"><small>Valor del stock</small><strong>${money(valor)}</strong><span>a precio de costo</span></div>
        <a class="stat ${faltan || bajos.length ? 'is-alert' : ''}" href="#reponer" style="color:inherit;text-decoration:none"><small>Para reponer</small><strong>${faltan}</strong><span>${faltan ? `faltan para pedidos · ` : ''}${bajos.length} en el mínimo o debajo · ver lista</span></a>
      </div>
      <div class="grid-2">
        <section class="box">${faltan ? `<h2>🛒 Faltan para pedidos</h2>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Remera</th><th class="num">Stock</th><th class="num">Faltan</th></tr></thead><tbody>
          ${faltantes().filter((r) => r.faltan > 0).sort(ordenVar).slice(0, 8).map((r) => `<tr><td><span class="color-name"><i style="background:${colorDe(modeloDe(r.modelo_id), r.color).hex}"></i>${esc(r.color)} · T${esc(r.talle)}</span></td><td class="num">${r.stock}</td><td class="num"><b>${r.faltan}</b></td></tr>`).join('')}
          </tbody></table></div><p><a href="#reponer">Ver la lista para el proveedor</a></p><h2 style="margin-top:14px">Debajo del mínimo</h2>` : '<h2>Para reponer</h2>'}${bajos.length ? `
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Remera</th><th class="num">Stock</th><th class="num">Mín.</th></tr></thead><tbody>
          ${bajos.slice(0, faltan ? 5 : 12).map((v) => `<tr><td><span class="color-name"><i style="background:${colorDe(modeloDe(v.modelo_id), v.color).hex}"></i>${esc(v.color)} · T${esc(v.talle)}</span></td><td class="num">${v.stock}</td><td class="num">${v.minimo}</td></tr>`).join('')}
          </tbody></table></div>${bajos.length > (faltan ? 5 : 12) ? `<p>Y ${bajos.length - (faltan ? 5 : 12)} más. <a href="#stock">Ver stock</a></p>` : ''}` : '<p class="empty">Todo el stock está por encima del mínimo. ✓</p>'}

        </section>
        <section class="box"><h2>Últimos pedidos</h2>${recientes.length ? `
          <div class="table-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Cliente</th><th>Estado</th><th class="num">Total</th></tr></thead><tbody>
          ${recientes.map((p) => `<tr data-id="${p.id}" style="cursor:pointer"><td>#${p.numero || '–'}</td><td>${esc(p.cliente)}</td><td><span class="badge st-${p.estado}">${estadoLabel(p.estado)}</span></td><td class="num">${money(p.total)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="empty">Todavía no hay pedidos.</p>'}
          <p>Ventas entregadas este mes: <b>${money(ventasMes)}</b> · <a href="#resultados">Ver resultados</a></p>
        </section>
      </div>`;
    el.querySelector('[data-act="scan"]').addEventListener('click', openScanner);
    el.querySelector('[data-act="quote"]').addEventListener('click', () => { location.hash = 'cotizador'; });
    el.querySelector('[data-act="new"]').addEventListener('click', () => pedidoForm());
    $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => pedidoDetalle(tr.dataset.id)));
  }

  /* =========================================================
     6. PEDIDOS
     ========================================================= */
  let pedidoFiltro = 'activos';

  function itemsResumen(p) {
    return (p.items || []).map((it) => {
      if (it.tipo === 'dtf') {
        const copias = (it.layout || []).length;
        return it.modo === 'sueltas'
          ? `DTF: ${copias} ${copias === 1 ? 'estampa suelta' : 'estampas sueltas'} (${(it.piezas || []).length} ${(it.piezas || []).length === 1 ? 'diseño' : 'diseños'})`
          : `DTF: lienzo ${num(it.ancho, 1)} × ${num(it.largo, 1)} cm — ${(it.piezas || []).length} ${(it.piezas || []).length === 1 ? 'diseño' : 'diseños'}, ${copias} ${copias === 1 ? 'copia' : 'copias'}`;
      }
      const m = modeloDe(it.modelo_id);
      const est = (it.estampas || []).map((e) => `${e.zona} ${num(e.ancho, 1)}×${num(e.alto, 1)} cm`).join(', ');
      return `${it.cantidad}× ${m ? m.nombre : 'Remera'} ${it.color} T${it.talle}${est ? ` — ${est}` : ''}`;
    });
  }

  function renderPedidos(el) {
    const filtros = [['activos', 'Activos'], ['sena', `Esperando seña${esperandoSena().length ? ` (${esperandoSena().length})` : ''}`], ['nuevo', 'Nuevos'], ['produccion', 'En producción'], ['listo', 'Listos'], ['entregado', 'Entregados'], ['todos', 'Todos']];
    let list = Store.data.pedidos.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    if (pedidoFiltro === 'activos') list = list.filter((p) => !['entregado', 'cancelado', 'sena'].includes(p.estado));
    else if (pedidoFiltro !== 'todos') list = list.filter((p) => p.estado === pedidoFiltro);
    const ayuda = pedidoFiltro === 'sena'
      ? `Pedidos de la tienda que todavía no pagaron la seña. No descuentan stock y se borran solos a los ${VENCE_DIAS} días. Cuando llegue el comprobante, abrí el pedido y tocá «Seña recibida».`
      : 'Los pedidos de la tienda llegan acá cuando pagan la seña, con la imagen lista. También podés cargarlos a mano.';
    el.innerHTML = head('Pedidos', ayuda,
      '<button type="button" class="panel-btn primary" data-act="new">＋ Nuevo pedido</button>') + `
      <div class="tabs" role="group" aria-label="Filtrar pedidos">${filtros.map(([k, l]) => `<button type="button" data-f="${k}" aria-pressed="${pedidoFiltro === k}">${l}</button>`).join('')}</div>
      ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Detalle</th><th>Estado</th><th class="num">Total</th></tr></thead><tbody>
        ${list.map((p) => `<tr data-id="${p.id}" style="cursor:pointer" tabindex="0">
          <td>#${p.numero || '–'}${p.origen === 'tienda' ? ' <span class="badge st-nuevo">Tienda</span>' : ''}${p.estado === 'sena' && p.sena_pagada ? ' <span class="badge st-listo">Pagado</span>' : ''}</td><td>${fmtDate(p.fecha)}</td>
          <td>${esc(p.cliente)}</td><td style="white-space:normal;max-width:320px">${esc(itemsResumen(p).join(' · '))}</td>
          <td><span class="badge st-${p.estado}">${estadoLabel(p.estado)}</span></td><td class="num">${money(p.total)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="box"><p class="empty">No hay pedidos en esta lista.</p></div>'}`;
    el.querySelector('[data-act="new"]').addEventListener('click', () => pedidoForm());
    $$('.tabs button', el).forEach((b) => b.addEventListener('click', () => { pedidoFiltro = b.dataset.f; refresh(); }));
    $$('tr[data-id]', el).forEach((tr) => {
      tr.addEventListener('click', () => pedidoDetalle(tr.dataset.id));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') pedidoDetalle(tr.dataset.id); });
    });
  }

  /* Formulario de pedido (nuevo o desde el cotizador) */
  function pedidoForm(pref = {}) {
    const modelos = Store.data.modelos.filter((m) => m.activo !== false);
    const m0 = modeloDe(pref.modelo_id) || modelos[0];
    const est = pref.estampas && pref.estampas.length ? pref.estampas : [{ zona: 'Pecho', ancho: 10, alto: 10, cantidad: 1 }];
    openModal('Nuevo pedido', `
      <form id="pf" class="form-grid">
        <label class="field"><span class="field-label">Cliente</span><input type="text" id="pf-cli" required maxlength="80" value="${esc(pref.cliente || '')}"></label>
        <label class="field"><span class="field-label">WhatsApp</span><input type="tel" id="pf-tel" placeholder="Ej.: 3424 123456" value="${esc(pref.telefono || '')}"></label>
        <label class="field"><span class="field-label">Modelo</span><select id="pf-mod">${modelos.map((m) => `<option value="${m.id}" ${m === m0 ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select></label>
        <div class="field full"><span class="field-label">Remeras (mismo diseño para todas)</span><div id="pf-lin"></div><button type="button" class="panel-btn" id="pf-lin-add">＋ Otro talle o color</button></div>
        <div class="field full"><span class="field-label">Estampas</span><div id="pf-est"></div><button type="button" class="panel-btn" id="pf-add">＋ Agregar estampa</button></div>
        <label class="field"><span class="field-label">Total ($) · se calcula solo, podés cambiarlo</span><input type="number" id="pf-total" min="0" step="100" value="${Math.round(pref.total || 0)}"></label>
        <label class="field"><span class="field-label">Estado</span><select id="pf-est-sel">${ESTADOS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field full"><span class="field-label">Imágenes del cliente</span><input type="file" id="pf-img" accept="image/*,.pdf" multiple></label>
        <label class="field full"><span class="field-label">Notas</span><textarea id="pf-notas" maxlength="1000">${esc(pref.notas || '')}</textarea></label>
        <div class="field-help full pf-calc"><span id="pf-calc"></span> <button type="button" class="panel-btn" id="pf-recalc" hidden>↺ Usar el precio calculado</button></div>
        <p class="field-help full" id="pf-stock"></p>
      </form>
      <div class="row-actions"><button type="button" class="panel-btn" data-close>Cancelar</button><button type="button" class="download" id="pf-ok">Guardar pedido</button></div>`, (body) => {
      const mod = $('#pf-mod', body);
      // Renglones de remeras: color, talle y cantidad (todas con las mismas estampas)
      const m0x = modeloDe(mod.value);
      const lineas = [{ color: pref.color || m0x.colores[0].nombre, talle: pref.talle || m0x.talles[0], cantidad: pref.cantidad || 1 }];
      const linBox = $('#pf-lin', body);
      const drawLin = () => {
        const m = modeloDe(mod.value);
        lineas.forEach((l) => {
          if (!m.colores.some((c) => c.nombre === l.color)) l.color = m.colores[0].nombre;
          if (!m.talles.includes(l.talle)) l.talle = m.talles[0];
        });
        linBox.innerHTML = lineas.map((l, i) => `<div class="stamp-row" data-i="${i}">
          <label>Color<select data-k="color">${m.colores.map((c) => `<option ${c.nombre === l.color ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
          <label>Talle<select data-k="talle">${m.talles.map((t) => `<option ${t === l.talle ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label>Cantidad<input type="number" data-k="cantidad" min="1" value="${l.cantidad}"></label>
          ${lineas.length > 1 ? '<button type="button" class="icon-btn danger" aria-label="Quitar renglón">✕</button>' : ''}</div>`).join('');
        $$('.stamp-row', linBox).forEach((r) => {
          const i = Number(r.dataset.i);
          $$('[data-k]', r).forEach((inp) => ['input', 'change'].forEach((ev) => inp.addEventListener(ev, () => { lineas[i][inp.dataset.k] = inp.dataset.k === 'cantidad' ? Math.max(1, Math.round(Number(inp.value) || 1)) : inp.value; showStock(); recalc(); })));
          const x = r.querySelector('button');
          if (x) x.addEventListener('click', () => { lineas.splice(i, 1); drawLin(); });
        });
        showStock();
        recalc();
      };
      const showStock = () => {
        const txt = lineas.map((l) => {
          const v = Store.data.variantes.find((x) => x.modelo_id === mod.value && x.color === l.color && x.talle === l.talle);
          return v ? `${l.color} T${l.talle}: ${v.stock} en stock${v.stock < l.cantidad ? ' ⚠ no alcanza' : ''}` : '';
        }).filter(Boolean);
        $('#pf-stock', body).textContent = txt.length ? `Stock: ${txt.join(' · ')}.` : '';
      };
      /* Precio: remera del modelo + estampas (con el cotizador) × cantidad de remeras.
         Se calcula solo hasta que escribís un total a mano; ahí se respeta el tuyo. */
      const totalInp = $('#pf-total', body);
      let manual = Number(pref.total) > 0;   // desde el cotizador ya viene un total
      let calculado = 0;
      function recalc() {
        const prendas = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0), 0) || 1;
        const r = calcular(cotizador(), { modelo_id: mod.value, prendas, base: null, diseno: false, estampas: rows });
        calculado = Math.round(r.total);
        $('#pf-calc', body).innerHTML = `Calculado: <b>${money(calculado)}</b> = ${prendas} ${prendas === 1 ? 'remera' : 'remeras'} × ${money(r.porPrenda)} (remera ${money(r.base)}${r.estPorPrenda ? ` + estampas ${money(r.estPorPrenda)}` : ''})`;
        if (!manual) totalInp.value = calculado;
        $('#pf-recalc', body).hidden = !manual || Number(totalInp.value) === calculado;
      }
      totalInp.addEventListener('input', () => { manual = totalInp.value !== '' && Number(totalInp.value) !== calculado; $('#pf-recalc', body).hidden = !manual; });
      $('#pf-recalc', body).addEventListener('click', () => { manual = false; recalc(); });
      mod.addEventListener('change', drawLin);
      $('#pf-lin-add', body).addEventListener('click', () => { const u = lineas[lineas.length - 1]; lineas.push({ color: u.color, talle: u.talle, cantidad: 1 }); drawLin(); });
      const estBox = $('#pf-est', body);
      const rows = est.map((e) => ({ ...e }));
      drawLin();
      const drawEst = () => {
        estBox.innerHTML = rows.map((e, i) => `<div class="stamp-row" data-i="${i}">
          <label>Zona<select data-k="zona">${ZONAS.map((z) => `<option ${z === e.zona ? 'selected' : ''}>${z}</option>`).join('')}</select></label>
          <label>Ancho cm<input type="number" data-k="ancho" min="1" step="0.1" value="${e.ancho}"></label>
          <label>Alto cm<input type="number" data-k="alto" min="1" step="0.1" value="${e.alto}"></label>
          <label>Por prenda<input type="number" data-k="cantidad" min="1" value="${e.cantidad || 1}"></label>
          <button type="button" class="icon-btn danger" aria-label="Quitar estampa">✕</button></div>`).join('');
        $$('.stamp-row', estBox).forEach((r) => {
          const i = Number(r.dataset.i);
          $$('[data-k]', r).forEach((inp) => ['input', 'change'].forEach((ev) => inp.addEventListener(ev, () => { rows[i][inp.dataset.k] = inp.dataset.k === 'zona' ? inp.value : Number(inp.value); recalc(); })));
          r.querySelector('button').addEventListener('click', () => { rows.splice(i, 1); drawEst(); });
        });
        recalc();
      };
      drawEst();
      $('#pf-add', body).addEventListener('click', () => { rows.push({ zona: 'Espalda', ancho: 25, alto: 30, cantidad: 1 }); drawEst(); });
      $('#pf-ok', body).addEventListener('click', async () => {
        const cliente = $('#pf-cli', body).value.trim();
        if (!cliente) { $('#pf-cli', body).focus(); toast('Escribí el nombre del cliente.', true); return; }
        const btn = $('#pf-ok', body);
        btn.disabled = true;
        btn.textContent = 'Guardando…';
        try {
          const imgs = [];
          for (const f of $('#pf-img', body).files) imgs.push(await Store.putImage(f));
          const numero = Store.mode === 'local' ? Store.data.pedidos.reduce((a, p) => Math.max(a, p.numero || 0), 0) + 1 : undefined;
          const p = {
            id: uid(), fecha: new Date().toISOString(), origen: 'panel', cliente,
            telefono: $('#pf-tel', body).value.trim(),
            items: lineas.map((l) => ({ modelo_id: mod.value, color: l.color, talle: l.talle, cantidad: l.cantidad, estampas: rows.map((e) => ({ ...e })) })),
            total: Number($('#pf-total', body).value) || 0,
            estado: $('#pf-est-sel', body).value, imagenes: imgs, notas: $('#pf-notas', body).value.trim(), stock_descontado: false,
          };
          if (numero) p.numero = numero;
          const saved = await Store.save('pedidos', p);
          closeModal();
          toast('Pedido guardado.');
          if (current === 'pedidos' || current === 'inicio') refresh(); else renderNav();
          if (saved && ['produccion', 'listo', 'entregado'].includes(p.estado)) pedidoDetalle(p.id);
        } catch (err) {
          console.error(err);
          toast('No se pudo guardar: ' + err.message, true);
          btn.disabled = false;
          btn.textContent = 'Guardar pedido';
        }
      });
    });
  }

  async function descontarStockPedido(p, silencioso = false) {
    const faltan = [];
    for (const it of p.items || []) {
      if (it.tipo === 'dtf') continue;   // el DTF solo no usa remeras del stock
      const v = Store.data.variantes.find((x) => x.modelo_id === it.modelo_id && x.color === it.color && x.talle === it.talle);
      if (!v) { faltan.push(`${it.color} T${it.talle}`); continue; }
      await changeStock(v, -(Number(it.cantidad) || 1), 'pedido', `Pedido #${p.numero || ''} · ${p.cliente}`);
    }
    await Store.save('pedidos', { ...p, stock_descontado: true });
    if (faltan.length) toast(`Stock descontado. No encontré en el stock: ${faltan.join(', ')}.`, true);
    else if (!silencioso) toast('Stock descontado.');
  }

  function waLink(tel, text) {
    let n = String(tel || '').replace(/\D/g, '');
    if (!n) return null;
    if (!n.startsWith('54')) n = '549' + n.replace(/^0/, '').replace(/^15/, '');
    return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
  }

  /* =========================================================
     RESULTADOS: ventas, costos y ganancia por período.
     Un pedido cuenta como venta el día que se entrega (cerrado).
     ========================================================= */
  const fechaCierre = (p) => new Date(p.cerrado || ((p.historial || []).slice().reverse().find((h) => h.estado === p.estado) || {}).fecha || p.fecha);
  /* Costo de un pedido: remeras lisas + film DTF usado (a los valores de hoy si no quedó guardado) */
  function costoPedido(p) {
    if (p.costo && p.costo.total != null) return p.costo;
    const c = cotizador();
    const costoCm2 = c.metro / (c.ancho * 100) * (1 + c.merma / 100);
    let remeras = 0, dtf = 0, unidades = 0;
    (p.items || []).forEach((it) => {
      if (it.tipo === 'dtf') {
        // Film usado: largo del lienzo (o lo que ocupan las sueltas) al costo del metro, según el ancho
        const largo = it.modo === 'sueltas' ? Number(it.usado) || 0 : Number(it.largo) || 0;
        dtf += largo / 100 * c.metro * (Number(it.ancho) || c.ancho) / (Number(c.ancho) || 60) * (it.modo === 'sueltas' ? 1 + c.merma / 100 : 1);
        return;
      }
      const m = modeloDe(it.modelo_id);
      const cant = Number(it.cantidad) || 1;
      unidades += cant;
      remeras += (m ? Number(m.costo) || 0 : 0) * cant;
      (it.estampas || []).forEach((e) => { dtf += (Number(e.ancho) || 0) * (Number(e.alto) || 0) * costoCm2 * (Number(e.cantidad) || 1) * cant; });
    });
    return { remeras: Math.round(remeras), dtf: Math.round(dtf), total: Math.round(remeras + dtf), unidades };
  }

  let periodo = { tipo: 'mes', desde: '', hasta: '' };
  function rangoPeriodo() {
    const hoy = new Date();
    const d0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    switch (periodo.tipo) {
      case 'mes-pasado': return [new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), new Date(hoy.getFullYear(), hoy.getMonth(), 1)];
      case '30': return [new Date(d0(hoy).getTime() - 29 * 864e5), new Date(d0(hoy).getTime() + 864e5)];
      case 'anio': return [new Date(hoy.getFullYear(), 0, 1), new Date(hoy.getFullYear() + 1, 0, 1)];
      case 'otro': {
        const a = periodo.desde ? new Date(periodo.desde + 'T00:00') : new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const b = periodo.hasta ? new Date(new Date(periodo.hasta + 'T00:00').getTime() + 864e5) : new Date(d0(hoy).getTime() + 864e5);
        return [a, b];
      }
      default: return [new Date(hoy.getFullYear(), hoy.getMonth(), 1), new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1)];
    }
  }

  function renderResultados(el) {
    const [desde, hasta] = rangoPeriodo();
    const enRango = (d) => d >= desde && d < hasta;
    const pedidos = Store.data.pedidos;
    const entregados = pedidos.filter((p) => p.estado === 'entregado' && enRango(fechaCierre(p)));
    const cancelados = pedidos.filter((p) => p.estado === 'cancelado' && enRango(fechaCierre(p)));
    let ventas = 0, cRem = 0, cDtf = 0, unidades = 0;
    const porColor = {}, porTalle = {};
    entregados.forEach((p) => {
      const c = costoPedido(p);
      ventas += Number(p.total) || 0; cRem += c.remeras; cDtf += c.dtf; unidades += c.unidades;
      (p.items || []).filter((it) => it.tipo !== 'dtf').forEach((it) => {
        porColor[it.color] = (porColor[it.color] || 0) + (Number(it.cantidad) || 1);
        porTalle[it.talle] = (porTalle[it.talle] || 0) + (Number(it.cantidad) || 1);
      });
    });
    const senasRetenidas = cancelados.filter((p) => p.sena_pagada).reduce((a, p) => a + (Number(p.sena) || 0), 0);
    const ganancia = ventas - cRem - cDtf + senasRetenidas;
    const margen = ventas ? Math.round((ventas - cRem - cDtf) / ventas * 100) : 0;
    // En curso (sin importar el período)
    const enProd = pedidos.filter((p) => p.estado === 'produccion' || p.estado === 'confirmado' || p.estado === 'nuevo');
    const listos = pedidos.filter((p) => p.estado === 'listo');
    const sinSena = pedidos.filter((p) => p.estado === 'sena');
    const aCobrar = [...enProd, ...listos].reduce((a, p) => a + (Number(p.total) || 0) - (p.sena_pagada ? Number(p.sena) || 0 : 0), 0);
    // Barras por semana (períodos cortos) o por mes (año)
    const porMes = periodo.tipo === 'anio' || (hasta - desde) > 70 * 864e5;
    const grupos = [];
    for (let t = new Date(desde); t < hasta;) {
      const fin = porMes ? new Date(t.getFullYear(), t.getMonth() + 1, 1) : new Date(t.getTime() + 7 * 864e5);
      const ps = entregados.filter((p) => { const f = fechaCierre(p); return f >= t && f < fin && f < hasta; });
      const v = ps.reduce((a, p) => a + (Number(p.total) || 0), 0);
      const g = ps.reduce((a, p) => a + (Number(p.total) || 0) - costoPedido(p).total, 0);
      grupos.push({ label: porMes ? t.toLocaleDateString('es-AR', { month: 'short' }) : `${t.getDate()}/${t.getMonth() + 1}`, v, g });
      t = fin;
    }
    const maxV = Math.max(1, ...grupos.map((g) => g.v));
    const tipos = [['mes', 'Este mes'], ['mes-pasado', 'Mes pasado'], ['30', 'Últimos 30 días'], ['anio', 'Este año'], ['otro', 'Elegir fechas']];
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 6);

    el.innerHTML = head('Resultados', 'Ventas, costos y ganancia de los pedidos entregados. Cada pedido cuenta el día que lo entregás.',
      `<button type="button" class="panel-btn" id="rs-csv" ${entregados.length ? '' : 'disabled'}>↓ Descargar planilla</button>`) + `
      <div class="tabs" role="group" aria-label="Período">${tipos.map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${periodo.tipo === k}">${l}</button>`).join('')}</div>
      ${periodo.tipo === 'otro' ? `<div class="form-grid box" style="margin-bottom:14px"><label class="field"><span class="field-label">Desde</span><input type="date" id="rs-desde" value="${iso(desde)}"></label><label class="field"><span class="field-label">Hasta</span><input type="date" id="rs-hasta" value="${iso(new Date(hasta.getTime() - 864e5))}"></label></div>` : ''}
      <p class="field-help" style="margin:-4px 0 12px">Del ${fmtDate(desde)} al ${fmtDate(new Date(hasta.getTime() - 864e5))}</p>
      <div class="stats">
        <div class="stat"><small>Ventas</small><strong>${money(ventas)}</strong><span>${entregados.length} ${entregados.length === 1 ? 'pedido entregado' : 'pedidos entregados'}</span></div>
        <div class="stat"><small>Ganancia</small><strong style="color:#1e7a3c">${money(ganancia)}</strong><span>margen ${margen} %</span></div>
        <div class="stat"><small>Remeras vendidas</small><strong>${unidades}</strong><span>ticket promedio ${money(entregados.length ? ventas / entregados.length : 0)}</span></div>
        <div class="stat"><small>Costos</small><strong>${money(cRem + cDtf)}</strong><span>remeras ${money(cRem)} · DTF ${money(cDtf)}</span></div>
      </div>
      <div class="grid-2">
        <section class="box"><h2>Cuentas del período</h2>
          <dl class="breakdown">
            <div><dt>Ventas (pedidos entregados)</dt><dd>${money(ventas)}</dd></div>
            <div><dt>Costo de las remeras lisas</dt><dd>− ${money(cRem)}</dd></div>
            <div><dt>Costo del film DTF</dt><dd>− ${money(cDtf)}</dd></div>
            ${senasRetenidas ? `<div><dt>Señas de pedidos cancelados</dt><dd>+ ${money(senasRetenidas)}</dd></div>` : ''}
            <hr>
            <div class="profit"><dt><b>Ganancia</b></dt><dd>${money(ganancia)}</dd></div>
          </dl>
          <p class="field-help">El costo de las remeras sale de Modelos y precios, y el del DTF, del Cotizador. Queda guardado en cada pedido el día que se entrega, así un cambio de precios no altera los meses anteriores.</p>
        </section>
        <section class="box"><h2>${porMes ? 'Ventas por mes' : 'Ventas por semana'}</h2>
          ${entregados.length ? `<div class="bars" role="img" aria-label="Ventas y ganancia por ${porMes ? 'mes' : 'semana'}">${grupos.map((g) => `
            <div class="bar-col" title="${g.label}: ventas ${money(g.v)}, ganancia ${money(g.g)}">
              <span class="bar-val">${g.v ? money(g.v).replace('$ ', '$') : ''}</span>
              <div class="bar-track"><i class="bar-v" style="height:${g.v / maxV * 100}%"></i><i class="bar-g" style="height:${Math.max(0, g.g) / maxV * 100}%"></i></div>
              <small>${g.label}</small>
            </div>`).join('')}</div>
          <p class="legend"><span><i class="bar-v"></i>Ventas</span><span><i class="bar-g"></i>Ganancia</span></p>` : '<p class="empty">Todavía no hay pedidos entregados en este período.</p>'}
        </section>
      </div>
      <div class="grid-2">
        <section class="box"><h2>En curso ahora</h2>
          <dl class="breakdown">
            <div><dt>Esperando seña</dt><dd>${sinSena.length}</dd></div>
            <div><dt>En producción</dt><dd>${enProd.length}</dd></div>
            <div><dt>Listos para entregar</dt><dd>${listos.length}</dd></div>
            <hr>
            <div class="profit"><dt><b>Por cobrar al entregar</b></dt><dd>${money(aCobrar)}</dd></div>
          </dl>
        </section>
        <section class="box"><h2>Lo más vendido</h2>
          ${entregados.length ? `<div class="grid-2" style="gap:10px">
            <table class="tbl"><thead><tr><th>Color</th><th class="num">Unid.</th></tr></thead><tbody>${top(porColor).map(([k, n]) => `<tr><td>${esc(k)}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table>
            <table class="tbl"><thead><tr><th>Talle</th><th class="num">Unid.</th></tr></thead><tbody>${top(porTalle).map(([k, n]) => `<tr><td>T${esc(k)}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table>
          </div>` : '<p class="empty">Sin ventas en este período.</p>'}
        </section>
      </div>
      <section class="box"><h2>Pedidos entregados</h2>
        ${entregados.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Entregado</th><th>Cliente</th><th class="num">Venta</th><th class="num">Costo</th><th class="num">Ganancia</th></tr></thead><tbody>
          ${entregados.slice().sort((a, b) => fechaCierre(b) - fechaCierre(a)).map((p) => { const c = costoPedido(p); return `<tr data-id="${p.id}" style="cursor:pointer"><td>#${p.numero || '–'}</td><td>${fmtDate(fechaCierre(p))}</td><td>${esc(p.cliente)}</td><td class="num">${money(p.total)}</td><td class="num">${money(c.total)}</td><td class="num"><b>${money(p.total - c.total)}</b></td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="empty">Cuando marques pedidos como «Entregado», aparecen acá.</p>'}
      </section>`;

    $$('.tabs button', el).forEach((b) => b.addEventListener('click', () => { periodo.tipo = b.dataset.p; refresh(); }));
    const dD = $('#rs-desde', el), dH = $('#rs-hasta', el);
    if (dD) dD.addEventListener('change', () => { periodo.desde = dD.value; refresh(); });
    if (dH) dH.addEventListener('change', () => { periodo.hasta = dH.value; refresh(); });
    $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => pedidoDetalle(tr.dataset.id)));
    $('#rs-csv', el).addEventListener('click', () => {
      const filas = [['Numero', 'Entregado', 'Cliente', 'WhatsApp', 'Detalle', 'Venta', 'Costo remeras', 'Costo DTF', 'Ganancia']];
      entregados.forEach((p) => { const c = costoPedido(p); filas.push([p.numero || '', fmtDate(fechaCierre(p)), p.cliente, p.telefono || '', itemsResumen(p).join(' | '), p.total, c.remeras, c.dtf, p.total - c.total]); });
      const csv = '﻿' + filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `resultados-${iso(desde)}-a-${iso(new Date(hasta.getTime() - 864e5))}.csv`);
    });
  }

  /* Recorrido de un pedido: un botón para pasar al paso siguiente */
  const FLUJO = [['sena', 'Seña'], ['produccion', 'Producción'], ['listo', 'Listo'], ['entregado', 'Entregado']];
  function siguientePaso(p) {
    if (p.estado === 'sena') return { estado: 'produccion', label: p.sena_pagada ? '▶ Seña ya pagada: pasar a producción' : '✓ Seña recibida: pasar a producción', sena: true };
    if (p.estado === 'nuevo' || p.estado === 'confirmado') return { estado: 'produccion', label: '▶ Pasar a producción' };
    if (p.estado === 'produccion') return { estado: 'listo', label: '✓ Terminado: listo para entregar' };
    if (p.estado === 'listo') return { estado: 'entregado', label: '✓ Entregado' };
    return null;
  }
  async function cambiarEstado(id, nuevo, extra = {}) {
    const prev = Store.data.pedidos.find((x) => x.id === id);
    const ahora = new Date().toISOString();
    const historial = [...(prev.historial || []), { estado: nuevo, fecha: ahora }];
    const cierre = ['entregado', 'cancelado'].includes(nuevo)
      ? { cerrado: ahora, costo: nuevo === 'entregado' ? costoPedido({ ...prev, costo: null }) : prev.costo || null }
      : { cerrado: null };
    await Store.save('pedidos', { ...prev, ...extra, ...cierre, historial, estado: nuevo });
    const cur = Store.data.pedidos.find((x) => x.id === id);
    // Al entrar en producción se descuentan solas las remeras lisas del stock
    if (['produccion', 'listo', 'entregado'].includes(nuevo) && !cur.stock_descontado) await descontarStockPedido(cur, true);
    toast(`Pedido #${cur.numero || ''}: ${estadoLabel(nuevo)}${nuevo === 'produccion' ? ' · stock descontado' : ''}.`);
  }

  async function pedidoDetalle(id) {
    const p = Store.data.pedidos.find((x) => x.id === id);
    if (!p) return;
    openModal(`Pedido #${p.numero || '–'} · ${p.cliente}`, `
      <p><span class="badge st-${p.estado}">${estadoLabel(p.estado)}</span> · ${fmtDateTime(p.fecha)} · ${p.origen === 'tienda' ? 'Tienda online' : 'Cargado en el panel'}</p>
      <ul class="order-items">${itemsResumen(p).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      ${(() => {
        if (p.stock_descontado || ['entregado', 'cancelado'].includes(p.estado)) return '';
        const sinStock = faltantes().filter((r) => r.faltan > 0 && r.pedidos.includes(p));
        return sinStock.length ? `<p class="sena-line">⚠ No hay stock suficiente de: ${sinStock.map((r) => `<b>${esc(r.color)} T${esc(r.talle)}</b> (faltan ${r.faltan})`).join(', ')}. <a href="#reponer" data-close>Ver lista para reponer</a></p>` : '';
      })()}
      <p><b>Total: ${money(p.total)}</b>${p.telefono ? ` · WhatsApp: ${esc(p.telefono)}` : ''}</p>
      ${p.pago && p.pago.proveedor === 'mercadopago' ? `<p class="sena-line is-ok">✓ Pagado con <b>Mercado Pago</b>: ${money(p.pago.monto)}${p.pago.recargo ? ` (incluye ${money(p.pago.recargo)} de costo de Mercado Pago)` : ''}${p.pago.metodo ? ` · ${esc(p.pago.metodo)}` : ''} el ${fmtDateTime(p.pago.fecha)} · operación ${esc(p.pago.id)}</p>` : ''}
      ${p.sena ? `<p class="sena-line ${p.sena_pagada ? 'is-ok' : ''}">${p.sena_pagada ? '✓ Seña recibida' : '⏳ Seña pendiente'}: <b>${money(p.sena)}</b> · Resto: ${money(p.total - p.sena)}${!p.sena_pagada && p.estado === 'sena' ? ` · Se borra el ${fmtDate(venceEl(p))} si no paga` : ''}</p>` : ''}
      ${p.estado !== 'cancelado' ? `<ol class="flujo" aria-label="Recorrido del pedido">${FLUJO.map(([k, l], i) => {
        const pos = p.estado === 'nuevo' || p.estado === 'confirmado' ? 0.5 : FLUJO.findIndex(([kk]) => kk === p.estado);
        const h = (p.historial || []).slice().reverse().find((x) => x.estado === k);
        const f = h ? new Date(h.fecha) : (k === 'sena' && p.origen === 'tienda' ? new Date(p.fecha) : null);
        return `<li class="${i < pos ? 'is-done' : ''} ${i === pos ? 'is-now' : ''}">${l}${f && i <= pos ? `<small>${f.getDate()}/${f.getMonth() + 1}</small>` : ''}</li>`;
      }).join('')}</ol>` : ''}
      ${siguientePaso(p) ? `<button type="button" class="download" id="pd-next">${siguientePaso(p).label}</button>` : ''}
      ${(p.items || []).some((x) => x.tipo === 'dtf') ? '<button type="button" class="panel-btn" id="pd-lienzo">▦ Abrir en «Armar lienzo» para imprimir</button>' : ''}
      ${p.notas ? `<p class="panel-note">${esc(p.notas)}</p>` : ''}
      <div class="field"><span class="field-label">Imágenes</span><div class="thumbs" id="pd-imgs">${(p.imagenes || []).length ? 'Cargando…' : '<span class="field-help">Sin imágenes.</span>'}</div></div>
      <label class="field"><span class="field-label">Cambiar estado a mano</span><select id="pd-estado">${ESTADOS.map(([k, l]) => `<option value="${k}" ${k === p.estado ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="field-help">${p.stock_descontado ? '✓ El stock de este pedido ya se descontó.' : 'El stock se descuenta solo cuando el pedido pasa a producción.'}</p>
      <div class="row-actions">
        <button type="button" class="panel-btn danger-btn" id="pd-del">Eliminar</button>
        ${p.telefono ? '<button type="button" class="panel-btn" id="pd-wa">WhatsApp</button>' : ''}
        ${!p.stock_descontado && ['produccion', 'listo', 'entregado'].includes(p.estado) ? '<button type="button" class="panel-btn" id="pd-stock">Descontar stock</button>' : ''}
        <button type="button" class="download" data-close>Listo</button>
      </div>`, async (body) => {
      $('#pd-estado', body).addEventListener('change', async (e) => {
        await cambiarEstado(id, e.target.value);
        refresh();
        pedidoDetalle(id);
      });
      const lz = $('#pd-lienzo', body);
      if (lz) lz.addEventListener('click', () => { closeModal(); abrirLienzoPedido(Store.data.pedidos.find((x) => x.id === id)); });
      const nx = $('#pd-next', body);
      if (nx) nx.addEventListener('click', async () => {
        const paso = siguientePaso(Store.data.pedidos.find((x) => x.id === id));
        nx.disabled = true;
        await cambiarEstado(id, paso.estado, paso.sena ? { sena_pagada: true } : {});
        refresh();
        pedidoDetalle(id);
      });
      const wa = $('#pd-wa', body);
      if (wa) wa.addEventListener('click', () => {
        const t = Store.data.config.tienda || {};
        const texto = p.estado === 'sena'
          ? `Hola ${p.cliente}! Te escribo de Tu Estampa SF por tu pedido de ${money(p.total)}. Para confirmarlo falta la seña de ${money(p.sena)}${t.alias ? ` al alias ${t.alias}` : ''}. Cuando la transfieras, mandame el comprobante por acá. ¡Gracias!`
          : p.estado === 'listo'
            ? `Hola ${p.cliente}! Tu pedido #${p.numero || ''} de Tu Estampa SF ya está listo para retirar 🎉${p.sena && p.sena_pagada ? ` Te queda por pagar ${money(p.total - p.sena)}.` : ''}`
            : p.estado === 'produccion'
              ? `Hola ${p.cliente}! Recibimos tu seña y tu pedido #${p.numero || ''} ya está en producción. Te avisamos cuando esté listo (3 a 5 días).`
              : `Hola ${p.cliente}! Te escribo de Tu Estampa SF por tu pedido #${p.numero || ''}: ${estadoLabel(p.estado).toLowerCase()}.`;
        const link = waLink(p.telefono, texto);
        if (link) window.open(link, '_blank', 'noopener');
      });
      const st = $('#pd-stock', body);
      if (st) st.addEventListener('click', async () => { await descontarStockPedido(Store.data.pedidos.find((x) => x.id === id)); refresh(); pedidoDetalle(id); });
      $('#pd-del', body).addEventListener('click', async () => {
        if (!$('#pd-del', body).dataset.sure) { $('#pd-del', body).dataset.sure = '1'; $('#pd-del', body).textContent = '¿Seguro? Tocá de nuevo'; return; }
        for (const im of p.imagenes || []) { try { await Store.removeImage(im.ref); } catch (e) { /* sigue */ } }
        await Store.remove('pedidos', id);
        closeModal();
        toast('Pedido eliminado.');
        refresh();
      });
      // Miniaturas con descarga y "editar en las herramientas"
      const box = $('#pd-imgs', body);
      if ((p.imagenes || []).length) {
        box.innerHTML = '';
        for (const im of p.imagenes) {
          try {
            const blob = await Store.imageBlob(im.ref);
            if (!blob) continue;
            const url = URL.createObjectURL(blob);
            const fig = document.createElement('figure');
            fig.innerHTML = `<img src="${url}" alt="${esc(im.name)}" loading="lazy"><figcaption><button type="button" class="icon-btn" title="Descargar" aria-label="Descargar ${esc(im.name)}">↓</button><button type="button" class="icon-btn" title="Editar en las herramientas" aria-label="Editar ${esc(im.name)}">✎</button></figcaption>`;
            const [dl, ed] = fig.querySelectorAll('button');
            dl.addEventListener('click', () => downloadBlob(blob, im.name || 'imagen.png'));
            ed.addEventListener('click', () => { closeModal(); openInEditor(blob, im.name); });
            box.appendChild(fig);
          } catch (e) { console.warn(e); }
        }
        if (!box.children.length) box.innerHTML = '<span class="field-help">No se pudieron cargar las imágenes.</span>';
      }
    });
  }

  /* =========================================================
     7. STOCK Y ESCÁNER
     ========================================================= */
  let stockModelo = null;
  let showHistorial = false;

  function renderStock(el) {
    const modelos = Store.data.modelos;
    if (!stockModelo || !modeloDe(stockModelo)) stockModelo = modelos[0] && modelos[0].id;
    const m = modeloDe(stockModelo);
    const vars = Store.data.variantes.filter((v) => v.modelo_id === stockModelo);
    const totalModelo = vars.reduce((a, v) => a + v.stock, 0);
    el.innerHTML = head('Stock de remeras', 'Tocá un casillero para sumar, descontar o corregir. Con el escáner cargás el ingreso de mercadería en segundos.', `
        <button type="button" class="panel-btn primary" data-act="scan">▦ Escanear</button>
        <button type="button" class="panel-btn" data-act="hist">${showHistorial ? 'Ver stock' : 'Historial'}</button>
        <button type="button" class="panel-btn" data-act="csv">↓ Excel (CSV)</button>`) + `
      <form class="scan-manual no-print" id="stock-find" style="max-width:420px;margin:0 0 12px">
        <label class="sr-only" for="stock-code">Buscar por código</label>
        <input type="text" id="stock-code" placeholder="Buscar código (o usá un lector USB)" autocomplete="off">
        <button type="submit" class="panel-btn">Buscar</button>
      </form>
      ${modelos.length > 1 ? `<div class="tabs">${modelos.map((x) => `<button type="button" data-m="${x.id}" aria-pressed="${x.id === stockModelo}">${esc(x.nombre)}</button>`).join('')}</div>` : ''}
      <div id="stock-body"></div>`;
    const body = $('#stock-body', el);
    if (showHistorial) {
      const movs = Store.data.movimientos.slice().reverse().slice(0, 300);
      body.innerHTML = movs.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Remera</th><th class="num">Cantidad</th><th>Motivo</th><th>Detalle</th></tr></thead><tbody>
        ${movs.map((mv) => { const v = Store.data.variantes.find((x) => x.id === mv.variante_id); return `<tr><td>${fmtDateTime(mv.fecha)}</td><td>${v ? esc(varianteLabel(v)) : '—'}</td><td class="num" style="color:${mv.cantidad > 0 ? '#1e7a3c' : '#b42318'}">${mv.cantidad > 0 ? '+' : ''}${mv.cantidad}</td><td>${esc(mv.motivo)}</td><td>${esc(mv.detalle || '')}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<div class="box"><p class="empty">Todavía no hay movimientos.</p></div>';
    } else if (m) {
      body.innerHTML = `<div class="table-wrap"><table class="tbl stock-matrix"><thead><tr><th class="sw-col">${esc(m.nombre)} · ${totalModelo} u.</th>${m.talles.map((t) => `<th class="num">T${esc(t)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
        ${m.colores.map((c) => {
          const row = m.talles.map((t) => vars.find((v) => v.color === c.nombre && v.talle === t));
          return `<tr><td><span class="color-name"><i style="background:${c.hex}"></i>${esc(c.nombre)}</span></td>
            ${row.map((v) => (v ? `<td class="num"><button type="button" class="cell-btn ${v.stock <= 0 ? 'is-zero' : v.stock <= v.minimo ? 'is-low' : ''}" data-v="${v.id}" aria-label="${esc(c.nombre)} talle ${esc(v.talle)}: ${v.stock} unidades">${v.stock}</button></td>` : '<td class="num">—</td>')).join('')}
            <td class="num"><b>${row.reduce((a, v) => a + (v ? v.stock : 0), 0)}</b></td></tr>`;
        }).join('')}
        <tr><td><b>Total</b></td>${m.talles.map((t) => `<td class="num"><b>${vars.filter((v) => v.talle === t).reduce((a, v) => a + v.stock, 0)}</b></td>`).join('')}<td class="num"><b>${totalModelo}</b></td></tr>
      </tbody></table></div>
      <div class="legend"><span><i style="background:#fff4f2;border:1px solid #f1c0bb"></i>Sin stock</span><span><i style="background:#fff8e6;border:1px solid #f5c56b"></i>En el mínimo</span><span>Costo ${money(m.costo)} · Venta ${money(m.precio)}</span></div>`;
      $$('.cell-btn', body).forEach((b) => b.addEventListener('click', () => ajusteStock(b.dataset.v)));
    }
    el.querySelector('[data-act="scan"]').addEventListener('click', openScanner);
    el.querySelector('[data-act="hist"]').addEventListener('click', () => { showHistorial = !showHistorial; refresh(); });
    el.querySelector('[data-act="csv"]').addEventListener('click', exportCsv);
    $$('.tabs button[data-m]', el).forEach((b) => b.addEventListener('click', () => { stockModelo = b.dataset.m; refresh(); }));
    $('#stock-find', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const code = $('#stock-code', el).value.trim().toUpperCase();
      const v = Store.data.variantes.find((x) => x.codigo.toUpperCase() === code);
      if (v) ajusteStock(v.id); else toast('No encontré ese código.', true);
    });
  }

  function ajusteStock(vid) {
    const v = Store.data.variantes.find((x) => x.id === vid);
    if (!v) return;
    let modo = 'in';
    openModal(varianteLabel(v), `
      <p class="field-help">Código <b>${esc(v.codigo)}</b></p>
      <div class="stat" style="margin:6px 0 12px"><small>Stock actual</small><strong id="aj-now">${v.stock}</strong></div>
      <div class="segmented" role="group" aria-label="Tipo de movimiento" id="aj-mode">
        <button type="button" data-v="in" aria-pressed="true">＋ Ingreso</button>
        <button type="button" data-v="out" aria-pressed="false">− Salida</button>
        <button type="button" data-v="set" aria-pressed="false">Corregir</button>
      </div>
      <div class="form-grid" style="margin-top:10px">
        <label class="field"><span class="field-label" id="aj-qlabel">Cantidad que entra</span><input type="number" id="aj-q" min="0" value="1" inputmode="numeric"></label>
        <label class="field"><span class="field-label">Motivo</span><select id="aj-mot"></select></label>
        <label class="field"><span class="field-label">Stock mínimo (alerta)</span><input type="number" id="aj-min" min="0" value="${v.minimo}" inputmode="numeric"></label>
        <label class="field"><span class="field-label">Detalle (opcional)</span><input type="text" id="aj-det" maxlength="120" placeholder="Ej.: proveedor, cliente"></label>
      </div>
      <div class="row-actions"><button type="button" class="panel-btn" data-close>Cancelar</button><button type="button" class="download" id="aj-ok">Guardar</button></div>`, (body) => {
      const MOT = { in: ['Ingreso de mercadería', 'Devolución'], out: ['Venta en mostrador', 'Pedido', 'Falla / descarte', 'Uso propio'], set: ['Ajuste de inventario'] };
      const setMode = (k) => {
        modo = k;
        $$('#aj-mode button', body).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === k)));
        $('#aj-qlabel', body).textContent = k === 'in' ? 'Cantidad que entra' : k === 'out' ? 'Cantidad que sale' : 'Stock real contado';
        $('#aj-mot', body).innerHTML = MOT[k].map((x) => `<option>${x}</option>`).join('');
        if (k === 'set') $('#aj-q', body).value = v.stock;
      };
      setMode('in');
      $$('#aj-mode button', body).forEach((b) => b.addEventListener('click', () => setMode(b.dataset.v)));
      $('#aj-ok', body).addEventListener('click', async () => {
        const q = Math.max(0, Math.round(Number($('#aj-q', body).value) || 0));
        const motivo = $('#aj-mot', body).value;
        const det = $('#aj-det', body).value.trim();
        const minimo = Math.max(0, Math.round(Number($('#aj-min', body).value) || 0));
        let cur = Store.data.variantes.find((x) => x.id === vid);
        if (minimo !== cur.minimo) { cur = { ...cur, minimo }; await Store.save('variantes', cur); }
        if (modo === 'in') await changeStock(cur, q, motivo, det);
        else if (modo === 'out') await changeStock(cur, -q, motivo, det);
        else await setStock(cur, q, motivo, det);
        closeModal();
        toast('Stock actualizado.');
        refresh();
      });
    });
  }

  function exportCsv() {
    const rows = [['Modelo', 'Color', 'Talle', 'Código', 'Stock', 'Mínimo', 'Costo', 'Precio']];
    Store.data.variantes.forEach((v) => {
      const m = modeloDe(v.modelo_id) || {};
      rows.push([m.nombre, v.color, v.talle, v.codigo, v.stock, v.minimo, m.costo, m.precio]);
    });
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `stock-tuestampa-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  /* --- Escáner: BarcodeDetector del navegador o ZXing como respaldo --- */
  const scan = { mode: 'in', stream: null, raf: 0, reader: null, last: '', lastAt: 0 };

  function openScanner() {
    const dlg = $('#scanner');
    $('#scan-result').innerHTML = '';
    if (!dlg.open) dlg.showModal();
    startCamera();
    setTimeout(() => $('#scan-code').focus(), 100);
  }
  async function startCamera() {
    const video = $('#scan-video');
    const msg = $('#scan-msg');
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg.textContent = 'Este navegador no permite usar la cámara. Escribí el código abajo.';
      return;
    }
    try {
      if ('BarcodeDetector' in window) {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('code_128')) {
          scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          video.srcObject = scan.stream;
          await video.play();
          const det = new window.BarcodeDetector({ formats: ['code_128', 'ean_13', 'qr_code'] });
          const loop = async () => {
            if (!scan.stream) return;
            try {
              const codes = await det.detect(video);
              if (codes[0]) onScanned(codes[0].rawValue);
            } catch (e) { /* cuadro sin código */ }
            scan.raf = requestAnimationFrame(loop);
          };
          loop();
          msg.textContent = 'Apuntá la cámara al código de barras.';
          return;
        }
      }
      // Respaldo (iPhone y navegadores sin lector propio)
      await loadScript('../vendor/zxing.min.js');
      scan.reader = new window.ZXing.BrowserMultiFormatReader();
      await scan.reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (res) => { if (res) onScanned(res.getText()); });
      msg.textContent = 'Apuntá la cámara al código de barras.';
    } catch (err) {
      console.warn(err);
      msg.textContent = 'No se pudo abrir la cámara (revisá el permiso). Podés escribir el código abajo.';
    }
  }
  function stopCamera() {
    cancelAnimationFrame(scan.raf);
    if (scan.reader) { try { scan.reader.reset(); } catch (e) { /* ya cerrado */ } scan.reader = null; }
    if (scan.stream) { scan.stream.getTracks().forEach((t) => t.stop()); scan.stream = null; }
  }
  function beep(ok) {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = ok ? 1200 : 300;
      g.gain.value = 0.08;
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.12);
      if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]);
    } catch (e) { /* sin sonido */ }
  }
  async function onScanned(raw) {
    const code = String(raw || '').trim().toUpperCase();
    const now = Date.now();
    if (!code || (code === scan.last && now - scan.lastAt < 1800)) return;   // evita leer dos veces la misma etiqueta
    scan.last = code;
    scan.lastAt = now;
    const box = $('#scan-result');
    const v = Store.data.variantes.find((x) => x.codigo.toUpperCase() === code);
    if (!v) {
      beep(false);
      box.innerHTML = `<div class="scan-hit is-bad"><span>No encontré <b style="font-size:14px">${esc(code)}</b></span></div>`;
      return;
    }
    let nv = v;
    if (scan.mode === 'in') nv = await changeStock(v, 1, 'Ingreso de mercadería', 'Escáner');
    else if (scan.mode === 'out') nv = await changeStock(v, -1, 'Venta en mostrador', 'Escáner');
    beep(true);
    const verb = scan.mode === 'in' ? '＋1 ingresó' : scan.mode === 'out' ? '−1 salió' : 'Stock';
    box.innerHTML = `<div class="scan-hit"><span>${verb}: <strong>${esc(varianteLabel(nv))}</strong></span><b>${nv.stock}</b></div>`;
    if (current === 'stock' || current === 'inicio') refresh();
  }
  function initScanner() {
    $$('#scan-mode button').forEach((b) => b.addEventListener('click', () => {
      scan.mode = b.dataset.v;
      $$('#scan-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    $('#scan-manual').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('#scan-code');
      scan.last = '';
      onScanned(inp.value);
      inp.value = '';
    });
    $('#scanner').addEventListener('close', stopCamera);
  }

  /* =========================================================
     8. ETIQUETAS CON CÓDIGO DE BARRAS
     ========================================================= */
  /* ---------------------------------------------------------
     Etiquetas en hoja A4: vista previa y PDF listo para imprimir.
     Todo se mide en milímetros. El mismo dibujo sirve para la
     vista previa (canvas) y para el PDF (vectorial: el código de
     barras sale nítido en cualquier impresora).
     --------------------------------------------------------- */
  const HOJAS = {
    'a4-24': { label: '24 por hoja · 70 × 37 mm (3 × 8)', cols: 3, rows: 8, w: 70, h: 37, top: 0.5, left: 0, gapX: 0, gapY: 0 },
    'a4-21': { label: '21 por hoja · 70 × 42,4 mm (3 × 7)', cols: 3, rows: 7, w: 70, h: 42.4, top: 0.2, left: 0, gapX: 0, gapY: 0 },
    'a4-40': { label: '40 por hoja · 52,5 × 29,7 mm (4 × 10)', cols: 4, rows: 10, w: 52.5, h: 29.7, top: 0, left: 0, gapX: 0, gapY: 0 },
    'a4-14': { label: '14 por hoja · 105 × 42,4 mm (2 × 7)', cols: 2, rows: 7, w: 105, h: 42.4, top: 0.2, left: 0, gapX: 0, gapY: 0 },
    'a4-65': { label: '65 por hoja · 38,1 × 21,2 mm (5 × 13)', cols: 5, rows: 13, w: 38.1, h: 21.2, top: 10.7, left: 4.7, gapX: 2.5, gapY: 0 },
    'papel': { label: 'Papel común A4 · 4 × 9 con líneas de corte', cols: 4, rows: 9, w: 48, h: 30, top: 13.5, left: 9, gapX: 0, gapY: 0, bordes: true },
  };
  const A4 = { w: 210, h: 297 };
  const LBL_KEY = 'te_etiquetas_v2';
  const lbl = Object.assign({
    modelo: null, colores: null, talles: null, copias: 1, porStock: false,
    hoja: 'a4-24', logo: true, precio: true, nombre: true, bordes: false, desde: 1, ajusteX: 0, ajusteY: 0, pagina: 0,
  }, (() => { try { const s = JSON.parse(localStorage.getItem(LBL_KEY) || '{}'); delete s.modelo; delete s.colores; delete s.talles; delete s.pagina; return s; } catch (e) { return {}; } })());
  const guardarLbl = () => { try { const { modelo, colores, talles, pagina, ...rest } = lbl; localStorage.setItem(LBL_KEY, JSON.stringify(rest)); } catch (e) { /* sin almacenamiento */ } };

  /* Logo como JPEG (para el PDF) y como imagen (para la vista previa) */
  let logoCache = null;
  function cargarLogo() {
    if (logoCache) return logoCache;
    logoCache = new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const S = 300;
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        const x = c.getContext('2d');
        x.fillStyle = '#fff';
        x.fillRect(0, 0, S, S);
        x.drawImage(img, 0, 0, S, S);
        const b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1];
        res({ img: c, jpeg: Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), size: S });
      };
      img.onerror = () => res(null);
      img.src = '../img/logo.png';
    });
    return logoCache;
  }

  /* Barras del código (CODE128) en módulos, usando JsBarcode solo para codificar */
  const barrasCache = new Map();
  function barras(codigo) {
    if (barrasCache.has(codigo)) return barrasCache.get(codigo);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    window.JsBarcode(svg, codigo, { format: 'CODE128', width: 1, height: 10, margin: 0, displayValue: false });
    const rects = Array.from(svg.querySelectorAll('rect')).filter((r) => r.getAttribute('style') !== 'fill:#ffffff;' && Number(r.getAttribute('width')) > 0 && r.getAttribute('fill') !== '#ffffff');
    let total = Number(svg.getAttribute('width')) || 0;
    const bars = rects.map((r) => ({ x: Number(r.getAttribute('x')), w: Number(r.getAttribute('width')) }));
    if (!total) total = bars.reduce((a, b) => Math.max(a, b.x + b.w), 0);
    const out = { bars, total };
    barrasCache.set(codigo, out);
    return out;
  }

  /* Medidor de texto (Arial ≈ Helvetica, la fuente del PDF) */
  const medidor = document.createElement('canvas').getContext('2d');
  function anchoTexto(t, pt, bold) { medidor.font = `${bold ? 'bold ' : ''}${pt}px Arial, Helvetica, sans-serif`; return medidor.measureText(t).width * 25.4 / 72; }
  function recortar(t, pt, bold, max) {
    if (anchoTexto(t, pt, bold) <= max) return t;
    let s = t;
    while (s.length > 1 && anchoTexto(s + '…', pt, bold) > max) s = s.slice(0, -1);
    return s + '…';
  }

  /* Arma la lista de elementos de una etiqueta (en mm, origen arriba a la izquierda) */
  function dibujoEtiqueta(v, m, x0, y0, w, h, cfg) {
    const out = [];
    const k = Math.min(h / 37, w / 70 * 1.25);
    const pad = Math.max(1.6, 2.4 * k);
    const cw = w - pad * 2;
    if (cfg.bordes) out.push({ t: 'borde', x: x0 + 0.3, y: y0 + 0.3, w: w - 0.6, h: h - 0.6 });
    // Fila superior: logo + textos
    const topH = h * 0.44;
    let tx = x0 + pad;
    if (cfg.logo) {
      const ls = Math.min(topH - pad * 0.4, cw * 0.32);
      out.push({ t: 'logo', x: x0 + pad, y: y0 + pad * 0.8, s: ls });
      tx += ls + pad * 0.8;
    }
    const tw = x0 + w - pad - tx;
    const ptTitulo = Math.max(5, 7.2 * k);
    const ptTalle = Math.max(7, 13 * k);
    let ty = y0 + pad * 0.8 + ptTitulo * 0.3528;
    const linea1 = cfg.nombre ? `${m.nombre} · ${v.color}` : v.color;
    out.push({ t: 'texto', x: tx, y: ty, pt: ptTitulo, bold: false, s: recortar(linea1, ptTitulo, false, tw) });
    ty += ptTalle * 0.3528 + 1.2 * k;
    out.push({ t: 'texto', x: tx, y: ty, pt: ptTalle, bold: true, s: `TALLE ${v.talle}` });
    if (cfg.precio) {
      const ptPrecio = Math.max(6, 9.5 * k);
      const p = money(m.precio);
      out.push({ t: 'texto', x: x0 + w - pad - anchoTexto(p, ptPrecio, true), y: ty, pt: ptPrecio, bold: true, s: p });
    }
    // Código de barras a todo el ancho
    const ptCod = Math.max(4.5, 6.2 * k);
    const by = y0 + topH + pad * 0.3;
    const bh = y0 + h - pad * 0.6 - ptCod * 0.3528 - 0.8 - by;
    const b = barras(v.codigo);
    const quiet = 2;   // zona libre a cada lado (mm) para que el lector lo tome bien
    const mod = (cw - quiet * 2) / b.total;
    out.push({ t: 'barras', x: x0 + pad + quiet, y: by, h: Math.max(4, bh), mod, bars: b.bars });
    out.push({ t: 'texto', x: x0 + w / 2 - anchoTexto(v.codigo, ptCod, false) / 2, y: y0 + h - pad * 0.6, pt: ptCod, bold: false, s: v.codigo });
    return out;
  }

  /* Reparte las etiquetas en páginas A4 */
  function paginar(lista, m, cfg) {
    const H = HOJAS[cfg.hoja];
    const porHoja = H.cols * H.rows;
    const pages = [];
    const offset = clamp((Number(cfg.desde) || 1) - 1, 0, porHoja - 1);
    lista.forEach((v, i) => {
      const n = i + offset;
      const p = Math.floor(n / porHoja), pos = n % porHoja;
      const c = pos % H.cols, r = Math.floor(pos / H.cols);
      const x = H.left + c * (H.w + H.gapX) + Number(cfg.ajusteX || 0);
      const y = H.top + r * (H.h + H.gapY) + Number(cfg.ajusteY || 0);
      (pages[p] = pages[p] || []).push(...dibujoEtiqueta(v, m, x, y, H.w, H.h, { ...cfg, bordes: cfg.bordes || H.bordes }));
    });
    return pages;
  }

  /* Vista previa de una página en canvas */
  function pintarPagina(canvas, items, logo) {
    const W = canvas.width, s = W / A4.w;
    const c = canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#000';
    c.strokeStyle = '#000';
    items.forEach((it) => {
      if (it.t === 'borde') { c.save(); c.setLineDash([3, 3]); c.strokeStyle = '#999'; c.lineWidth = 1; c.strokeRect(it.x * s, it.y * s, it.w * s, it.h * s); c.restore(); }
      if (it.t === 'logo' && logo) c.drawImage(logo.img, it.x * s, it.y * s, it.s * s, it.s * s);
      if (it.t === 'texto') { c.font = `${it.bold ? 'bold ' : ''}${it.pt * 25.4 / 72 * s}px Arial, Helvetica, sans-serif`; c.fillText(it.s, it.x * s, it.y * s); }
      if (it.t === 'barras') it.bars.forEach((b) => c.fillRect((it.x + b.x * it.mod) * s, it.y * s, Math.max(0.6, b.w * it.mod * s), it.h * s));
    });
  }

  /* PDF A4 vectorial (Helvetica + logo JPEG) */
  function pdfEtiquetas(pages, logo) {
    const pt = (mm) => (mm * 72 / 25.4).toFixed(2);
    const Y = (mm) => ((A4.h - mm) * 72 / 25.4).toFixed(2);
    const enc = (s) => {
      let o = '';
      for (const ch of s) {
        const code = ch === '…' ? 0x85 : ch.charCodeAt(0);
        if (ch === '(' || ch === ')' || ch === '\\') o += '\\' + ch;
        else if (code < 32 || code > 126) o += '\\' + (code > 255 ? 63 : code).toString(8).padStart(3, '0');
        else o += ch;
      }
      return o;
    };
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const fontR = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontB = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgId = logo ? add({ img: logo }) : 0;
    const pagesId = add(null);
    const kids = [];
    pages.forEach((items) => {
      let s = '0 g\n';
      items.forEach((it) => {
        if (it.t === 'borde') s += `q 0.6 G 0.4 w [2 2] 0 d ${pt(it.x)} ${Y(it.y + it.h)} ${pt(it.w)} ${pt(it.h)} re S Q\n`;
        if (it.t === 'logo' && logo) s += `q ${pt(it.s)} 0 0 ${pt(it.s)} ${pt(it.x)} ${Y(it.y + it.s)} cm /Logo Do Q\n`;
        if (it.t === 'texto') s += `BT /${it.bold ? 'F2' : 'F1'} ${it.pt.toFixed(2)} Tf ${pt(it.x)} ${Y(it.y)} Td (${enc(it.s)}) Tj ET\n`;
        if (it.t === 'barras') it.bars.forEach((b) => { s += `${pt(it.x + b.x * it.mod)} ${Y(it.y + it.h)} ${pt(b.w * it.mod)} ${pt(it.h)} re f\n`; });
      });
      const content = add({ stream: s });
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >>${logo ? ` /XObject << /Logo ${imgId} 0 R >>` : ''} >> /Contents ${content} 0 R >>`));
    });
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    // Armado binario
    const te = new TextEncoder();
    const parts = [];
    let len = 0;
    const push = (u8) => { parts.push(u8); len += u8.length; };
    const pushS = (str) => { const u = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 255; push(u); };
    pushS('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(len);
      pushS(`${i + 1} 0 obj\n`);
      if (o && o.img) {
        pushS(`<< /Type /XObject /Subtype /Image /Width ${o.img.size} /Height ${o.img.size} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${o.img.jpeg.length} >>\nstream\n`);
        push(o.img.jpeg);
        pushS('\nendstream');
      } else if (o && o.stream !== undefined) {
        const body = te.encode(o.stream);
        pushS(`<< /Length ${body.length} >>\nstream\n`);
        push(body);
        pushS('\nendstream');
      } else {
        pushS(o);
      }
      pushS('\nendobj\n');
    });
    const xref = len;
    pushS(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  async function renderEtiquetas(el) {
    const modelos = Store.data.modelos;
    if (!lbl.modelo || !modeloDe(lbl.modelo)) { lbl.modelo = modelos[0] && modelos[0].id; lbl.colores = null; lbl.talles = null; }
    const m = modeloDe(lbl.modelo);
    if (!m) { el.innerHTML = head('Códigos de barra', 'Primero creá un modelo.'); return; }
    if (!lbl.colores) lbl.colores = m.colores.map((c) => c.nombre);
    if (!lbl.talles) lbl.talles = m.talles.slice();
    if (!HOJAS[lbl.hoja]) lbl.hoja = 'a4-24';
    // Orden: por color y talle, como en el catálogo
    const vars = Store.data.variantes
      .filter((v) => v.modelo_id === m.id && lbl.colores.includes(v.color) && lbl.talles.includes(v.talle))
      .sort((a, b) => m.colores.findIndex((c) => c.nombre === a.color) - m.colores.findIndex((c) => c.nombre === b.color) || m.talles.indexOf(a.talle) - m.talles.indexOf(b.talle));
    const lista = [];
    vars.forEach((v) => { const n = lbl.porStock ? Math.max(0, v.stock) : lbl.copias; for (let i = 0; i < n; i++) lista.push(v); });
    const H = HOJAS[lbl.hoja];
    const porHoja = H.cols * H.rows;

    el.innerHTML = head('Códigos de barra', 'Armá tus etiquetas en hoja A4, mirá cómo quedan y descargá el PDF para imprimir. Después escaneá cada bolsa para cargar el stock.',
      '<button type="button" class="panel-btn" data-act="scan">▦ Escanear</button>') + `
      <div class="lbl-layout">
        <div class="lbl-controls">
          <section class="box"><h2>Qué etiquetas</h2>
            <div class="form-grid">
              <label class="field"><span class="field-label">Modelo</span><select id="lb-mod">${modelos.map((x) => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></label>
              <label class="field"><span class="field-label">Copias de cada una</span><input type="number" id="lb-cop" min="1" max="50" value="${lbl.copias}" ${lbl.porStock ? 'disabled' : ''}></label>
              <div class="field full"><span class="field-label">Colores</span><div class="chip-list" id="lb-col">${m.colores.map((c) => `<button type="button" aria-pressed="${lbl.colores.includes(c.nombre)}" data-c="${esc(c.nombre)}"><span class="color-name"><i style="background:${c.hex}"></i>${esc(c.nombre)}</span></button>`).join('')}</div></div>
              <div class="field full"><span class="field-label">Talles</span><div class="chip-list" id="lb-tal">${m.talles.map((t) => `<button type="button" aria-pressed="${lbl.talles.includes(t)}" data-t="${esc(t)}">T${esc(t)}</button>`).join('')}</div></div>
              <label class="check full"><input type="checkbox" id="lb-stock" ${lbl.porStock ? 'checked' : ''}> Una etiqueta por cada remera en stock</label>
            </div>
          </section>
          <section class="box"><h2>Hoja y diseño</h2>
            <div class="form-grid">
              <label class="field full"><span class="field-label">Tipo de hoja A4</span><select id="lb-hoja">${Object.entries(HOJAS).map(([k, h]) => `<option value="${k}" ${k === lbl.hoja ? 'selected' : ''}>${h.label}</option>`).join('')}</select></label>
              <label class="check"><input type="checkbox" id="lb-logo" ${lbl.logo ? 'checked' : ''}> Logo</label>
              <label class="check"><input type="checkbox" id="lb-nombre" ${lbl.nombre ? 'checked' : ''}> Nombre del modelo</label>
              <label class="check"><input type="checkbox" id="lb-precio" ${lbl.precio ? 'checked' : ''}> Precio</label>
              <label class="check"><input type="checkbox" id="lb-bordes" ${lbl.bordes || H.bordes ? 'checked' : ''} ${H.bordes ? 'disabled' : ''}> Líneas de corte</label>
              <label class="field"><span class="field-label">Empezar en la etiqueta N°</span><input type="number" id="lb-desde" min="1" max="${porHoja}" value="${lbl.desde}"></label>
            </div>
            <details style="margin-top:8px"><summary><b>Ajuste fino de la impresora</b></summary>
              <div class="form-grid" style="margin-top:8px">
                <label class="field"><span class="field-label">Mover a la derecha (mm)</span><input type="number" id="lb-ax" step="0.5" value="${lbl.ajusteX}"></label>
                <label class="field"><span class="field-label">Mover hacia abajo (mm)</span><input type="number" id="lb-ay" step="0.5" value="${lbl.ajusteY}"></label>
              </div>
              <p class="field-help">Imprimí una hoja de prueba en papel común, ponela sobre la hoja de etiquetas a contraluz y corregí acá si quedó corrida. Usá números negativos para mover a la izquierda o hacia arriba.</p>
            </details>
            <p class="field-help">«Empezar en la etiqueta N°» sirve para aprovechar una hoja que ya usaste en parte.</p>
          </section>
        </div>
        <section class="box lbl-preview">
          <div class="lbl-preview-head">
            <h2>${lista.length} ${lista.length === 1 ? 'etiqueta' : 'etiquetas'} · <span id="lb-npag"></span></h2>
            <div class="lbl-pager"><button type="button" class="icon-btn" id="lb-prev" aria-label="Página anterior">‹</button><span id="lb-pag"></span><button type="button" class="icon-btn" id="lb-next" aria-label="Página siguiente">›</button></div>
          </div>
          <canvas id="lb-canvas" class="lbl-page" width="840" height="1188" role="img" aria-label="Vista previa de la hoja de etiquetas"></canvas>
          <div class="row-actions" style="justify-content:stretch">
            <button type="button" class="download" id="lb-pdf" ${lista.length ? '' : 'disabled'}>↓ Descargar PDF para imprimir</button>
          </div>
          <p class="field-help">Al imprimir elegí <b>tamaño real / 100 %</b> (no «ajustar a la página»). En el celular podés abrir el PDF y mandarlo a la impresora desde Compartir → Imprimir.</p>
        </section>
      </div>`;

    try { await loadScript('../vendor/jsbarcode.min.js'); } catch (e) { $('#lb-npag', el).textContent = 'no se pudo cargar el generador de códigos'; return; }
    const logo = lbl.logo ? await cargarLogo() : null;
    const pages = lista.length ? paginar(lista, m, lbl) : [];
    lbl.pagina = clamp(lbl.pagina || 0, 0, Math.max(0, pages.length - 1));
    const cv = $('#lb-canvas', el);
    const pintar = () => {
      $('#lb-npag', el).textContent = `${pages.length || 0} ${pages.length === 1 ? 'hoja' : 'hojas'}`;
      $('#lb-pag', el).textContent = pages.length ? `Hoja ${lbl.pagina + 1} de ${pages.length}` : '';
      $('#lb-prev', el).disabled = lbl.pagina <= 0;
      $('#lb-next', el).disabled = lbl.pagina >= pages.length - 1;
      const ctx = cv.getContext('2d');
      if (!pages.length) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.fillStyle = '#888'; ctx.font = '24px Arial'; ctx.textAlign = 'center'; ctx.fillText('Elegí al menos un color y un talle', cv.width / 2, cv.height / 2); ctx.textAlign = 'start'; return; }
      pintarPagina(cv, pages[lbl.pagina], logo);
      // Contorno suave de las etiquetas de la hoja (solo en pantalla)
      const s = cv.width / A4.w;
      ctx.save(); ctx.strokeStyle = 'rgba(13,79,163,.18)'; ctx.lineWidth = 1;
      for (let r = 0; r < H.rows; r++) for (let c = 0; c < H.cols; c++) ctx.strokeRect((H.left + c * (H.w + H.gapX) + Number(lbl.ajusteX)) * s, (H.top + r * (H.h + H.gapY) + Number(lbl.ajusteY)) * s, H.w * s, H.h * s);
      ctx.restore();
    };
    pintar();

    const re = () => { guardarLbl(); renderEtiquetas(el); };
    $('#lb-prev', el).addEventListener('click', () => { lbl.pagina--; pintar(); });
    $('#lb-next', el).addEventListener('click', () => { lbl.pagina++; pintar(); });
    $('#lb-mod', el).addEventListener('change', (e) => { lbl.modelo = e.target.value; lbl.colores = null; lbl.talles = null; re(); });
    $('#lb-cop', el).addEventListener('change', (e) => { lbl.copias = clamp(Math.round(Number(e.target.value) || 1), 1, 50); re(); });
    $('#lb-stock', el).addEventListener('change', (e) => { lbl.porStock = e.target.checked; re(); });
    $('#lb-hoja', el).addEventListener('change', (e) => { lbl.hoja = e.target.value; lbl.desde = 1; lbl.pagina = 0; re(); });
    [['#lb-logo', 'logo'], ['#lb-nombre', 'nombre'], ['#lb-precio', 'precio'], ['#lb-bordes', 'bordes']].forEach(([sel, k]) => $(sel, el).addEventListener('change', (e) => { lbl[k] = e.target.checked; re(); }));
    $('#lb-desde', el).addEventListener('change', (e) => { lbl.desde = clamp(Math.round(Number(e.target.value) || 1), 1, porHoja); re(); });
    $('#lb-ax', el).addEventListener('change', (e) => { lbl.ajusteX = clamp(Number(e.target.value) || 0, -15, 15); re(); });
    $('#lb-ay', el).addEventListener('change', (e) => { lbl.ajusteY = clamp(Number(e.target.value) || 0, -15, 15); re(); });
    $$('#lb-col button', el).forEach((b) => b.addEventListener('click', () => { const c = b.dataset.c; lbl.colores = lbl.colores.includes(c) ? lbl.colores.filter((x) => x !== c) : [...lbl.colores, c]; lbl.pagina = 0; re(); }));
    $$('#lb-tal button', el).forEach((b) => b.addEventListener('click', () => { const t = b.dataset.t; lbl.talles = lbl.talles.includes(t) ? lbl.talles.filter((x) => x !== t) : [...lbl.talles, t]; lbl.pagina = 0; re(); }));
    el.querySelector('[data-act="scan"]').addEventListener('click', openScanner);
    $('#lb-pdf', el).addEventListener('click', () => {
      const blob = pdfEtiquetas(pages, logo);
      downloadBlob(blob, `etiquetas-${m.sigla || 'remeras'}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast('PDF listo. Imprimilo al 100 % en hoja A4.');
    });
  }

  /* =========================================================
     9. COTIZADOR DTF
     ========================================================= */
  const quote = { modelo_id: null, prendas: 1, base: null, diseno: false, estampas: [{ zona: 'Pecho', ancho: 10, alto: 10, cantidad: 1 }] };
  const PRESETS = [['Logo pecho', 9, 9, 'Pecho'], ['Pecho 10×10', 10, 10, 'Pecho'], ['A4', 21, 29.7, 'Frente completo'], ['Espalda 28×35', 28, 35, 'Espalda'], ['A3', 29.7, 42, 'Espalda'], ['Manga 8×8', 8, 8, 'Manga']];

  function calcular(cfg, q) {
    const m = modeloDe(q.modelo_id);
    const costoCm2 = cfg.metro / (cfg.ancho * 100) * (1 + cfg.merma / 100);
    const precioCm2 = costoCm2 * (1 + cfg.ganancia / 100);
    const base = q.base ?? (m ? m.precio : 0);
    const est = q.estampas.map((e) => {
      const area = (Number(e.ancho) || 0) * (Number(e.alto) || 0);
      const unit = area > 0 ? roundUp(area * precioCm2 + cfg.fijo, cfg.redondeo) : 0;
      return { ...e, area, unit, costo: area * costoCm2 };
    });
    const estPorPrenda = est.reduce((a, e) => a + e.unit * (Number(e.cantidad) || 1), 0);
    const porPrenda = base + estPorPrenda;
    const diseno = q.diseno ? cfg.diseno : 0;
    const prendas = Math.max(1, Number(q.prendas) || 1);
    const total = porPrenda * prendas + diseno;
    const costoRemeras = (m ? m.costo : 0) * prendas;
    const costoDtf = est.reduce((a, e) => a + e.costo * (Number(e.cantidad) || 1), 0) * prendas;
    return { costoCm2, precioCm2, base, est, estPorPrenda, porPrenda, diseno, prendas, total, costoRemeras, costoDtf, ganancia: total - costoRemeras - costoDtf };
  }

  let cfgTimer = 0;
  function renderCotizador(el) {
    const cfg = cotizador();
    if (!quote.modelo_id || !modeloDe(quote.modelo_id)) quote.modelo_id = (Store.data.modelos[0] || {}).id;
    el.innerHTML = head('Cotizador DTF', 'Precio de la remera + cada estampa según sus centímetros cuadrados. Ajustá tus costos abajo y se recalcula solo.') + `
      <div class="quote">
        <div style="display:grid;gap:14px">
          <details class="box" id="q-cfg" open><summary><b>Precios de las estampas: tus costos y ganancia</b></summary>
            <p class="field-help" style="margin-top:6px">Estos valores los usa también la tienda online. Los cambios se guardan solos.</p>
            <div class="form-grid" style="margin-top:10px">
              <label class="field"><span class="field-label">Precio del metro de DTF ($)</span><input type="number" data-c="metro" min="0" step="100" value="${cfg.metro}"></label>
              <label class="field"><span class="field-label">Ancho del rollo (cm)</span><input type="number" data-c="ancho" min="10" step="1" value="${cfg.ancho}"></label>
              <label class="field"><span class="field-label">Merma por separaciones (%)</span><input type="number" data-c="merma" min="0" max="100" value="${cfg.merma}"></label>
              <label class="field"><span class="field-label">Ganancia sobre el DTF (%)</span><input type="number" data-c="ganancia" min="0" max="2000" value="${cfg.ganancia}"></label>
              <label class="field"><span class="field-label">Fijo por estampa ($)</span><input type="number" data-c="fijo" min="0" step="100" value="${cfg.fijo}"></label>
              <label class="field"><span class="field-label">Armado del diseño ($)</span><input type="number" data-c="diseno" min="0" step="100" value="${cfg.diseno}"></label>
              <label class="field"><span class="field-label">Redondear a ($)</span><select data-c="redondeo">${[1, 100, 500, 1000].map((r) => `<option value="${r}" ${r === cfg.redondeo ? 'selected' : ''}>${r === 1 ? 'Sin redondeo' : money(r)}</option>`).join('')}</select></label>
            </div>
            <p class="field-help">El fijo por estampa cubre el planchado y tu tiempo. La merma cubre los espacios entre estampas en el film.</p>
            <h3 style="margin:14px 0 6px;font-size:15px">Así quedan tus estampas</h3>
            <div class="table-wrap"><table class="tbl" id="q-tabla"></table></div>
          </details>
          <details class="box" id="q-dtf"><summary><b>DTF a la venta</b> · página «Imprimí tu DTF»</summary>
            <p class="field-help" style="margin-top:6px">Cómo se vende el DTF solo en la tienda. Si cambiás de impresora, cambiá el ancho acá y listo.</p>
            <div class="form-grid" style="margin-top:8px">
              <label class="field full"><span class="field-label">Cómo se cobra</span><select data-cs="dtfModo"><option value="metro" ${cfg.dtfModo !== 'sueltas' ? 'selected' : ''}>Por metro de lienzo</option><option value="sueltas" ${cfg.dtfModo === 'sueltas' ? 'selected' : ''}>Por estampa suelta (según su tamaño)</option></select></label>
              <label class="field"><span class="field-label">Ancho del lienzo (cm)</span><input type="number" data-c="dtfAncho" min="10" max="200" step="0.5" value="${cfg.dtfAncho}"></label>
              ${cfg.dtfModo === 'sueltas' ? `
              <label class="field"><span class="field-label">Fijo por estampa suelta ($)</span><input type="number" data-c="dtfFijo" min="0" step="100" value="${cfg.dtfFijo}"></label>
              <label class="field"><span class="field-label">Pedido mínimo ($, 0 = sin mínimo)</span><input type="number" data-c="dtfMinimo" min="0" step="500" value="${cfg.dtfMinimo}"></label>` : `
              <label class="field"><span class="field-label">Largo mínimo (cm)</span><input type="number" data-c="dtfMin" min="10" step="10" value="${cfg.dtfMin}"></label>
              <label class="field"><span class="field-label">Aumenta de a (cm)</span><input type="number" data-c="dtfPaso" min="1" step="5" value="${cfg.dtfPaso}"></label>
              <label class="field"><span class="field-label">Precio de venta del metro ($)</span><input type="number" data-c="dtfMetro" min="0" step="500" value="${cfg.dtfMetro || ''}" placeholder="${money(Math.ceil(cfg.metro * (1 + cfg.ganancia / 100) / 500) * 500)} (automático)"></label>`}
            </div>
            <p class="field-help" id="q-dtf-ej"></p>
          </details>
          <section class="box"><h2>Prendas</h2>
            <div class="form-grid">
              <label class="field"><span class="field-label">Modelo</span><select id="q-mod">${Store.data.modelos.map((m) => `<option value="${m.id}" ${m.id === quote.modelo_id ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select></label>
              <label class="field"><span class="field-label">Cantidad de prendas</span><input type="number" id="q-pr" min="1" value="${quote.prendas}" inputmode="numeric"></label>
              <label class="field"><span class="field-label">Precio de la remera ($)</span><input type="number" id="q-base" min="0" step="100" value="${quote.base ?? (modeloDe(quote.modelo_id) || {}).precio ?? 0}"></label>
              <label class="check"><input type="checkbox" id="q-dis" ${quote.diseno ? 'checked' : ''}> Cobrar el armado del diseño (${money(cfg.diseno)})</label>
            </div>
          </section>
          <section class="box"><h2>Estampas por prenda</h2>
            <div class="chip-list" id="q-presets">${PRESETS.map(([n], i) => `<button type="button" data-i="${i}">＋ ${n}</button>`).join('')}</div>
            <div id="q-est"></div>
            <button type="button" class="panel-btn" id="q-add">＋ Estampa a medida</button>
          </section>
        </div>
        <aside class="box quote-total" aria-live="polite" id="q-out"></aside>
      </div>`;

    const drawEst = () => {
      const r = calcular(cotizador(), quote);
      $('#q-est', el).innerHTML = quote.estampas.map((e, i) => `<div class="stamp-row" data-i="${i}">
        <label>Zona<select data-k="zona">${ZONAS.map((z) => `<option ${z === e.zona ? 'selected' : ''}>${z}</option>`).join('')}</select></label>
        <label>Ancho cm<input type="number" data-k="ancho" min="0" step="0.1" value="${e.ancho}" inputmode="decimal"></label>
        <label>Alto cm<input type="number" data-k="alto" min="0" step="0.1" value="${e.alto}" inputmode="decimal"></label>
        <label>Por prenda<input type="number" data-k="cantidad" min="1" value="${e.cantidad}" inputmode="numeric"></label>
        <button type="button" class="icon-btn danger" aria-label="Quitar estampa">✕</button>
        <small class="field-help" style="grid-column:1/-1;margin:0">${num(r.est[i].area, 1)} cm² → <b>${money(r.est[i].unit)}</b> cada una</small></div>`).join('') || '<p class="field-help">Sin estampas: solo la remera lisa.</p>';
      $$('.stamp-row', el).forEach((row) => {
        const i = Number(row.dataset.i);
        $$('[data-k]', row).forEach((inp) => inp.addEventListener('change', () => { quote.estampas[i][inp.dataset.k] = inp.dataset.k === 'zona' ? inp.value : Number(inp.value); drawEst(); }));
        row.querySelector('button').addEventListener('click', () => { quote.estampas.splice(i, 1); drawEst(); });
      });
      drawOut();
    };
    // Tabla de referencia: costo, precio y ganancia por tamaño de estampa
    const drawTabla = () => {
      const c = cotizador();
      const costoCm2 = c.metro / (c.ancho * 100) * (1 + c.merma / 100);
      const precioCm2 = costoCm2 * (1 + c.ganancia / 100);
      const filas = [['Logo pecho', 9, 9], ['Chica', 15, 15], ['Mediana', 20, 20], ['Grande', 28, 28], ['Máxima espalda', 30, 40]];
      $('#q-tabla', el).innerHTML = `<thead><tr><th>Estampa</th><th class="num">Te cuesta</th><th class="num">Cobrás</th><th class="num">Ganás</th></tr></thead><tbody>${filas.map(([n, w, h]) => {
        const costo = w * h * costoCm2;
        const precio = roundUp(w * h * precioCm2 + c.fijo, c.redondeo);
        return `<tr><td>${n} <small style="color:var(--muted)">${w}×${h} cm</small></td><td class="num">${money(costo)}</td><td class="num"><b>${money(precio)}</b></td><td class="num">${money(precio - costo)}</td></tr>`;
      }).join('')}</tbody>`;
    };
    const drawDtf = () => {
      const c = cotizador();
      const ej = $('#q-dtf-ej', el);
      if (!ej) return;
      if (c.dtfModo === 'sueltas') {
        const cm2 = c.metro / (c.ancho * 100) * (1 + c.merma / 100) * (1 + c.ganancia / 100);
        const pr = (w, h) => roundUp(w * h * cm2 + (Number(c.dtfFijo) || 0), c.redondeo);
        ej.innerHTML = `Ejemplos: logo 9×9 cm <b>${money(pr(9, 9))}</b> · 20×20 cm <b>${money(pr(20, 20))}</b> · ${Math.min(28, c.dtfAncho - 1)}×28 cm <b>${money(pr(Math.min(28, c.dtfAncho - 1), 28))}</b>. Usa el mismo precio por cm² del cotizador.`;
      } else {
        const pm = Number(c.dtfMetro) || Math.ceil(c.metro * (1 + c.ganancia / 100) / 500) * 500;
        const costo = c.metro * (Number(c.dtfAncho) || 59) / (Number(c.ancho) || 60);
        ej.innerHTML = `Ejemplos: ${(c.dtfMin / 100).toLocaleString('es-AR')} m <b>${money(pm * c.dtfMin / 100)}</b> · ${((c.dtfMin + c.dtfPaso) / 100).toLocaleString('es-AR')} m <b>${money(pm * (c.dtfMin + c.dtfPaso) / 100)}</b>. Cada metro te cuesta ${money(costo)} y ganás ${money(pm - costo)}.`;
      }
    };
    const drawOut = () => {
      drawTabla();
      drawDtf();
      const r = calcular(cotizador(), quote);
      $('#q-out', el).innerHTML = `<small class="eyebrow" style="display:block">Total a cobrar</small><span class="big">${money(r.total)}</span>
        <dl class="breakdown">
          <div><dt>Por prenda</dt><dd>${money(r.porPrenda)}</dd></div>
          <div><dt>Remera${r.prendas > 1 ? `s (${r.prendas} × ${money(r.base)})` : ''}</dt><dd>${money(r.base * r.prendas)}</dd></div>
          <div><dt>Estampas</dt><dd>${money(r.estPorPrenda * r.prendas)}</dd></div>
          ${r.diseno ? `<div><dt>Armado del diseño</dt><dd>${money(r.diseno)}</dd></div>` : ''}
          <hr>
          <div><dt>Costo remeras</dt><dd>− ${money(r.costoRemeras)}</dd></div>
          <div><dt>Costo DTF</dt><dd>− ${money(r.costoDtf)}</dd></div>
          <div class="profit"><dt><b>Tu ganancia</b></dt><dd>${money(r.ganancia)}</dd></div>
        </dl>
        <p class="field-help">DTF: te cuesta ${money(r.costoCm2 * 100)} cada 100 cm² (${num(r.costoCm2)} $/cm²) y lo cobrás ${num(r.precioCm2)} $/cm² + ${money(cotizador().fijo)} por estampa.</p>
        <div class="row-actions" style="justify-content:stretch"><button type="button" class="panel-btn" id="q-wa">Copiar para WhatsApp</button><button type="button" class="download" id="q-ped">Crear pedido</button></div>`;
      $('#q-wa', el).addEventListener('click', async () => {
        const m = modeloDe(quote.modelo_id);
        const lines = [`*Presupuesto Tu Estampa SF*`, `${r.prendas} × ${m ? m.nombre : 'Remera'} — ${money(r.base)} c/u`];
        r.est.forEach((e) => lines.push(`• Estampa ${e.zona.toLowerCase()} ${num(e.ancho, 1)}×${num(e.alto, 1)} cm${e.cantidad > 1 ? ` (×${e.cantidad})` : ''}: ${money(e.unit)}`));
        if (r.diseno) lines.push(`• Armado del diseño: ${money(r.diseno)}`);
        lines.push(`Por prenda: ${money(r.porPrenda)}`, `*Total: ${money(r.total)}*`);
        const text = lines.join('\n');
        try { await navigator.clipboard.writeText(text); toast('Presupuesto copiado. Pegalo en WhatsApp.'); }
        catch (e) { openModal('Presupuesto', `<textarea style="width:100%;min-height:200px" readonly>${esc(text)}</textarea>`, (b) => b.querySelector('textarea').select()); }
      });
      $('#q-ped', el).addEventListener('click', () => pedidoForm({ modelo_id: quote.modelo_id, cantidad: r.prendas, estampas: quote.estampas.map((e) => ({ ...e })), total: r.total, notas: r.diseno ? 'Incluye armado del diseño.' : '' }));
    };

    $('#q-mod', el).addEventListener('change', (e) => { quote.modelo_id = e.target.value; quote.base = null; refresh(); });
    $('#q-pr', el).addEventListener('input', (e) => { quote.prendas = Math.max(1, Number(e.target.value) || 1); drawOut(); });
    $('#q-base', el).addEventListener('input', (e) => { quote.base = Number(e.target.value) || 0; drawOut(); });
    $('#q-dis', el).addEventListener('change', (e) => { quote.diseno = e.target.checked; drawOut(); });
    $('#q-add', el).addEventListener('click', () => { quote.estampas.push({ zona: 'Otra', ancho: 10, alto: 10, cantidad: 1 }); drawEst(); });
    $$('#q-presets button', el).forEach((b) => b.addEventListener('click', () => {
      const [, w, h, z] = PRESETS[Number(b.dataset.i)];
      quote.estampas.push({ zona: z, ancho: w, alto: h, cantidad: 1 });
      drawEst();
    }));
    $$('[data-cs]', el).forEach((sel) => sel.addEventListener('change', async () => {
      const c = cotizador();
      c[sel.dataset.cs] = sel.value;
      Store.data.config.cotizador = c;
      await Store.setConfig('cotizador', c);
      const abierto = $('#q-dtf', el).open;
      refresh();
      if (abierto) $('#q-dtf').open = true;
    }));
    $$('[data-c]', el).forEach((inp) => inp.addEventListener('input', () => {
      const c = cotizador();
      c[inp.dataset.c] = Number(inp.value) || 0;
      Store.data.config.cotizador = c;
      drawEst();
      clearTimeout(cfgTimer);
      cfgTimer = setTimeout(() => Store.setConfig('cotizador', c), 800);
    }));
    drawEst();
  }

  /* =========================================================
     10. MODELOS Y PRECIOS
     ========================================================= */
  function renderModelos(el) {
    el.innerHTML = head('Modelos y precios', 'Cada modelo tiene sus colores, talles, costo y precio. Al agregar colores o talles se crean solos los códigos de barra nuevos.',
      '<button type="button" class="panel-btn primary" data-act="new">＋ Nuevo modelo</button>') + `
      <div class="grid-2">${Store.data.modelos.map((m) => {
        const margen = m.costo ? Math.round((m.precio - m.costo) / m.costo * 100) : 0;
        const stock = Store.data.variantes.filter((v) => v.modelo_id === m.id).reduce((a, v) => a + v.stock, 0);
        return `<section class="box"><h2>${esc(m.nombre)} <small class="field-help">· sigla ${esc(m.sigla)}</small></h2>
          <dl class="breakdown">
            <div><dt>Costo</dt><dd>${money(m.costo)}</dd></div>
            <div><dt>Precio base (sin estampa)</dt><dd>${money(m.precio)}</dd></div>
            <div class="profit"><dt>Ganancia por remera</dt><dd>${money(m.precio - m.costo)} (${margen} %)</dd></div>
            <div><dt>En stock</dt><dd>${stock} u.</dd></div>
          </dl>
          <p class="chip-list" style="margin:10px 0">${m.colores.map((c) => `<span class="color-name" style="font-size:12px"><i style="background:${c.hex}"></i>${esc(c.nombre)}</span>`).join(' ')}</p>
          <p class="field-help">Talles: ${m.talles.map(esc).join(', ')}</p>
          <div class="row-actions"><button type="button" class="panel-btn" data-edit="${m.id}">Editar</button></div>
        </section>`;
      }).join('')}</div>`;
    el.querySelector('[data-act="new"]').addEventListener('click', () => modeloForm());
    $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => modeloForm(b.dataset.edit)));
  }

  function modeloForm(id) {
    const m0 = id ? modeloDe(id) : null;
    const colores = m0 ? m0.colores.map((c) => ({ ...c })) : COLORES_INICIALES.slice(0, 2).map((c) => ({ ...c }));
    openModal(m0 ? `Editar ${m0.nombre}` : 'Nuevo modelo', `
      <div class="form-grid">
        <label class="field"><span class="field-label">Nombre</span><input type="text" id="mf-nom" maxlength="40" value="${esc(m0 ? m0.nombre : 'Remera oversize')}"></label>
        <label class="field"><span class="field-label">Sigla para el código (1 a 3 letras)</span><input type="text" id="mf-sig" maxlength="3" value="${esc(m0 ? m0.sigla : 'O')}" ${m0 ? 'disabled' : ''}></label>
        <label class="field"><span class="field-label">Costo ($)</span><input type="number" id="mf-cos" min="0" step="100" value="${m0 ? m0.costo : 9000}"></label>
        <label class="field"><span class="field-label">Precio base de venta ($)</span><input type="number" id="mf-pre" min="0" step="100" value="${m0 ? m0.precio : 20000}"></label>
        <label class="field full"><span class="field-label">Talles (separados por coma)</span><input type="text" id="mf-tal" value="${esc((m0 ? m0.talles : TALLES_INICIALES).join(', '))}"></label>
        <div class="field full"><span class="field-label">Colores</span><div id="mf-col"></div><button type="button" class="panel-btn" id="mf-add">＋ Agregar color</button></div>
      </div>
      <p class="field-help">Si quitás un color o talle que todavía tiene stock, se conserva para no perder unidades.</p>
      <div class="row-actions"><button type="button" class="panel-btn" data-close>Cancelar</button><button type="button" class="download" id="mf-ok">Guardar</button></div>`, (body) => {
      const box = $('#mf-col', body);
      const draw = () => {
        box.innerHTML = colores.map((c, i) => `<div class="stamp-row" data-i="${i}" style="grid-template-columns:44px minmax(0,1.6fr) minmax(0,1fr) 34px">
          <label>Color<input type="color" data-k="hex" value="${c.hex}" style="padding:2px;height:38px"></label>
          <label>Nombre<input type="text" data-k="nombre" maxlength="24" value="${esc(c.nombre)}"></label>
          <label>Sigla<input type="text" data-k="sigla" maxlength="3" value="${esc(c.sigla)}"></label>
          <button type="button" class="icon-btn danger" aria-label="Quitar color">✕</button></div>`).join('');
        $$('.stamp-row', box).forEach((r) => {
          const i = Number(r.dataset.i);
          $$('[data-k]', r).forEach((inp) => inp.addEventListener('input', () => { colores[i][inp.dataset.k] = inp.dataset.k === 'sigla' ? inp.value.toUpperCase() : inp.value; }));
          r.querySelector('button').addEventListener('click', () => { colores.splice(i, 1); draw(); });
        });
      };
      draw();
      $('#mf-add', body).addEventListener('click', () => { colores.push({ nombre: 'Nuevo color', sigla: 'NUE', hex: '#888888' }); draw(); });
      $('#mf-ok', body).addEventListener('click', async () => {
        const nombre = $('#mf-nom', body).value.trim();
        const sigla = (m0 ? m0.sigla : $('#mf-sig', body).value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''));
        const talles = $('#mf-tal', body).value.split(',').map((t) => t.trim()).filter(Boolean);
        const cols = colores.filter((c) => c.nombre.trim()).map((c) => ({ nombre: c.nombre.trim(), sigla: (c.sigla || c.nombre.slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3), hex: c.hex }));
        if (!nombre || !sigla || !talles.length || !cols.length) { toast('Completá nombre, sigla, talles y al menos un color.', true); return; }
        if (!m0 && Store.data.modelos.some((x) => x.sigla === sigla)) { toast('Esa sigla ya la usa otro modelo.', true); return; }
        const m = m0 ? { ...m0, nombre, talles, colores: cols, costo: Number($('#mf-cos', body).value) || 0, precio: Number($('#mf-pre', body).value) || 0 }
          : nuevoModelo(nombre, sigla, Number($('#mf-cos', body).value) || 0, Number($('#mf-pre', body).value) || 0, cols, talles);
        await Store.save('modelos', m);
        const nuevas = variantesDe(m, Store.data.variantes);
        await Store.saveMany('variantes', nuevas);
        // Combinaciones quitadas: se borran solo si no tienen stock
        const sobran = Store.data.variantes.filter((v) => v.modelo_id === m.id && (!m.colores.some((c) => c.nombre === v.color) || !m.talles.includes(v.talle)) && v.stock === 0);
        for (const v of sobran) await Store.remove('variantes', v.id);
        closeModal();
        toast(`Guardado. ${nuevas.length ? `Se crearon ${nuevas.length} códigos nuevos.` : ''}`);
        refresh();
      });
    });
  }

  /* =========================================================
     11. EDITOR DE IMÁGENES (las 10 herramientas, embebidas)
     ========================================================= */
  let pendingMsg = null;   // mensaje para las herramientas (imagen o lienzo de un pedido)
  function renderEditor(el) {
    el.innerHTML = '<iframe class="editor-frame" id="editor-frame" src="../herramientas.html?embed=1" title="Herramientas de edición de imágenes" allow="clipboard-write"></iframe>';
    const fr = $('#editor-frame', el);
    fr.addEventListener('load', () => {
      if (pendingMsg) { fr.contentWindow.postMessage(pendingMsg, '*'); pendingMsg = null; }
    });
  }
  function enviarAlEditor(msg) {
    if (current === 'editar' && $('#editor-frame')) {
      $('#editor-frame').contentWindow.postMessage(msg, '*');
    } else {
      pendingMsg = msg;
      location.hash = 'editar';
    }
  }
  function openInEditor(blob, name) { enviarAlEditor({ type: 'te-load-image', blob, name }); }
  /* Pedido de DTF: abre «Armar lienzo» con cada diseño en su lugar */
  async function abrirLienzoPedido(p) {
    const it = (p.items || []).find((x) => x.tipo === 'dtf');
    if (!it) return;
    toast('Preparando el lienzo…');
    const files = [];
    for (const pz of it.piezas) {
      const im = (p.imagenes || []).find((x) => x.name === pz.archivo);
      const blob = im ? await Store.imageBlob(im.ref).catch(() => null) : null;
      files.push(blob ? { blob, name: pz.nombre || pz.archivo } : null);
    }
    if (files.some((f) => !f)) { toast('Falta alguna imagen del pedido: no se pudo armar el lienzo.', true); return; }
    enviarAlEditor({ type: 'te-load-sheet', files, sheet: { widthCm: it.ancho, heightCm: it.largo, gapMm: 5, items: it.layout } });
  }

  /* =========================================================
     12. AJUSTES
     ========================================================= */
  function renderAjustes(el) {
    const c = Store.conn() || {};
    const cloud = Store.mode === 'cloud';
    const tienda = Store.data.config.tienda || {};
    el.innerHTML = head('Ajustes', '') + `
      <div class="grid-2">
        <section class="box"><h2>☁ Conexión a la nube (Supabase)</h2>
          <p>${cloud ? `✓ Conectado como <b>${esc(Store.user && Store.user.email)}</b>. Los datos se ven igual en el celular y en la PC.` : 'Ahora estás en <b>modo local</b>: los datos quedan solo en este navegador.'}</p>
          <label class="field"><span class="field-label">URL del proyecto</span><input type="url" id="aj-url" placeholder="https://xxxx.supabase.co" value="${esc(c.url || '')}"></label>
          <label class="field"><span class="field-label">Clave pública (anon key)</span><input type="text" id="aj-key" placeholder="eyJhbGciOi…" value="${esc(c.key || '')}"></label>
          <div class="row-actions">
            ${c.url ? '<button type="button" class="panel-btn" id="aj-off">Desconectar</button>' : ''}
            <button type="button" class="download" id="aj-save">Guardar y conectar</button>
          </div>
          <details style="margin-top:12px"><summary><b>Cómo crear tu base gratis (5 minutos)</b></summary>
            <ol class="order-items">
              <li>Entrá a <b>supabase.com</b> y creá una cuenta gratis (no pide tarjeta).</li>
              <li>Tocá <b>New project</b>, poné un nombre (ej. <i>tuestampa</i>), una contraseña y la región <b>São Paulo</b>.</li>
              <li>Abrí <b>SQL Editor</b>, pegá el contenido del archivo <b>supabase/schema.sql</b> (viene en el zip) y tocá <b>Run</b>.</li>
              <li>En <b>Authentication → Users → Add user</b> creá tu usuario con tu email y una contraseña.</li>
              <li>En <b>Project Settings → API</b> copiá la <b>Project URL</b> y la clave <b>anon public</b>, y pegalas acá arriba.</li>
            </ol>
          </details>
          ${cloud && localStorage.getItem(LS_DATA) ? '<button type="button" class="panel-btn" id="aj-up">⇪ Subir a la nube los datos que cargué en modo local</button>' : ''}
        </section>
        <section class="box"><h2>💾 Copia de seguridad</h2>
          <p>Descargá todos tus datos (modelos, stock, movimientos, pedidos y cotizador) en un archivo. Las imágenes de los pedidos no se incluyen.</p>
          <div class="row-actions" style="justify-content:flex-start">
            <button type="button" class="panel-btn" id="aj-exp">↓ Descargar copia</button>
            <label class="panel-btn" style="cursor:pointer">⇪ Restaurar copia<input type="file" id="aj-imp" accept="application/json" hidden></label>
          </div>
          <h2 style="margin-top:18px">🧹 Empezar de cero</h2>
          <p>Borra <b>todos los pedidos</b> (con sus imágenes), el historial de movimientos y deja <b>el stock de todo en 0</b>. Los modelos, códigos de barra, precios y ajustes quedan igual. Antes de borrar se descarga una copia por las dudas.</p>
          <div class="row-actions" style="justify-content:flex-start"><button type="button" class="panel-btn" id="aj-reset" style="color:#b3261e;border-color:#b3261e">🧹 Borrar pedidos y poner el stock en 0</button></div>
          <h2 style="margin-top:18px">🌐 Accesos</h2>
          <p><a href="../herramientas.html" target="_blank" rel="noopener">Abrir las herramientas en otra pestaña</a></p>
          <p><a href="../index.html" target="_blank" rel="noopener">Abrir la tienda para clientes</a></p>
        </section>
        <section class="box"><h2>🛍 Tienda para clientes</h2>
          <p>La tienda usa estos datos y los precios del cotizador. Los pedidos llegan a <b>Pedidos</b> con la imagen y la medida exacta.</p>
          <label class="field"><span class="field-label">WhatsApp del negocio</span><input type="tel" id="aj-wa" placeholder="Ej.: 342 4123456" value="${esc(tienda.whatsapp || '')}"></label>
          <p class="field-help">Al terminar el pedido, el cliente te avisa por este WhatsApp con un mensaje ya escrito.</p>
          <div class="grid-2" style="gap:10px">
            <label class="field"><span class="field-label">Alias para la seña</span><input type="text" id="aj-alias" placeholder="Ej.: tuestampasf" value="${esc(tienda.alias ?? 'tuestampasf')}"></label>
            <label class="field"><span class="field-label">Seña ($)</span><input type="number" id="aj-sena" min="0" step="500" value="${esc(tienda.sena ?? 10000)}"></label>
          </div>
          <label class="check" style="margin-top:8px"><input type="checkbox" id="aj-mp" ${tienda.mp ? 'checked' : ''}> Cobrar también con <b>Mercado Pago</b></label>
          <label class="field" style="margin-top:6px"><span class="field-label">Costo de Mercado Pago que paga el cliente (%)</span><input type="number" id="aj-mp-rec" min="0" max="30" step="0.01" value="${esc(tienda.mpRecargo ?? 7.61)}"></label>
          <p class="field-help" id="aj-mp-ej"></p>
          <details style="margin:6px 0 10px"><summary><b>Cómo activar Mercado Pago</b></summary>
            <ol class="order-items">
              <li>En <b>mercadopago.com.ar/developers</b> → <b>Tus integraciones</b> → <b>Crear aplicación</b> (tipo «Pagos online», producto «Checkout Pro»).</li>
              <li>En la aplicación → <b>Credenciales de producción</b> → copiá el <b>Access Token</b> (empieza con <code>APP_USR-</code>).</li>
              <li>En Supabase → <b>Project Settings → API Keys</b> → copiá la clave <b>secret</b> (empieza con <code>sb_secret_</code>).</li>
              <li>En Cloudflare → <b>Workers y Pages → tuestampasf → Configuración → Variables y secretos</b> → <b>Agregar</b>, tipo <b>Secreto</b>:<br><code>MP_ACCESS_TOKEN</code> = el Access Token<br><code>SUPABASE_SECRET_KEY</code> = la clave secret de Supabase.</li>
              <li>Volvé acá, marcá «Cobrar también con Mercado Pago» y tocá <b>Guardar</b>.</li>
            </ol>
            <p class="field-help">Las claves quedan guardadas solo en Cloudflare: no las pegues en ningún otro lado ni las compartas.</p>
          </details>
          <p class="field-help">Los pedidos de la tienda quedan «Esperando seña» hasta que tocás «Seña recibida». Si no pagan en ${VENCE_DIAS} días se borran solos. Con seña en 0 no se pide seña.</p>
          <div class="row-actions" style="justify-content:flex-start">
            <button type="button" class="download" id="aj-wa-save">Guardar</button>
            <button type="button" class="panel-btn" id="aj-shop-copy">⧉ Copiar enlace de la tienda</button>
          </div>
        </section>
      </div>`;
    $('#aj-wa-save', el).addEventListener('click', async () => {
      await Store.setConfig('tienda', { ...tienda, whatsapp: $('#aj-wa', el).value.trim(), alias: $('#aj-alias', el).value.trim(), sena: Math.max(0, Number($('#aj-sena', el).value) || 0), mp: $('#aj-mp', el).checked, mpRecargo: Math.min(30, Math.max(0, Number($('#aj-mp-rec', el).value) || 0)) });
      toast('Datos de la tienda guardados.');
    });
    // Ejemplo en vivo del recargo de Mercado Pago
    const ejMP = () => {
      const pct = Math.min(30, Math.max(0, Number($('#aj-mp-rec', el).value) || 0));
      const base = Number($('#aj-sena', el).value) || 10000;
      const con = pct > 0 ? Math.ceil(base / (1 - pct / 100) / 10) * 10 : base;
      $('#aj-mp-ej', el).innerHTML = pct > 0
        ? `Con seña de ${money(base)}, por Mercado Pago el cliente paga <b>${money(con)}</b> y a vos te quedan unos ${money(con * (1 - pct / 100))}. Por transferencia paga ${money(base)}. Ejemplo: 6,29 % (al instante) + IVA = 7,61 %; a 35 días: 1,49 % + IVA = 1,8 %.`
        : 'Sin recargo: la comisión de Mercado Pago la pagás vos.';
    };
    $('#aj-mp-rec', el).addEventListener('input', ejMP);
    $('#aj-sena', el).addEventListener('input', ejMP);
    ejMP();
    $('#aj-shop-copy', el).addEventListener('click', async () => {
      const url = new URL('../index.html', location.href).href;
      try { await navigator.clipboard.writeText(url); toast('Enlace copiado: ' + url); } catch (e) { toast(url); }
    });
    $('#aj-save', el).addEventListener('click', async () => {
      const url = $('#aj-url', el).value.trim().replace(/\/$/, '');
      const key = $('#aj-key', el).value.trim();
      if (!/^https:\/\/.+/.test(url) || key.length < 20) { toast('Revisá la URL y la clave.', true); return; }
      try {
        const sb = window.supabase.createClient(url, key);
        const { error } = await sb.from('modelos').select('id').limit(1);
        if (error && !/permission|policy|JWT/i.test(error.message)) throw error;
      } catch (err) {
        toast('No pude conectar: ' + (err.message || err) + '. ¿Corriste el schema.sql?', true);
        return;
      }
      localStorage.setItem(LS_CONN, JSON.stringify({ url, key }));
      sessionStorage.removeItem('te_force_local');
      location.reload();
    });
    const off = $('#aj-off', el);
    if (off) off.addEventListener('click', async () => {
      if (Store.sb) await Store.sb.auth.signOut();
      localStorage.setItem(LS_CONN, JSON.stringify({ off: true }));
      location.reload();
    });
    const up = $('#aj-up', el);
    if (up) up.addEventListener('click', async () => {
      try {
        const local = JSON.parse(localStorage.getItem(LS_DATA));
        up.disabled = true;
        up.textContent = 'Subiendo…';
        for (const t of TABLES) await Store.saveMany(t, (local[t] || []).map((r) => { const x = { ...r }; if (t === 'pedidos') delete x.numero; return x; }));
        for (const [k, v] of Object.entries(local.config || {})) await Store.setConfig(k, v);
        localStorage.removeItem(LS_DATA);
        toast('Datos subidos a la nube.');
        refresh();
      } catch (err) { toast('No se pudo subir: ' + err.message, true); up.disabled = false; }
    });
    $('#aj-exp', el).addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ app: 'tuestampa-panel', version: 1, fecha: new Date().toISOString(), data: Store.data }, null, 1)], { type: 'application/json' });
      downloadBlob(blob, `copia-tuestampa-${new Date().toISOString().slice(0, 10)}.json`);
    });
    /* Empezar de cero: borra pedidos (e imágenes) y movimientos, y pone el stock en 0 */
    $('#aj-reset', el).addEventListener('click', async (e) => {
      const n = Store.data.pedidos.length;
      const r = prompt(`Se van a borrar ${n} pedido${n === 1 ? '' : 's'}, todo el historial de movimientos y el stock queda en 0.\nNo se puede deshacer.\n\nPara confirmar escribí BORRAR`);
      if ((r || '').trim().toUpperCase() !== 'BORRAR') { if (r !== null) toast('No se borró nada (había que escribir BORRAR).', true); return; }
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Borrando…';
      try {
        // Copia de seguridad automática antes de borrar
        const blob = new Blob([JSON.stringify({ app: 'tuestampa-panel', version: 1, fecha: new Date().toISOString(), data: Store.data }, null, 1)], { type: 'application/json' });
        downloadBlob(blob, `copia-antes-de-limpiar-${new Date().toISOString().slice(0, 10)}.json`);
        const ahora = new Date().toISOString();
        if (Store.mode === 'cloud') {
          const sb = Store.sb;
          // Imágenes: todo lo que haya en el bucket "pedidos" (carpetas incluidas)
          const rutas = [];
          const listar = async (carpeta, nivel) => {
            for (let off = 0; ; off += 1000) {
              const { data, error } = await sb.storage.from('pedidos').list(carpeta, { limit: 1000, offset: off });
              if (error || !data || !data.length) break;
              for (const it of data) {
                const ruta = carpeta ? `${carpeta}/${it.name}` : it.name;
                if (it.id) rutas.push(ruta); else if (nivel < 4) await listar(ruta, nivel + 1);
              }
              if (data.length < 1000) break;
            }
          };
          await listar('', 0);
          for (let i = 0; i < rutas.length; i += 100) await sb.storage.from('pedidos').remove(rutas.slice(i, i + 100));
          let res = await sb.from('pedidos').delete().neq('id', '');
          if (res.error) throw res.error;
          res = await sb.from('movimientos').delete().neq('id', '');
          if (res.error) throw res.error;
          res = await sb.from('variantes').update({ stock: 0, actualizado: ahora }).neq('id', '');
          if (res.error) throw res.error;
        } else {
          for (const p of Store.data.pedidos) for (const im of (p.imagenes || [])) { try { await Store.removeImage(im.ref || im); } catch (err) { /* sigue */ } }
        }
        Store.data.pedidos = [];
        Store.data.movimientos = [];
        Store.data.variantes.forEach((v) => { v.stock = 0; v.actualizado = ahora; });
        if (Store.mode !== 'cloud') Store.persistLocal();
        toast('Listo: pedidos borrados y stock en 0. ¡A arrancar!');
        refresh();
      } catch (err) {
        toast('No se pudo terminar de limpiar: ' + (err.message || err), true);
        btn.disabled = false; btn.textContent = '🧹 Borrar pedidos y poner el stock en 0';
      }
    });
    $('#aj-imp', el).addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        if (j.app !== 'tuestampa-panel') throw new Error('No es una copia del panel.');
        for (const t of TABLES) await Store.saveMany(t, j.data[t] || []);
        for (const [k, v] of Object.entries(j.data.config || {})) await Store.setConfig(k, v);
        toast('Copia restaurada.');
        refresh();
      } catch (err) { toast('No se pudo restaurar: ' + err.message, true); }
    });
  }

  /* =========================================================
     13. INICIO DE LA APP
     ========================================================= */
  function setSync() {
    const pill = $('#sync-pill');
    pill.classList.toggle('is-cloud', Store.mode === 'cloud');
    $('#sync-text').textContent = Store.mode === 'cloud' ? 'En la nube' : 'Modo local';
    pill.title = Store.mode === 'cloud' ? 'Datos sincronizados con Supabase' : 'Datos guardados solo en este dispositivo';
    $('#mode-tip-title').textContent = Store.mode === 'cloud' ? 'Conectado a la nube' : 'Modo local';
    $('#mode-tip-text').textContent = Store.mode === 'cloud' ? 'Tus datos se guardan en Supabase y se ven en todos tus dispositivos.' : 'Los datos quedan en este dispositivo. Conectá Supabase en Ajustes para usarlos desde el celular y la PC.';
    $('#logout-btn').hidden = Store.mode !== 'cloud';
  }

  async function start() {
    let res;
    try {
      res = await Store.init();
    } catch (err) {
      console.error(err);
      $('#sync-pill').classList.add('is-error');
      $('#sync-text').textContent = 'Sin conexión';
      toast('No se pudo conectar con la nube. Abrí en modo local o revisá Ajustes.', true);
      sessionStorage.setItem('te_force_local', '1');
      res = await Store.init();
    }
    if (res === 'login') { showLogin(); return; }
    $('#login').hidden = true;
    setSync();
    try { await limpiarSinSena(); } catch (e) { console.warn(e); }
    go((location.hash || '#inicio').slice(1));
  }

  function showLogin() {
    $('#login').hidden = false;
    $('#login-email').focus();
  }

  function init() {
    $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    document.addEventListener('click', (e) => { const b = e.target.closest('#modal-body [data-close]'); if (b) closeModal(); });
    $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
    window.addEventListener('hashchange', () => go(location.hash.slice(1)));
    initScanner();
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#login-error');
      err.textContent = '';
      const { error } = await Store.sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pass').value });
      if (error) { err.textContent = 'Email o contraseña incorrectos.'; return; }
      start();
    });
    $('#login-local').addEventListener('click', () => { sessionStorage.setItem('te_force_local', '1'); start(); });
    $('#logout-btn').addEventListener('click', async () => { if (Store.sb) await Store.sb.auth.signOut(); location.reload(); });
    // Animación del header (mismas chispas que las herramientas)
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
    start();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
