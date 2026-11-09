-- Regie · volledige app (deel 2): nummerregister, uitgebreid model en rechtenmatrix (masterprompt §3–§5).
-- Uitbreidend: er worden geen gegevens verwijderd. Bestaande velden blijven bestaan.

-- ───────────────────────── Rollen volgens de rechtenmatrix ─────────────────────────
create function public.internal_roles() returns public.app_role[] language sql immutable as $$
  select '{eigenaar,admin,projectmanager,medewerker,stagiair}'::public.app_role[]
$$;

-- Alle interne rollen zien alle projecten (masterprompt §3). Freelancers en klanten: nooit via tabellen.
create or replace function public.can_view_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.my_role(public.project_ws(p_project)) = any(public.internal_roles()), false)
$$;

-- Bewerken: alle interne rollen, niet op gearchiveerde projecten (alleen-lezen).
create or replace function public.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.my_role(public.project_ws(p_project)) = any(public.internal_roles()), false)
     and not coalesce((select archived from project where id = p_project), true)
$$;

-- Beheren (fase corrigeren, verwijderen, archiveren, financiële mijlpalen): eigenaar, admin, PM.
create or replace function public.can_manage_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.my_role(public.project_ws(p_project)) in ('eigenaar','admin','projectmanager'), false)
$$;

-- Versie goedkeuren, nummer uitgeven, project aanmaken: ook medewerker, niet stagiair.
create function public.can_approve_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.my_role(public.project_ws(p_project)) in ('eigenaar','admin','projectmanager','medewerker'), false)
     and not coalesce((select archived from project where id = p_project), true)
$$;

create function public.has_finance(p_ws uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.my_role(p_ws) in ('eigenaar','admin','projectmanager'), false)
$$;

create function public.is_internal(p_ws uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.my_role(p_ws) = any(public.internal_roles()), false)
$$;

create function public.org_ws(p_org uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from workspace where organization_id = p_org order by created_at limit 1
$$;

create function public.user_for_person(p_person uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select pe.user_id from person pe where pe.id = p_person
$$;

-- ───────────────────────── Instellingen per organisatie ─────────────────────────
create table public.company_setting (
  organization_id uuid not null references public.organization(id),
  company public.bedrijf not null,
  prefix text not null check (prefix ~ '^[A-Z]{1,6}$'),
  digits int not null default 3 check (digits between 2 and 6),
  primary key (organization_id, company)
);

create table public.org_setting (
  organization_id uuid primary key references public.organization(id),
  stale_days int not null default 14 check (stale_days between 1 and 365),
  quiet_start time not null default '20:00',
  quiet_end time not null default '08:00'
);

-- ───────────────────────── Nummerregister (§5) ─────────────────────────
-- De bestaande tabel project_number wordt het register: een nummer kan nu bestaan zonder project.
alter table public.project_number alter column project_id drop not null;
alter table public.project_number
  add column company public.bedrijf,
  add column year int check (year between 1990 and 2100),
  add column seq int check (seq > 0),
  add column status public.number_status not null default 'project',
  add column status_reason text,
  add column name text,
  add column client_org_id uuid references public.client_org(id),
  add column note text,
  add column source text not null default 'handmatig' check (source in ('handmatig','import-asana','bruto')),
  add column nonstandard boolean not null default false,
  add column asana_url text,
  add column archive_link text,
  add column updated_at timestamptz not null default now(),
  add column revision int not null default 1;

alter table public.project_number add constraint number_vervallen_reden
  check (status <> 'vervallen' or length(btrim(coalesce(status_reason,''))) > 0);
alter table public.project_number add constraint number_project_status
  check (kind = 'alias' or (status = 'project') = (project_id is not null));
create unique index project_number_reeks on public.project_number(organization_id, company, year, seq)
  where seq is not null and kind = 'primair';
create index on public.project_number(organization_id, year, company);

create trigger bump before update on public.project_number for each row execute function public.tg_bump_revision();

-- Bestaande nummers aanvullen met bedrijf, jaar en (indien standaardformaat) volgnummer.
update public.project_number n set company = p.company, year = p.year, name = p.name, client_org_id = p.client_org_id
from public.project p where p.id = n.project_id and n.company is null;

insert into public.company_setting(organization_id, company, prefix, digits)
select o.id, c.company, c.prefix, 3 from public.organization o
cross join (values ('studio_brutaal'::public.bedrijf, 'SB'), ('moviemates'::public.bedrijf, 'MMS')) as c(company, prefix)
on conflict do nothing;
insert into public.org_setting(organization_id) select id from public.organization on conflict do nothing;

-- Ontleed een code volgens het formaat van het bedrijf: PREFIX + JJ + volgnummer.
create function public.parse_number_code(p_org uuid, p_code text)
returns table(company public.bedrijf, year int, seq int, standard boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s company_setting%rowtype; v_code text := upper(regexp_replace(coalesce(p_code,''), '\s', '', 'g')); m text[];
begin
  for s in select * from company_setting where organization_id = p_org order by length(prefix) desc loop
    m := regexp_match(v_code, '^' || s.prefix || '(\d{2})(\d+)$');
    if m is not null then
      return query select s.company, 2000 + m[1]::int, m[2]::int, length(m[2]) = s.digits;
      return;
    end if;
  end loop;
  return query select null::public.bedrijf, null::int, null::int, false;
end $$;

update public.project_number n set seq = x.seq, nonstandard = not x.standard
from public.project_number n2 cross join lateral public.parse_number_code(n2.organization_id, n2.number_display) x
where n.id = n2.id and n.kind = 'primair' and x.company = n.company and x.year = n.year;
update public.project_number set nonstandard = true where seq is null and kind = 'primair';

create function public.format_number_code(p_org uuid, p_company public.bedrijf, p_year int, p_seq int) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select s.prefix || lpad((p_year % 100)::text, 2, '0') || lpad(p_seq::text, s.digits, '0')
  from company_setting s where s.organization_id = p_org and s.company = p_company
$$;

-- Registratie bij een project (fase-1-route): vult registervelden mee in.
create or replace function public.register_number_internal(p_project uuid, p_number text, p_kind public.number_kind, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p project%rowtype; v_org uuid; x record; v_holder text;
begin
  select * into p from project where id = p_project;
  v_org := ws_org(p.workspace_id);
  select * into x from parse_number_code(v_org, p_number);
  begin
    insert into project_number(organization_id, project_id, number_display, kind, reason, company, year, seq,
                               nonstandard, status, name, client_org_id)
    values (v_org, case when p_kind = 'primair' then p_project else p_project end, btrim(p_number), p_kind, p_reason, p.company,
            p.year, case when x.company = p.company and x.year = p.year then x.seq end,
            not (coalesce(x.standard, false) and x.company = p.company and x.year = p.year), 'project', p.name, p.client_org_id);
  exception when unique_violation then
    select coalesce(pr.name, n.name, 'zonder project') into v_holder from project_number n left join project pr on pr.id = n.project_id
      where n.organization_id = v_org and n.number_key = upper(regexp_replace(p_number, '\s', '', 'g'))
         or (n.organization_id = v_org and n.company = p.company and n.year = p.year and n.seq = x.seq and n.kind = 'primair')
      limit 1;
    raise exception 'Projectnummer % is al geregistreerd (%) en kan niet opnieuw worden gebruikt.', btrim(p_number), v_holder
      using errcode = '23505';
  end;
end $$;
revoke execute on function public.register_number_internal(uuid, text, public.number_kind, text) from public, anon, authenticated;

-- Idempotentie: een operatie-ID geeft bij herhaling hetzelfde resultaat terug.
create table public.operation (
  id uuid primary key,
  user_id uuid,
  kind text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
alter table public.operation enable row level security;

-- Volgende nummer en vrije nummers per bedrijf en jaar.
create function public.register_year_overview(p_ws uuid, p_company public.bedrijf, p_year int)
returns table(next_seq int, next_code text, free_seqs int[], used int, highest int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := ws_org(p_ws); v_max int;
begin
  perform require(is_internal(p_ws), 'Geen toegang.');
  select max(seq) into v_max from project_number
   where organization_id = v_org and company = p_company and year = p_year and kind = 'primair' and seq is not null;
  return query
  select coalesce(v_max, 0) + 1,
         format_number_code(v_org, p_company, p_year, coalesce(v_max, 0) + 1),
         coalesce((select array_agg(g order by g) from generate_series(1, coalesce(v_max, 0)) g
                   where not exists (select 1 from project_number n where n.organization_id = v_org and n.company = p_company
                                     and n.year = p_year and n.seq = g and n.kind = 'primair')), '{}'),
         (select count(*)::int from project_number where organization_id = v_org and company = p_company and year = p_year and kind = 'primair'),
         coalesce(v_max, 0);
end $$;

-- Nummer uitgeven: transactioneel (advisory lock per bedrijf+jaar), unieke index als vangnet, idempotent.
create function public.issue_number(
  p_ws uuid, p_company public.bedrijf, p_year int, p_status public.number_status default 'gereserveerd',
  p_name text default null, p_client_org_id uuid default null, p_client_name text default null, p_note text default null,
  p_seq int default null, p_code text default null, p_op uuid default null, p_source text default 'handmatig')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := ws_org(p_ws); v_seq int; v_code text; v_max int; v_id uuid; v_client uuid := p_client_org_id;
  v_gap boolean := false; v_nonstd boolean := false; x record; v_res jsonb; v_holder text;
begin
  -- Interne aanroep (API-sleutel of koppeling) zet regie.source; anders geldt de rol van de gebruiker.
  perform require(my_role(p_ws) in ('eigenaar','admin','projectmanager','medewerker')
                  or coalesce(current_setting('regie.source', true), '') in ('bruto','reviewtool','overig'),
                  'Je mag geen nummers uitgeven.');
  perform require(p_status in ('gereserveerd','pitch','offerte','losse_klus'), 'Een nieuw nummer start als gereserveerd, pitch, offerte of losse klus.');
  if p_op is not null then
    select result into v_res from operation where id = p_op;
    if found then return v_res; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext(v_org::text || p_company::text || p_year::text));
  select max(seq) into v_max from project_number
   where organization_id = v_org and company = p_company and year = p_year and kind = 'primair' and seq is not null;

  if nullif(btrim(p_code), '') is not null then
    v_code := upper(regexp_replace(p_code, '\s', '', 'g'));
    select * into x from parse_number_code(v_org, v_code);
    if x.company = p_company and x.year = p_year then v_seq := x.seq; v_nonstd := not x.standard;
    else v_seq := null; v_nonstd := true; end if;
  else
    v_seq := coalesce(p_seq, coalesce(v_max, 0) + 1);
    v_code := format_number_code(v_org, p_company, p_year, v_seq);
  end if;
  v_gap := v_seq is not null and v_seq > coalesce(v_max, 0) + 1;

  select coalesce(pr.name, n.name, 'zonder naam') || ' · ' || replace(n.status::text, '_', ' ') into v_holder
  from project_number n left join project pr on pr.id = n.project_id
  where n.organization_id = v_org and (n.number_key = v_code
        or (v_seq is not null and n.company = p_company and n.year = p_year and n.seq = v_seq and n.kind = 'primair'))
  limit 1;
  if v_holder is not null then
    raise exception 'Nummer % bestaat al (%). Een nummer wordt nooit hergebruikt.', v_code, v_holder using errcode = '23505';
  end if;

  if v_client is null and nullif(btrim(p_client_name), '') is not null then
    select id into v_client from client_org where organization_id = v_org and lower(name) = lower(btrim(p_client_name)) limit 1;
    if v_client is null then
      insert into client_org(organization_id, name) values (v_org, btrim(p_client_name)) returning id into v_client;
    end if;
  end if;

  insert into project_number(organization_id, number_display, kind, company, year, seq, status, name, client_org_id, note, source, nonstandard)
  values (v_org, v_code, 'primair', p_company, p_year, v_seq, p_status, nullif(btrim(p_name), ''), v_client, p_note, p_source, v_nonstd)
  returning id into v_id;

  v_res := jsonb_build_object('id', v_id, 'code', v_code, 'gap', v_gap, 'nonstandard', v_nonstd);
  if p_op is not null then insert into operation(id, user_id, kind, result) values (p_op, auth.uid(), 'issue_number', v_res); end if;
  return v_res;
end $$;

-- Status wijzigen. Verloren/geannuleerd/vervallen alleen eigenaar, admin, PM. 'project' alleen via projectkoppeling.
create function public.set_number_status(p_number uuid, p_status public.number_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n project_number%rowtype; v_ws uuid;
begin
  select * into n from project_number where id = p_number for update;
  perform require(n.id is not null and n.kind = 'primair', 'Onbekend nummer.');
  v_ws := org_ws(n.organization_id);
  perform require(p_status <> 'project', 'Een nummer wordt "project" door er een project aan te koppelen.');
  perform require(n.status <> 'project', 'Dit nummer hoort bij een project; wijzig de status via het project.');
  if p_status in ('verloren','geannuleerd','vervallen') then
    perform require(my_role(v_ws) in ('eigenaar','admin','projectmanager'), 'Alleen eigenaar, admin of projectmanager zet een nummer op verloren, geannuleerd of vervallen.');
  else
    perform require(my_role(v_ws) in ('eigenaar','admin','projectmanager','medewerker'), 'Je mag de nummerstatus niet wijzigen.');
  end if;
  perform require(p_status <> 'vervallen' or length(btrim(coalesce(p_reason,''))) > 0, 'Geef een reden waarom het nummer vervalt.');
  perform set_config('regie.reason', coalesce(p_reason, ''), true);
  update project_number set status = p_status, status_reason = nullif(btrim(p_reason), '') where id = p_number;
end $$;

create function public.update_number_info(p_number uuid, p_name text, p_client_org_id uuid, p_note text,
  p_archive_link text, p_asana_url text, p_revision int)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n project_number%rowtype; v_rev int;
begin
  select * into n from project_number where id = p_number for update;
  perform require(my_role(org_ws(n.organization_id)) in ('eigenaar','admin','projectmanager','medewerker'), 'Je mag dit nummer niet bewerken.');
  update project_number set name = nullif(btrim(p_name), ''), client_org_id = p_client_org_id, note = p_note,
    archive_link = nullif(btrim(p_archive_link), ''), asana_url = nullif(btrim(p_asana_url), '')
  where id = p_number and revision = p_revision returning revision into v_rev;
  return v_rev; -- null = conflict
end $$;

-- Import uit Asana: eerst voorbeeld met afwijkingen, daarna (p_commit) importeren. Nooit hernummeren.
create function public.import_numbers(p_ws uuid, p_rows jsonb, p_commit boolean default false)
returns table(line int, code text, company public.bedrijf, year int, status public.number_status, name text,
              client text, issues text[], action text)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_org uuid := ws_org(p_ws); r jsonb; i int := 0; x record; v_code text; v_issues text[]; v_status public.number_status;
  v_year int; v_company public.bedrijf; v_client uuid; v_seen text[] := '{}'; v_action text;
begin
  perform require(my_role(p_ws) in ('eigenaar','admin','projectmanager'), 'Alleen eigenaar, admin of projectmanager importeert.');
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_issues := '{}'; v_action := 'importeren';
    v_code := upper(regexp_replace(coalesce(r->>'code',''), '\s', '', 'g'));
    if v_code = '' then
      return query select i, null::text, null::public.bedrijf, null::int, null::public.number_status, r->>'name', r->>'client',
        array['geen nummer'], 'overslaan';
      continue;
    end if;
    select * into x from parse_number_code(v_org, v_code);
    v_company := coalesce(x.company, case when upper(coalesce(r->>'company','')) in ('SB','STUDIO_BRUTAAL') then 'studio_brutaal'::public.bedrijf
                                          when upper(coalesce(r->>'company','')) in ('MMS','MOVIEMATES') then 'moviemates'::public.bedrijf end);
    v_year := coalesce(x.year, nullif(r->>'year','')::int);
    if x.company is null then v_issues := v_issues || 'onbekend formaat'::text;
    elsif not x.standard then v_issues := v_issues || 'afwijkend aantal cijfers'::text; end if;
    if v_company is null then v_issues := v_issues || 'bedrijf onbekend'::text; v_action := 'overslaan'; end if;
    if v_year is null then v_issues := v_issues || 'jaar onbekend'::text; v_action := 'overslaan'; end if;
    if nullif(btrim(r->>'client'), '') is null then v_issues := v_issues || 'klant ontbreekt'::text; end if;
    begin v_status := coalesce(nullif(r->>'status','')::public.number_status, 'gereserveerd');
    exception when others then v_status := 'gereserveerd'; v_issues := v_issues || 'status onbekend, wordt gereserveerd'::text; end;
    if v_status = 'project' then v_status := 'offerte'; v_issues := v_issues || 'status project wordt offerte (project koppel je apart)'::text; end if;
    if v_code = any(v_seen) then v_issues := v_issues || 'dubbel in bestand'::text; v_action := 'overslaan'; end if;
    if exists (select 1 from project_number n where n.organization_id = v_org and (n.number_key = v_code
               or (x.company is not null and n.company = x.company and n.year = x.year and n.seq = x.seq and n.kind = 'primair'))) then
      v_issues := v_issues || 'bestaat al in register'::text; v_action := 'overslaan';
    end if;
    v_seen := v_seen || v_code;
    if p_commit and v_action = 'importeren' then
      v_client := null;
      if nullif(btrim(r->>'client'), '') is not null then
        select id into v_client from client_org where organization_id = v_org and lower(name) = lower(btrim(r->>'client')) limit 1;
        if v_client is null then insert into client_org(organization_id, name) values (v_org, btrim(r->>'client')) returning id into v_client; end if;
      end if;
      insert into project_number(organization_id, number_display, kind, company, year, seq, status, name, client_org_id,
                                 source, nonstandard, asana_url, note)
      values (v_org, coalesce(nullif(btrim(r->>'code'),''), v_code), 'primair', v_company, v_year,
              case when x.company = v_company then x.seq end, v_status, nullif(btrim(r->>'name'),''), v_client,
              'import-asana', x.company is null or not x.standard, nullif(btrim(r->>'asana_url'),''), nullif(r->>'note',''));
      v_action := 'geïmporteerd';
    end if;
    return query select i, v_code, v_company, v_year, v_status, r->>'name', r->>'client', v_issues, v_action;
  end loop;
end $$;

drop policy sel on public.project_number;
create policy sel on public.project_number for select to authenticated
  using (public.org_has_role(organization_id, public.internal_roles()));

-- ───────────────────────── Project: fase, modus, template, concept ─────────────────────────
alter table public.project
  add column phase public.project_phase not null default 'pre_productie',
  add column phase_mode text not null default 'auto' check (phase_mode in ('auto','handmatig')),
  add column phase_suggested public.project_phase,
  add column phase_reason text,
  add column phase_changed_at timestamptz not null default now(),
  add column operational_done_at timestamptz,
  add column admin_done_at timestamptz,
  add column template_version_id uuid,
  add column contact_person_id uuid references public.person(id),
  add column automation_enabled boolean not null default true,
  add column is_concept boolean not null default false,
  add column concept_payload jsonb,
  add column start_date date not null default (now() at time zone 'Europe/Amsterdam')::date,
  add column archived_at timestamptz,
  add column bruto_production_id text;

create or replace function public.tg_project_guard() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and (
       new.workspace_id is distinct from old.workspace_id
    or new.lifecycle is distinct from old.lifecycle
    or new.lifecycle_reason is distinct from old.lifecycle_reason
    or new.archived is distinct from old.archived
    or new.archived_at is distinct from old.archived_at
    or new.closed_at is distinct from old.closed_at
    or new.closed_by is distinct from old.closed_by
    or new.admin_status is distinct from old.admin_status
    or new.adm_factuur_verstuurd is distinct from old.adm_factuur_verstuurd
    or new.adm_betaling_ontvangen is distinct from old.adm_betaling_ontvangen
    or new.adm_freelancers_betaald is distinct from old.adm_freelancers_betaald
    or new.adm_overig_afgerond is distinct from old.adm_overig_afgerond
    or new.adm_checked_at is distinct from old.adm_checked_at
    or new.adm_checked_by is distinct from old.adm_checked_by
    or new.phase is distinct from old.phase
    or new.phase_mode is distinct from old.phase_mode
    or new.phase_suggested is distinct from old.phase_suggested
    or new.phase_reason is distinct from old.phase_reason
    or new.phase_changed_at is distinct from old.phase_changed_at
    or new.operational_done_at is distinct from old.operational_done_at
    or new.admin_done_at is distinct from old.admin_done_at
    or new.template_version_id is distinct from old.template_version_id
    or new.is_concept is distinct from old.is_concept
    or new.concept_payload is distinct from old.concept_payload
    or new.company is distinct from old.company
    or new.year is distinct from old.year
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at) then
    raise exception 'Dit veld kan alleen via de daarvoor bedoelde actie worden gewijzigd.' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and new.automation_enabled is distinct from old.automation_enabled
     and not public.can_manage_project(new.id) then
    raise exception 'Alleen eigenaar, admin of projectmanager zet automatiseringen aan of uit.' using errcode = '42501';
  end if;
  return new;
end $$;

-- ───────────────────────── Mijlpalen ─────────────────────────
create table public.milestone (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project(id),
  kind public.milestone_kind not null,
  applicable boolean not null default true,
  checked_at timestamptz,
  checked_by uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision int not null default 1,
  unique (project_id, kind)
);
create trigger bump before update on public.milestone for each row execute function public.tg_bump_revision();

create function public.is_finance_milestone(p_kind public.milestone_kind) returns boolean language sql immutable as $$
  select p_kind in ('gefactureerd','betaling_ontvangen','freelancers_betaald')
$$;

create function public.tg_project_milestones() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into milestone(project_id, kind) select new.id, k from unnest(enum_range(null::public.milestone_kind)) k
  on conflict do nothing;
  return null;
end $$;
create trigger milestones after insert on public.project for each row execute function public.tg_project_milestones();

insert into public.milestone(project_id, kind) select p.id, k from public.project p
cross join unnest(enum_range(null::public.milestone_kind)) k on conflict do nothing;
-- Bestaande administratieve vinkjes uit fase 1 overnemen.
update public.milestone m set checked_at = coalesce(p.adm_checked_at, now()), checked_by = p.adm_checked_by
from public.project p where p.id = m.project_id and (
  (m.kind = 'gefactureerd' and p.adm_factuur_verstuurd) or (m.kind = 'betaling_ontvangen' and p.adm_betaling_ontvangen)
  or (m.kind = 'freelancers_betaald' and p.adm_freelancers_betaald));
update public.milestone m set checked_at = p.created_at from public.project p
where p.id = m.project_id and m.kind = 'offerte_akkoord';

create function public.set_milestone(p_project uuid, p_kind public.milestone_kind, p_checked boolean,
  p_note text default null, p_applicable boolean default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if is_finance_milestone(p_kind) then
    perform require(has_finance(project_ws(p_project)) and can_edit_project(p_project), 'Je mag financiële mijlpalen niet wijzigen.');
  else
    perform require(can_approve_project(p_project), 'Je mag deze mijlpaal niet wijzigen.');
  end if;
  perform require(p_applicable is null or can_manage_project(p_project), 'Alleen eigenaar, admin of PM bepaalt of een mijlpaal geldt.');
  update milestone set
    checked_at = case when p_checked then coalesce(checked_at, now()) else null end,
    checked_by = case when p_checked then coalesce(checked_by, auth.uid()) else null end,
    note = coalesce(p_note, note),
    applicable = coalesce(p_applicable, applicable)
  where project_id = p_project and kind = p_kind;
end $$;

-- ───────────────────────── Draaidagen: back-ups, statussen, apparatuur ─────────────────────────
alter table public.shoot_day
  add column backup_ssd_at timestamptz, add column backup_ssd_by uuid,
  add column backup_hdd_at timestamptz, add column backup_hdd_by uuid,
  add column callsheet_link text,
  add column deleted_at timestamptz, add column deleted_by uuid,
  add column automation_run_id uuid;

update public.shoot_day set backup_ssd_at = backup_confirmed_at, backup_ssd_by = backup_confirmed_by,
  backup_hdd_at = backup_confirmed_at, backup_hdd_by = backup_confirmed_by where backup_confirmed_at is not null;
alter table public.shoot_day disable trigger user;
update public.shoot_day set status = 'bevestigd' where status in ('gepland','in_uitvoering','uitgevoerd');
alter table public.shoot_day enable trigger user;
alter table public.shoot_day alter column status set default 'optie';
alter table public.shoot_day add constraint shoot_status_v2 check (status in ('optie','bevestigd','verplaatst','geannuleerd'));

create or replace function public.tg_shoot_day_stamp() returns trigger language plpgsql as $$
begin
  if new.backup_ssd_at is not null and (tg_op = 'INSERT' or old.backup_ssd_at is null) then
    new.backup_ssd_at := now(); new.backup_ssd_by := auth.uid();
  elsif new.backup_ssd_at is null then new.backup_ssd_by := null;
  elsif tg_op = 'UPDATE' then new.backup_ssd_at := old.backup_ssd_at; new.backup_ssd_by := old.backup_ssd_by; end if;
  if new.backup_hdd_at is not null and (tg_op = 'INSERT' or old.backup_hdd_at is null) then
    new.backup_hdd_at := now(); new.backup_hdd_by := auth.uid();
  elsif new.backup_hdd_at is null then new.backup_hdd_by := null;
  elsif tg_op = 'UPDATE' then new.backup_hdd_at := old.backup_hdd_at; new.backup_hdd_by := old.backup_hdd_by; end if;
  return new;
end $$;

create table public.equipment_item (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project(id),
  shoot_day_id uuid not null,
  description text not null check (length(btrim(description)) > 0),
  picked_up boolean not null default false,
  returned boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision int not null default 1,
  deleted_at timestamptz, deleted_by uuid,
  foreign key (shoot_day_id, project_id) references public.shoot_day(id, project_id)
);
create index on public.equipment_item(shoot_day_id);
create trigger bump before update on public.equipment_item for each row execute function public.tg_bump_revision();

-- ───────────────────────── Deliverables en versies ─────────────────────────
alter table public.deliverable
  add column group_label text,
  add column responsible_person_id uuid references public.person(id),
  add column is_extra_work boolean not null default false,
  add column extra_work_note text,
  add column final_link text,
  add column deleted_at timestamptz, add column deleted_by uuid,
  add column automation_run_id uuid;

alter table public.deliverable_version
  add column status text not null default 'in_review'
    check (status in ('concept','in_review','feedback_ontvangen','goedgekeurd','vervangen')),
  add column feedback_round int check (feedback_round >= 0),
  add column submitted_at timestamptz not null default now(),
  add column review_external_id text;
update public.deliverable_version v set status = 'goedgekeurd'
where exists (select 1 from public.approval a where a.version_id = v.id and a.revoked_at is null);
update public.deliverable_version set feedback_round = version_no where feedback_round is null;

alter table public.approval drop constraint approval_source_check;
alter table public.approval add constraint approval_source_check
  check (source in ('geregistreerd_door_medewerker','reviewtool'));

-- ───────────────────────── Besluiten (onveranderlijk) ─────────────────────────
create table public.decision (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project(id),
  kind public.decision_kind not null,
  subject text not null check (length(btrim(subject)) > 0),
  deliverable_id uuid references public.deliverable(id),
  version_id uuid references public.deliverable_version(id),
  taken_by_name text,
  decided_on date not null,
  evidence text,
  corrects_id uuid references public.decision(id),
  approval_id uuid references public.approval(id),
  source text not null default 'handmatig',
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.decision(project_id, created_at);

create function public.record_decision(p_project uuid, p_kind public.decision_kind, p_subject text,
  p_taken_by text, p_decided_on date, p_evidence text, p_deliverable uuid default null, p_corrects uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform require(can_approve_project(p_project), 'Je mag geen besluiten vastleggen.');
  perform require(p_kind <> 'goedkeuring_versie', 'Een goedkeuring leg je vast op de versie zelf.');
  perform require(p_deliverable is null or exists (select 1 from deliverable where id = p_deliverable and project_id = p_project), 'Onbekende deliverable.');
  perform require(p_corrects is null or exists (select 1 from decision where id = p_corrects and project_id = p_project), 'Onbekend besluit.');
  insert into decision(project_id, kind, subject, deliverable_id, taken_by_name, decided_on, evidence, corrects_id)
  values (p_project, p_kind, btrim(p_subject), p_deliverable, nullif(btrim(p_taken_by), ''), p_decided_on, nullif(btrim(p_evidence), ''), p_corrects)
  returning id into v_id;
  return v_id;
end $$;

-- ───────────────────────── Opmerkingen en externe links ─────────────────────────
create table public.comment (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project(id),
  subject_type text not null check (subject_type in ('project','deliverable','version','shoot_day','task')),
  subject_id uuid not null,
  body text not null check (length(btrim(body)) > 0),
  visibility text not null default 'intern' check (visibility in ('intern','crew')),
  author uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid
);
create index on public.comment(project_id, subject_type, subject_id);

create table public.external_link (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project(id),
  subject_type text not null default 'project' check (subject_type in ('project','deliverable','shoot_day','task')),
  subject_id uuid,
  kind text not null default 'overig' check (kind in ('dropbox','bruto','asana','review','moneybird','licentie','overig')),
  url text not null check (url ~* '^https?://'),
  label text,
  external_id text,
  license_source text, license_title text, license_id text, license_valid_until date,
  visibility text not null default 'intern' check (visibility in ('intern','crew')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid
);
create index on public.external_link(project_id);

-- ───────────────────────── Lijsten en taken ─────────────────────────
create table public.task_list (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspace(id),
  name text not null check (length(btrim(name)) > 0),
  owner uuid not null default auth.uid(),
  project_id uuid references public.project(id),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by uuid
);

create function public.can_view_list(p_list uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from task_list l where l.id = p_list and l.deleted_at is null and
    (l.owner = auth.uid() or (l.shared and is_internal(l.workspace_id))
     or (l.project_id is not null and can_view_project(l.project_id))))
$$;

alter table public.task
  add column list_id uuid references public.task_list(id),
  add column phase_group text check (phase_group in ('pre_productie','productie','post_productie','afronding')),
  add column anchor text check (anchor in ('S','D','L')),
  add column anchor_offset int,
  add column anchor_calendar boolean not null default false,
  add column deadline_manual boolean not null default false,
  add column sort int not null default 0,
  add column deleted_at timestamptz, add column deleted_by uuid,
  add column automation_run_id uuid,
  add column template_key text;

create table public.task_dependency (
  task_id uuid not null references public.task(id),
  blocked_by uuid not null references public.task(id),
  primary key (task_id, blocked_by),
  check (task_id <> blocked_by)
);

-- Handmatige deadlinewijziging op een ankertaak markeert de taak als handmatig aangepast.
create function public.tg_task_deadline_manual() returns trigger language plpgsql as $$
begin
  if new.deadline is distinct from old.deadline and coalesce(current_setting('regie.automation', true), '') <> 'aan'
     and new.anchor is not null then
    new.deadline_manual := true;
  end if;
  return new;
end $$;
create trigger deadline_manual before update on public.task for each row execute function public.tg_task_deadline_manual();

-- Subtaken maximaal één niveau; lijsttaak blijft in de werkruimte van de lijst.
create function public.tg_task_level() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.parent_id is not null and exists (select 1 from task where id = new.parent_id and parent_id is not null) then
    raise exception 'Subtaken kunnen maximaal één niveau diep.';
  end if;
  if new.list_id is not null then
    perform require((select workspace_id from task_list where id = new.list_id) = new.workspace_id, 'Lijst hoort niet bij deze werkruimte.');
  end if;
  return new;
end $$;
create trigger level before insert or update on public.task for each row execute function public.tg_task_level();

-- ───────────────────────── RLS: rechtenmatrix en prullenbak ─────────────────────────
alter table public.company_setting enable row level security;
alter table public.org_setting enable row level security;
alter table public.milestone enable row level security;
alter table public.equipment_item enable row level security;
alter table public.decision enable row level security;
alter table public.comment enable row level security;
alter table public.external_link enable row level security;
alter table public.task_list enable row level security;
alter table public.task_dependency enable row level security;

create policy sel on public.company_setting for select to authenticated using (public.org_has_role(organization_id, public.internal_roles()));
create policy upd on public.company_setting for update to authenticated
  using (public.org_has_role(organization_id, '{eigenaar,admin}')) with check (public.org_has_role(organization_id, '{eigenaar,admin}'));
create policy sel on public.org_setting for select to authenticated using (public.org_has_role(organization_id, public.internal_roles()));
create policy upd on public.org_setting for update to authenticated
  using (public.org_has_role(organization_id, '{eigenaar,admin}')) with check (public.org_has_role(organization_id, '{eigenaar,admin}'));

-- Financiële mijlpalen zijn alleen zichtbaar voor rollen met financiële rechten — ook via de API.
create policy sel on public.milestone for select to authenticated using (
  public.can_view_project(project_id) and (not public.is_finance_milestone(kind) or public.has_finance(public.project_ws(project_id))));

create policy sel on public.equipment_item for select to authenticated using (deleted_at is null and public.can_view_project(project_id));
create policy ins on public.equipment_item for insert to authenticated with check (deleted_at is null and public.can_edit_project(project_id));
create policy upd on public.equipment_item for update to authenticated
  using (deleted_at is null and public.can_edit_project(project_id)) with check (deleted_at is null and public.can_edit_project(project_id));

create policy sel on public.decision for select to authenticated using (public.can_view_project(project_id));

create policy sel on public.comment for select to authenticated using (deleted_at is null and public.can_view_project(project_id));
create policy ins on public.comment for insert to authenticated
  with check (author = auth.uid() and deleted_at is null and public.can_edit_project(project_id));

create policy sel on public.external_link for select to authenticated using (deleted_at is null and public.can_view_project(project_id));
create policy ins on public.external_link for insert to authenticated with check (deleted_at is null and public.can_edit_project(project_id));
create policy upd on public.external_link for update to authenticated
  using (deleted_at is null and public.can_edit_project(project_id)) with check (deleted_at is null and public.can_edit_project(project_id));

create policy sel on public.task_list for select to authenticated using (deleted_at is null and (
  owner = auth.uid() or (shared and public.is_internal(workspace_id))
  or (project_id is not null and public.can_view_project(project_id))));
create policy ins on public.task_list for insert to authenticated with check (
  owner = auth.uid() and deleted_at is null and public.is_internal(workspace_id)
  and (project_id is null or public.can_edit_project(project_id)));
create policy upd on public.task_list for update to authenticated
  using (owner = auth.uid() and deleted_at is null) with check (owner = auth.uid() and deleted_at is null);

create policy sel on public.task_dependency for select to authenticated using (exists (select 1 from public.task t where t.id = task_id));
create policy ins on public.task_dependency for insert to authenticated with check (
  exists (select 1 from public.task t where t.id = task_id and public.can_edit_task(t.project_id, t.created_by))
  and exists (select 1 from public.task t where t.id = blocked_by));
create policy del on public.task_dependency for delete to authenticated using (
  exists (select 1 from public.task t where t.id = task_id and public.can_edit_task(t.project_id, t.created_by)));

-- Bestaande policies: verwijderde rijen verbergen; lijsttaken zichtbaar via de lijst.
drop policy sel on public.deliverable;
create policy sel on public.deliverable for select to authenticated using (deleted_at is null and public.can_view_project(project_id));
drop policy upd on public.deliverable;
create policy upd on public.deliverable for update to authenticated
  using (deleted_at is null and public.can_edit_project(project_id)) with check (deleted_at is null and public.can_edit_project(project_id));
drop policy ins on public.deliverable;
create policy ins on public.deliverable for insert to authenticated with check (deleted_at is null and public.can_edit_project(project_id));

drop policy sel on public.shoot_day;
create policy sel on public.shoot_day for select to authenticated using (deleted_at is null and public.can_view_project(project_id));
drop policy upd on public.shoot_day;
create policy upd on public.shoot_day for update to authenticated
  using (deleted_at is null and public.can_edit_project(project_id)) with check (deleted_at is null and public.can_edit_project(project_id));
drop policy ins on public.shoot_day;
create policy ins on public.shoot_day for insert to authenticated with check (deleted_at is null and public.can_edit_project(project_id));

create or replace function public.can_edit_task(p_project uuid, p_created_by uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_project is null then p_created_by = auth.uid()
              else public.can_edit_project(p_project) end
$$;

drop policy sel on public.task;
create policy sel on public.task for select to authenticated using (deleted_at is null and (
  (project_id is not null and public.can_view_project(project_id))
  or (project_id is null and created_by = auth.uid())
  or (list_id is not null and public.can_view_list(list_id))));
drop policy ins on public.task;
create policy ins on public.task for insert to authenticated with check (
  created_by = auth.uid() and deleted_at is null and (
    (project_id is not null and public.can_edit_project(project_id))
    or (project_id is null and public.is_internal(workspace_id)
        and (list_id is null or public.can_view_list(list_id)))));
drop policy upd on public.task;
create policy upd on public.task for update to authenticated using (deleted_at is null and (
  (project_id is not null and public.can_edit_project(project_id))
  or (project_id is null and (created_by = auth.uid() or (list_id is not null and public.can_view_list(list_id))))))
  with check (deleted_at is null);

create or replace function public.tg_task_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user = 'authenticated' then
    if new.created_by <> old.created_by or new.created_at <> old.created_at then
      raise exception 'Maker van een taak kan niet worden gewijzigd.' using errcode = '42501';
    end if;
    if new.deleted_at is distinct from old.deleted_at or new.automation_run_id is distinct from old.automation_run_id then
      raise exception 'Verwijderen gaat via de prullenbak-actie.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Assignment: alleen interne bewerkers; geen verwijderen meer voor stagiair (matrix: verwijderen PM+).
drop policy del on public.assignment;
create policy del on public.assignment for delete to authenticated using (public.can_manage_project(project_id));

-- ───────────────────────── Prullenbak (soft delete, 30 dagen herstel) ─────────────────────────
create function public.soft_delete(p_kind text, p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid; v_created_by uuid; v_owner uuid;
begin
  perform set_config('regie.reason', coalesce(p_reason, 'verwijderd'), true);
  if p_kind = 'task' then
    select project_id, created_by into v_project, v_created_by from task where id = p_id and deleted_at is null;
    perform require(found, 'Niet gevonden.');
    perform require((v_project is not null and can_manage_project(v_project))
                    or (v_project is null and v_created_by = auth.uid()), 'Je mag deze taak niet verwijderen.');
    update task set deleted_at = now(), deleted_by = auth.uid() where id = p_id or parent_id = p_id;
  elsif p_kind = 'list' then
    select owner into v_owner from task_list where id = p_id and deleted_at is null;
    perform require(v_owner = auth.uid(), 'Alleen de eigenaar van de lijst kan die verwijderen.');
    update task_list set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  else
    execute format('select project_id from %I where id = $1 and deleted_at is null',
      case p_kind when 'deliverable' then 'deliverable' when 'shoot_day' then 'shoot_day'
                  when 'equipment' then 'equipment_item' when 'link' then 'external_link' when 'comment' then 'comment'
                  else 'onbekend' end) into v_project using p_id;
    perform require(v_project is not null, 'Niet gevonden.');
    if p_kind = 'comment' then
      perform require(can_manage_project(v_project) or (select author from comment where id = p_id) = auth.uid(), 'Je mag deze opmerking niet verwijderen.');
    elsif p_kind in ('equipment','link') then
      perform require(can_edit_project(v_project) and my_role(project_ws(v_project)) <> 'stagiair', 'Je mag dit niet verwijderen.');
    else
      perform require(can_manage_project(v_project), 'Alleen eigenaar, admin of projectmanager mag verwijderen.');
    end if;
    execute format('update %I set deleted_at = now(), deleted_by = auth.uid() where id = $1',
      case p_kind when 'deliverable' then 'deliverable' when 'shoot_day' then 'shoot_day'
                  when 'equipment' then 'equipment_item' when 'link' then 'external_link' else 'comment' end) using p_id;
  end if;
end $$;

create function public.restore_item(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid; v_at timestamptz; v_tbl text;
begin
  v_tbl := case p_kind when 'task' then 'task' when 'deliverable' then 'deliverable' when 'shoot_day' then 'shoot_day'
                       when 'equipment' then 'equipment_item' when 'link' then 'external_link' when 'comment' then 'comment'
                       when 'list' then 'task_list' end;
  perform require(v_tbl is not null, 'Onbekend type.');
  if p_kind = 'list' then
    perform require((select owner from task_list where id = p_id) = auth.uid(), 'Alleen de eigenaar herstelt deze lijst.');
    update task_list set deleted_at = null, deleted_by = null where id = p_id;
    return;
  end if;
  execute format('select project_id, deleted_at from %I where id = $1', v_tbl) into v_project, v_at using p_id;
  perform require(v_at is not null, 'Dit item staat niet in de prullenbak.');
  perform require(v_at > now() - interval '30 days', 'De hersteltermijn van 30 dagen is verstreken.');
  if v_project is null then
    perform require((select created_by from task where id = p_id) = auth.uid(), 'Je mag dit niet herstellen.');
  else
    perform require(can_manage_project(v_project), 'Alleen eigenaar, admin of projectmanager herstelt.');
  end if;
  execute format('update %I set deleted_at = null, deleted_by = null where id = $1', v_tbl) using p_id;
  if p_kind = 'task' then update task set deleted_at = null, deleted_by = null where parent_id = p_id and deleted_at = v_at; end if;
end $$;

create function public.trash_items(p_ws uuid)
returns table(kind text, id uuid, project_id uuid, title text, deleted_at timestamptz, deleted_by_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  with x as (
    select 'task'::text k, t.id, t.project_id, t.title, t.deleted_at, t.deleted_by from task t
      where t.workspace_id = p_ws and t.deleted_at is not null and t.parent_id is null
        and ((t.project_id is null and t.created_by = auth.uid()) or (t.project_id is not null and can_manage_project(t.project_id)))
    union all select 'deliverable', d.id, d.project_id, d.title, d.deleted_at, d.deleted_by from deliverable d
      where d.deleted_at is not null and project_ws(d.project_id) = p_ws and can_manage_project(d.project_id)
    union all select 'shoot_day', s.id, s.project_id, 'Draaidag ' || to_char(s.date, 'DD-MM-YYYY'), s.deleted_at, s.deleted_by from shoot_day s
      where s.deleted_at is not null and project_ws(s.project_id) = p_ws and can_manage_project(s.project_id)
    union all select 'equipment', e.id, e.project_id, e.description, e.deleted_at, e.deleted_by from equipment_item e
      where e.deleted_at is not null and project_ws(e.project_id) = p_ws and can_manage_project(e.project_id)
    union all select 'link', l.id, l.project_id, coalesce(l.label, l.url), l.deleted_at, l.deleted_by from external_link l
      where l.deleted_at is not null and project_ws(l.project_id) = p_ws and can_manage_project(l.project_id)
    union all select 'list', l.id, l.project_id, l.name, l.deleted_at, l.deleted_by from task_list l
      where l.deleted_at is not null and l.workspace_id = p_ws and l.owner = auth.uid())
  select x.k, x.id, x.project_id, x.title, x.deleted_at, pe.full_name
  from x left join person pe on pe.user_id = x.deleted_by and pe.organization_id = ws_org(p_ws)
  where x.deleted_at > now() - interval '30 days'
  order by x.deleted_at desc
$$;

-- ───────────────────────── Project aanmaken: matrix (ook medewerker) ─────────────────────────
create or replace function public.create_project(
  p_ws uuid, p_company public.bedrijf, p_year int, p_name text,
  p_number text default null, p_client_org_id uuid default null, p_client_name text default null,
  p_manager_person_id uuid default null, p_briefing text default null,
  p_workflow public.workflow_kind default 'film', p_production_applicable boolean default true)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid; v_client uuid := p_client_org_id;
begin
  perform require(my_role(p_ws) in ('eigenaar','admin','projectmanager','medewerker'), 'Je mag geen projecten aanmaken.');
  if v_client is null and nullif(btrim(p_client_name), '') is not null then
    select id into v_client from client_org where organization_id = ws_org(p_ws) and lower(name) = lower(btrim(p_client_name)) limit 1;
    if v_client is null then
      insert into client_org(organization_id, name) values (ws_org(p_ws), btrim(p_client_name)) returning id into v_client;
    end if;
  end if;
  insert into project(workspace_id, company, year, name, client_org_id, manager_person_id, briefing, workflow, production_applicable)
  values (p_ws, p_company, p_year, btrim(p_name), v_client, p_manager_person_id, p_briefing, p_workflow, p_production_applicable)
  returning id into v_project;
  insert into project_member(project_id, user_id) values (v_project, auth.uid());
  update milestone set checked_at = now(), checked_by = auth.uid() where project_id = v_project and kind = 'offerte_akkoord';
  if nullif(btrim(p_number), '') is not null then
    perform register_number_internal(v_project, p_number, 'primair', null);
  end if;
  return v_project;
end $$;

-- Gearchiveerd alleen bij administratief klaar of geannuleerd.
create or replace function public.set_project_archived(p_project uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p project%rowtype;
begin
  perform require(can_manage_project(p_project), 'Je mag dit project niet archiveren.');
  select * into p from project where id = p_project for update;
  perform require(not p_archived or p.phase = 'administratief_klaar' or p.lifecycle = 'geannuleerd',
                  'Archiveren kan alleen bij "Administratief klaar" of een geannuleerd project.');
  update project set archived = p_archived, archived_at = case when p_archived then now() end where id = p_project;
end $$;

-- Fase-1-afsluitroute is vervangen door faselogica en mijlpalen.
drop function public.close_project(uuid);
drop function public.close_gates(uuid);
drop function public.set_admin_status(uuid, public.admin_status, boolean, boolean, boolean, boolean);

-- ───────────────────────── Audit op nieuwe tabellen ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['milestone','equipment_item','decision','external_link','task_list','company_setting','org_setting','comment']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
  end loop;
end $$;

-- ───────────────────────── Grants ─────────────────────────
revoke all on public.company_setting, public.org_setting, public.milestone, public.equipment_item, public.decision,
  public.comment, public.external_link, public.task_list, public.task_dependency, public.operation from anon;
revoke insert, update, delete on public.milestone, public.decision, public.operation from authenticated;
revoke delete on public.equipment_item, public.comment, public.external_link, public.task_list, public.company_setting,
  public.org_setting from authenticated;
revoke insert on public.company_setting, public.org_setting from authenticated;
revoke update on public.comment from authenticated;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.register_number_internal(uuid, text, public.number_kind, text) from authenticated;
