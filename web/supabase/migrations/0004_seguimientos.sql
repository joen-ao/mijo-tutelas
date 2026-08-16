-- 0004 · Seguimiento de lo radicado
-- Aplicar: Supabase Dashboard → SQL Editor → pegar todo → Run.
--
-- El juez falla en 10 días hábiles (art. 29 del Decreto 2591 de 1991). Y si
-- concede la tutela pero la EPS no cumple, existe el INCIDENTE DE DESACATO
-- (art. 52), que es donde la mayoría de la gente se queda varada: gana y no
-- sabe que ganar no basta.
--
-- Por eso esto es una tabla y no un campo más del caso: el seguimiento tiene su
-- propio ciclo de vida (vence, se avisa, se responde) y hay que poder buscarlo
-- por fecha sin recorrer todos los casos.
--
-- Va aparte de `casos` también porque el mismo teléfono puede tener varios
-- documentos radicados en momentos distintos.

create table if not exists seguimientos (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz default now(),
  caso_id            uuid,
  -- El teléfono en formato de Twilio ("whatsapp:+57..."), que es como se
  -- escribe de vuelta sin tener que reconstruirlo.
  telefono           text not null,
  -- "tutela" | "peticion": el término y el mensaje cambian según cuál sea.
  tipo               text default 'tutela',
  ciudad             text,
  accionado          text,
  fecha_radicacion   timestamptz,
  -- Cuándo toca escribirle. Se calcula en días HÁBILES al radicar.
  fecha_seguimiento  timestamptz,
  -- pendiente | avisado | respondido | cerrado
  estado             text default 'pendiente',
  -- Qué contestó la persona cuando le escribimos. Sirve para el eval y para
  -- saber cuántas tutelas se cumplen de verdad, que es el dato que nadie tiene.
  respuesta          text,
  avisado_at         timestamptz
);

create index if not exists idx_seg_vencidos on seguimientos(estado, fecha_seguimiento);
create index if not exists idx_seg_telefono on seguimientos(telefono);

alter table seguimientos disable row level security;

grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
