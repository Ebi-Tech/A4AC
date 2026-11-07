-- =============================================================================
-- Seed data for local development
--
-- Languages: eng and fra are anchors; kin, swh, ibo, yor, hau are open.
-- Sentences: 10 short everyday English test sentences (markets, weather,
-- family, transport), written for this project and released as CC0-1.0.
-- Safe to run more than once.
-- =============================================================================

insert into public.languages (iso_code, name, native_name, is_anchor, status, has_standard_orthography) values
  ('eng', 'English',     'English',      true,  'open', true),
  ('fra', 'French',      'Français',     true,  'open', true),
  ('kin', 'Kinyarwanda', 'Ikinyarwanda', false, 'open', true),
  ('swh', 'Swahili',     'Kiswahili',    false, 'open', true),
  ('ibo', 'Igbo',        'Asụsụ Igbo',   false, 'open', true),
  ('yor', 'Yoruba',      'Èdè Yorùbá',   false, 'open', true),
  ('hau', 'Hausa',       'Harshen Hausa', false, 'open', true)
on conflict (iso_code) do nothing;

update public.languages set special_characters = case iso_code
  when 'yor' then array['ẹ','ọ','ṣ','á','à','é','è','í','ì','ó','ò','ú','ù','ń','ẹ́','ẹ̀','ọ́','ọ̀','Ẹ','Ọ','Ṣ']
  when 'ibo' then array['ị','ọ','ụ','ṅ','á','à','é','è','í','ì','ó','ò','ú','ù','Ị','Ọ','Ụ','Ṅ']
  when 'hau' then array['ɓ','ɗ','ƙ','ƴ','ʼ','Ɓ','Ɗ','Ƙ','Ƴ']
end
where iso_code in ('yor', 'ibo', 'hau') and special_characters = '{}';

insert into public.sentences (anchor_language_id, text, source, source_license, difficulty)
select l.id, s.text, 'project-seed', 'CC0-1.0', s.difficulty
from public.languages l
cross join (values
  ('How much are these tomatoes?', 1),
  ('The market opens early on Saturday.', 1),
  ('It is going to rain this afternoon.', 1),
  ('The sun is very hot today.', 1),
  ('My sister has two young children.', 1),
  ('We visit our grandmother every Sunday.', 2),
  ('Where does this bus stop?', 1),
  ('The taxi driver took a different road.', 2),
  ('Please wait for me at the station.', 1),
  ('Can I pay for the bread tomorrow?', 2)
) as s(text, difficulty)
where l.iso_code = 'eng'
on conflict do nothing;
