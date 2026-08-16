-- 0002 · Bucket público para audios TTS (voz del asesor por WhatsApp)
-- Aplicar: Supabase Dashboard → SQL Editor → pegar todo → Run.

-- Bucket público (lecturas públicas; Twilio descarga el MP3 desde aquí)
insert into storage.buckets (id, name, public)
values ('audios', 'audios', true)
on conflict (id) do nothing;

-- Permisos demo: anon (publishable key) puede subir y leer en 'audios'.
-- En producción: subir con secret key server-side y restringir estas políticas.
drop policy if exists "audios anon insert" on storage.objects;
drop policy if exists "audios anon select" on storage.objects;
drop policy if exists "audios anon update" on storage.objects;

create policy "audios anon insert" on storage.objects
  for insert to anon with check (bucket_id = 'audios');
create policy "audios anon select" on storage.objects
  for select to anon using (bucket_id = 'audios');
create policy "audios anon update" on storage.objects
  for update to anon using (bucket_id = 'audios');
