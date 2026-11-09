-- Regie · volledige app (deel 1/2): enumwaarden toevoegen.
-- Apart bestand, omdat nieuwe enumwaarden pas na commit bruikbaar zijn.

alter type public.shoot_status add value if not exists 'optie';
alter type public.shoot_status add value if not exists 'bevestigd';
alter type public.shoot_status add value if not exists 'verplaatst';

create type public.number_status as enum
  ('gereserveerd','pitch','offerte','losse_klus','project','verloren','geannuleerd','vervallen');
create type public.project_phase as enum
  ('pre_productie','productie','post_productie','afronding','operationeel_klaar','administratief_klaar');
create type public.milestone_kind as enum
  ('offerte_akkoord','debriefing','gefactureerd','betaling_ontvangen','freelancers_betaald');
create type public.decision_kind as enum
  ('goedkeuring_versie','scopewijziging','meerwerk','afspraak','overig');
