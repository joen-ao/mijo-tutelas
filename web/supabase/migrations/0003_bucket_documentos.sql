-- 0003 · Bucket público para las tutelas en PDF
-- Aplicar: Supabase Dashboard → SQL Editor → pegar todo → Run.
--
-- Por qué: para adjuntar el PDF, Twilio tiene que DESCARGARLO desde una URL
-- alcanzable. El respaldo local (/api/pdf/[id].pdf) sale por ngrok, que en plan
-- free es lento y se cae — justo con el archivo que ES el producto. Desde aquí
-- es una URL pública y estable. Mismo razonamiento que el bucket 'audios' (0002).

insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', true)
on conflict (id) do nothing;

-- Permisos demo: anon (publishable key) puede subir y leer en 'documentos'.
-- En producción: subir con secret key server-side y restringir estas políticas.
drop policy if exists "documentos anon insert" on storage.objects;
drop policy if exists "documentos anon select" on storage.objects;
drop policy if exists "documentos anon update" on storage.objects;

create policy "documentos anon insert" on storage.objects
  for insert to anon with check (bucket_id = 'documentos');
create policy "documentos anon select" on storage.objects
  for select to anon using (bucket_id = 'documentos');
create policy "documentos anon update" on storage.objects
  for update to anon using (bucket_id = 'documentos');
