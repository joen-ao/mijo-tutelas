-- 0001 · Esquema de Mijo
-- Aplicar: Supabase Dashboard → SQL Editor → pegar todo → Run.
--
-- Una sola tabla: `casos`. Un caso es una conversación de WhatsApp que va camino
-- de convertirse en una acción de tutela.
--
-- Lo que NO se guarda, a propósito: el PDF (vive en el bucket `documentos`), las
-- sentencias citadas (están en el corpus y se vuelven a verificar si hiciera
-- falta) y la sesión del webhook (vive en memoria del proceso).
--
-- Ley 1581 de 2012: aquí hay datos personales SENSIBLES —diagnósticos, cédula—
-- de personas enfermas. En producción esto exige RLS activo, cifrado en reposo,
-- política de retención y autorización expresa del titular. Para la demo el RLS
-- queda DESACTIVADO, y eso es una deuda consciente, no un descuido.

create table if not exists casos (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz default now(),
  canal          text,
  nombre         text,
  telefono       text,
  cedula         text,
  consentimiento boolean default false,

  -- Lo que la persona ha contado: campos extraídos + el relato crudo.
  respuestas     jsonb default '{}'::jsonb,

  -- Salida del motor de reglas de procedencia (lib/ml.ts).
  score          int,
  -- Fracción de requisitos de PROCEDENCIA cumplidos. NO es probabilidad de ganar.
  probabilidad   numeric,
  -- procedente | falta_informacion | no_es_via_de_tutela
  ruteo          text,
  -- radicar | no_procede | falta_informacion
  destino        text,
  -- Las reglas evaluadas con su fundamento normativo. Esto reemplaza a los
  -- valores SHAP del motor anterior: un juez puede discutir "falta identificar
  -- al accionado, art. 13 del Decreto 2591", pero no un peso de 0.37.
  reglas         jsonb default '[]'::jsonb,

  estado_flujo   text default 'nuevo'
);

create index if not exists idx_casos_telefono on casos(telefono);
create index if not exists idx_casos_created  on casos(created_at desc);

-- ------------------------------------------------------------- permisos demo
-- RLS off + grants para que la publishable key (rol anon) lea y escriba.
-- En PRODUCCIÓN: activar RLS y definir políticas (Ley 1581).
alter table casos disable row level security;

grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
