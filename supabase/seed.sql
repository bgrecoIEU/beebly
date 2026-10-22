-- Beebly seed: 5 fictional events. Safe to re-run (it also refreshes the dates).
-- Run AFTER schema.sql. Supabase -> SQL Editor -> New query -> paste -> Run.

insert into public.events (id, name, venue_type, starts_at, face_value, sold_out)
values
  ('00000000-0000-4000-8000-000000000001', 'Welcome Party',        'Event hall',     now() + interval '30 days', 15.00, false),
  ('00000000-0000-4000-8000-000000000002', 'Spring Rooftop Night', 'Rooftop',        now() + interval '45 days', 20.00, false),
  ('00000000-0000-4000-8000-000000000003', 'Sunset Sessions',      'Outdoor terrace', now() + interval '60 days', 30.00, false),
  ('00000000-0000-4000-8000-000000000004', 'Winter Gala (sold out)', 'Ballroom',     now() + interval '75 days', 25.00, true),
  ('00000000-0000-4000-8000-000000000005', 'Autumn Kickoff (past)', 'Club night',    now() - interval '3 days',  18.00, false)
on conflict (id) do update
set name = excluded.name,
    venue_type = excluded.venue_type,
    starts_at = excluded.starts_at,
    face_value = excluded.face_value,
    sold_out = excluded.sold_out;
