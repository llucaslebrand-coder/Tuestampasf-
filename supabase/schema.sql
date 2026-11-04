-- =============================================================
-- Tu Estampa SF · Base de datos (Supabase)
-- Pegá todo este archivo en Supabase → SQL Editor → "Run".
-- Es seguro correrlo más de una vez.
-- =============================================================

-- ---------- Modelos de remera (unisex, oversize, etc.) ----------
create table if not exists modelos (
  id          text primary key,
  nombre      text not null,
  sigla       text not null,              -- se usa en el código de barras (ej. U)
  costo       numeric not null default 0, -- lo que te cuesta la remera lisa
  precio      numeric not null default 0, -- precio base de venta (sin estampas)
  colores     jsonb not null default '[]',-- [{ "nombre": "Blanca", "sigla": "BLA", "hex": "#f4f2ee" }]
  talles      jsonb not null default '[]',-- ["1","2",...]
  activo      boolean not null default true,
  creado      timestamptz not null default now()
);

-- ---------- Stock por modelo, color y talle ----------
create table if not exists variantes (
  id          text primary key,
  modelo_id   text not null references modelos(id) on delete cascade,
  color       text not null,
  talle       text not null,
  codigo      text not null unique,       -- código de barras
  stock       integer not null default 0,
  minimo      integer not null default 2,
  actualizado timestamptz not null default now()
);
create index if not exists variantes_modelo_idx on variantes(modelo_id);

-- ---------- Movimientos de stock (historial) ----------
create table if not exists movimientos (
  id          text primary key,
  fecha       timestamptz not null default now(),
  variante_id text references variantes(id) on delete set null,
  cantidad    integer not null,           -- + ingreso / − salida
  motivo      text not null,              -- ingreso, venta, ajuste, pedido
  detalle     text
);
create index if not exists movimientos_fecha_idx on movimientos(fecha desc);

-- ---------- Pedidos (del panel y, más adelante, de la tienda) ----------
create table if not exists pedidos (
  id          text primary key,
  numero      serial,
  fecha       timestamptz not null default now(),
  origen      text not null default 'panel',   -- panel / tienda
  cliente     text not null,
  telefono    text,
  items       jsonb not null default '[]',     -- remeras, estampas, medidas
  total       numeric not null default 0,
  estado      text not null default 'nuevo',   -- sena (esperando seña), nuevo, confirmado, produccion, listo, entregado, cancelado
  imagenes    jsonb not null default '[]',     -- rutas en el bucket "pedidos"
  notas       text,
  stock_descontado boolean not null default false
);
create index if not exists pedidos_fecha_idx on pedidos(fecha desc);
-- Seña para confirmar los pedidos de la tienda
alter table pedidos add column if not exists sena numeric not null default 0;
alter table pedidos add column if not exists sena_pagada boolean not null default false;
create index if not exists pedidos_tel_idx on pedidos(telefono, fecha desc);
-- Seguimiento y resultados: fechas de cada paso, día de cierre y costo guardado al entregar
alter table pedidos add column if not exists historial jsonb not null default '[]';
alter table pedidos add column if not exists cerrado timestamptz;
alter table pedidos add column if not exists costo jsonb;
create index if not exists pedidos_cerrado_idx on pedidos(cerrado desc);
-- Pago online (Mercado Pago): lo completa solo el servidor cuando el pago se aprueba
alter table pedidos add column if not exists pago jsonb;

-- ---------- Configuración (cotizador, etc.) ----------
create table if not exists config (
  clave       text primary key,
  valor       jsonb not null
);

-- =============================================================
-- SEGURIDAD (Row Level Security)
-- Solo vos (usuario con sesión iniciada) ves y modificás todo.
-- La tienda pública solo puede CREAR pedidos y leer modelos.
-- =============================================================
alter table modelos     enable row level security;
alter table variantes   enable row level security;
alter table movimientos enable row level security;
alter table pedidos     enable row level security;
alter table config      enable row level security;

do $$ begin
  -- Panel: acceso completo con sesión iniciada
  create policy "panel_modelos"     on modelos     for all to authenticated using (true) with check (true);
  create policy "panel_variantes"   on variantes   for all to authenticated using (true) with check (true);
  create policy "panel_movimientos" on movimientos for all to authenticated using (true) with check (true);
  create policy "panel_pedidos"     on pedidos     for all to authenticated using (true) with check (true);
  create policy "panel_config"      on config      for all to authenticated using (true) with check (true);
  -- Tienda pública: ver modelos activos y enviar pedidos
  create policy "tienda_ver_modelos"  on modelos for select to anon using (activo);
  -- Tienda pública: leer el cotizador (precios) y los datos del negocio
  create policy "tienda_ver_config" on config for select to anon using (clave in ('cotizador', 'tienda'));
exception when duplicate_object then null; end $$;

-- Si ya habías corrido una versión anterior, esto actualiza la regla de la tienda
drop policy if exists "tienda_crear_pedido" on pedidos;
create policy "tienda_crear_pedido" on pedidos for insert to anon
  with check (origen = 'tienda' and estado = 'sena' and sena_pagada = false and stock_descontado = false);

-- =============================================================
-- FILTRO CONTRA PEDIDOS FALSOS O AUTOMÁTICOS
-- Se controla en la base, así nadie lo puede saltear desde el navegador:
--  · máximo 3 pedidos por hora desde el mismo WhatsApp
--  · máximo 30 pedidos por hora en total desde la tienda
--  · datos con formato razonable (nombre, WhatsApp argentino, total, imágenes)
-- =============================================================
create or replace function controlar_pedido_tienda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.origen <> 'tienda' or coalesce(auth.role(), '') = 'authenticated' then
    return new;
  end if;
  new.fecha := now();
  new.estado := 'sena';
  new.sena_pagada := false;
  new.stock_descontado := false;
  new.historial := jsonb_build_array(jsonb_build_object('estado', 'sena', 'fecha', now()));
  new.cerrado := null;
  new.costo := null;
  new.pago := null;
  if length(trim(coalesce(new.cliente, ''))) < 2 or length(new.cliente) > 80 then
    raise exception 'Nombre inválido';
  end if;
  if coalesce(new.telefono, '') !~ '^[1-9][0-9]{9}$' then
    raise exception 'WhatsApp inválido';
  end if;
  if new.total <= 0 or new.total > 5000000 then
    raise exception 'Total inválido';
  end if;
  -- Hasta 40 archivos: los pedidos de DTF traen cada diseño por separado
  if jsonb_array_length(coalesce(new.imagenes, '[]'::jsonb)) > 40 or length(coalesce(new.notas, '')) > 600 then
    raise exception 'Pedido demasiado grande';
  end if;
  if (select count(*) from pedidos where origen = 'tienda' and telefono = new.telefono and fecha > now() - interval '1 hour') >= 3 then
    raise exception 'Demasiados pedidos desde este WhatsApp: límite por hora';
  end if;
  if (select count(*) from pedidos where origen = 'tienda' and fecha > now() - interval '1 hour') >= 30 then
    raise exception 'Demasiados pedidos: límite por hora';
  end if;
  return new;
end $$;
drop trigger if exists pedidos_tienda_control on pedidos;
create trigger pedidos_tienda_control before insert on pedidos
  for each row execute function controlar_pedido_tienda();

-- La tienda solo puede subir imágenes a un pedido recién creado (últimos 30 minutos)
create or replace function pedido_tienda_reciente(pid text) returns boolean
language sql security definer set search_path = public as $$
  select exists (select 1 from pedidos where id = pid and origen = 'tienda' and estado = 'sena' and fecha > now() - interval '30 minutes')
$$;
grant execute on function pedido_tienda_reciente(text) to anon;

-- =============================================================
-- IMÁGENES DE LOS PEDIDOS (Storage)
-- Bucket privado "pedidos": la tienda puede subir, solo vos podés ver.
-- Acepta PNG y JPG de hasta 50 MB.
-- =============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pedidos', 'pedidos', false, 52428800, array['image/png', 'image/jpeg'])
on conflict (id) do update set file_size_limit = 52428800, allowed_mime_types = array['image/png', 'image/jpeg'];

-- El panel (con tu usuario) puede ver, bajar y borrar todas las imágenes
drop policy if exists "pedidos_panel_todo" on storage.objects;
create policy "pedidos_panel_todo" on storage.objects for all to authenticated
  using (bucket_id = 'pedidos') with check (bucket_id = 'pedidos');

-- Subida desde la tienda: solo dentro de tienda/<id del pedido>/ y si el pedido es recién creado
drop policy if exists "pedidos_subir_tienda" on storage.objects;
create policy "pedidos_subir_tienda" on storage.objects for insert to anon
  with check (
    bucket_id = 'pedidos'
    and (storage.foldername(name))[1] = 'tienda'
    and pedido_tienda_reciente((storage.foldername(name))[2])
  );

-- =============================================================
-- Función para la "visita diaria" que evita que el proyecto se pause.
-- =============================================================
create or replace function ping() returns text language sql security definer as $$ select 'ok'::text $$;
grant execute on function ping() to anon;
