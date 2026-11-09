-- Regie · volledige app (deel 3): faselogica (§6), templates (§8), automatiseringen AU1–AU9 (§9), meldingen.

-- ───────────────────────── Werkdagen ─────────────────────────
-- Relatieve deadlines rekenen in werkdagen (ma–vr). Feestdagen volgen later als instelling.
create function public.add_workdays(p_date date, p_n int) returns date language plpgsql immutable as $$
declare d date := p_date; v_step int := sign(p_n)::int; v_left int := abs(p_n);
begin
  while v_left > 0 loop
    d := d + v_step;
    if extract(isodow from d) < 6 then v_left := v_left - 1; end if;
  end loop;
  return d;
end $$;

-- Kalenderdagen, daarna weekend verschuiven: vóór het anker naar vrijdag, erna naar maandag.
create function public.add_calendar_days(p_date date, p_n int) returns date language plpgsql immutable as $$
declare d date := p_date + p_n;
begin
  while extract(isodow from d) >= 6 loop
    d := d + case when p_n < 0 then -1 else 1 end;
  end loop;
  return d;
end $$;

create function public.anchor_deadline(p_anchor date, p_offset int, p_calendar boolean) returns date
language sql immutable as $$
  select case when p_anchor is null or p_offset is null then null
              when p_calendar then public.add_calendar_days(p_anchor, p_offset)
              else public.add_workdays(p_anchor, p_offset) end
$$;

create function public.today_ams() returns date language sql stable as $$
  select (now() at time zone 'Europe/Amsterdam')::date
$$;

-- ───────────────────────── Automatiseringslog ─────────────────────────
create table public.automation_run (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspace(id),
  project_id uuid references public.project(id),
  kind text not null,                       -- AU1, AU2, AU3, AU7, AU5, AU9, AU10, ...
  idem_key text not null,
  trigger text,
  status text not null default 'ok' check (status in ('ok','fout','ongedaan','duplicaat')),
  summary text,
  result jsonb,
  undo_data jsonb,
  error text,
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  undone_at timestamptz,
  undone_by uuid
);
create unique index automation_run_idem on public.automation_run(kind, idem_key) where status <> 'duplicaat';
create index on public.automation_run(project_id, created_at desc);

-- ───────────────────────── Faselogica ─────────────────────────
create function public.shoot_start(s public.shoot_day) returns timestamptz language sql stable as $$
  select (s.date + coalesce(s.start_time, '00:00'::time)) at time zone s.timezone
$$;
create function public.shoot_end(s public.shoot_day) returns timestamptz language sql stable as $$
  select case when s.end_time is null then ((s.date + 1)::timestamp at time zone s.timezone)
              else (s.date + s.end_time) at time zone s.timezone end
$$;

-- Berekent de fase die volgens §6 geldt, met de reden en de openstaande voorwaarden.
create function public.compute_phase(p_project uuid)
returns table(phase public.project_phase, reason text, waiting text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p project%rowtype; v_conf int; v_started int; v_open_shoots int; v_missing_backup int; v_deliv int; v_deliv_open int;
  v_in_prod int; v_equip_open int; v_debrief boolean; v_fact boolean; v_paid boolean; v_free boolean; v_wait text[] := '{}';
begin
  select * into p from project where id = p_project;
  select count(*), count(*) filter (where shoot_start(s) <= now()),
         count(*) filter (where shoot_end(s) > now()),
         count(*) filter (where shoot_end(s) <= now() and (s.backup_ssd_at is null or s.backup_hdd_at is null))
    into v_conf, v_started, v_open_shoots, v_missing_backup
  from shoot_day s where s.project_id = p_project and s.deleted_at is null and s.status = 'bevestigd';
  select count(*), count(*) filter (where d.status <> 'geleverd'),
         count(*) filter (where d.status in ('in_uitvoering','in_review','wijzigingen_nodig','goedgekeurd','geleverd'))
    into v_deliv, v_deliv_open, v_in_prod
  from deliverable d where d.project_id = p_project and d.deleted_at is null and d.status <> 'vervallen';
  select count(*) into v_equip_open from equipment_item e
    join shoot_day s on s.id = e.shoot_day_id and s.deleted_at is null and s.status <> 'geannuleerd'
  where e.project_id = p_project and e.deleted_at is null and not e.returned;
  select bool_or(kind = 'debriefing' and checked_at is not null),
         bool_or(kind = 'gefactureerd' and checked_at is not null),
         bool_or(kind = 'betaling_ontvangen' and checked_at is not null),
         bool_or(kind = 'freelancers_betaald' and (checked_at is not null or not applicable))
    into v_debrief, v_fact, v_paid, v_free
  from milestone where project_id = p_project;

  -- Pre-productie → Productie / Post-productie
  if p.production_applicable then
    if v_started = 0 then
      return query select 'pre_productie'::project_phase, 'Nog geen bevestigde draaidag begonnen.',
        array['Eerste bevestigde draaidag is begonnen']; return;
    end if;
    if v_open_shoots > 0 or v_missing_backup > 0 then
      if v_open_shoots > 0 then v_wait := v_wait || 'Alle bevestigde draaidagen zijn voorbij'::text; end if;
      if v_missing_backup > 0 then v_wait := v_wait || (v_missing_backup || ' draaidag(en) zonder afgevinkte back-up op SSD én HDD')::text; end if;
      return query select 'productie'::project_phase, 'Draaidag begonnen; productie loopt of back-up ontbreekt.', v_wait; return;
    end if;
  else
    if v_in_prod = 0 then
      return query select 'pre_productie'::project_phase, 'Geen opnames; nog geen deliverable in productie.',
        array['Minstens één deliverable staat op "in productie" of verder']; return;
    end if;
  end if;

  -- Post-productie → Afronding (een leeg project rondt nooit af)
  if v_deliv = 0 or v_deliv_open > 0 then
    return query select 'post_productie'::project_phase, 'Deliverables nog niet allemaal opgeleverd.',
      array[case when v_deliv = 0 then 'Er is nog geen deliverable' else v_deliv_open || ' deliverable(s) nog niet opgeleverd' end]; return;
  end if;

  -- Afronding → Operationeel klaar
  if v_equip_open > 0 or not coalesce(v_debrief, false) then
    if v_equip_open > 0 then v_wait := v_wait || (v_equip_open || ' apparatuurregel(s) niet teruggebracht')::text; end if;
    if not coalesce(v_debrief, false) then v_wait := v_wait || 'Mijlpaal "debriefing gedaan"'::text; end if;
    return query select 'afronding'::project_phase, 'Alles opgeleverd; afronding loopt.', v_wait; return;
  end if;

  -- Operationeel klaar → Administratief klaar
  if not (coalesce(v_fact, false) and coalesce(v_paid, false) and coalesce(v_free, false)) then
    return query select 'operationeel_klaar'::project_phase, 'Operationeel klaar; administratie loopt.',
      array['Financiële mijlpalen afgevinkt']; return;
  end if;
  return query select 'administratief_klaar'::project_phase, 'Alle voorwaarden zijn vervuld.', '{}'::text[];
end $$;

create function public.phase_rank(p public.project_phase) returns int language sql immutable as $$
  select array_position(enum_range(null::public.project_phase), p)
$$;

-- AU7: fase evalueren en toepassen. Nooit automatisch terug uit "Administratief klaar".
create function public.evaluate_phase(p_project uuid) returns public.project_phase
language plpgsql security definer set search_path = public, pg_temp as $$
declare p project%rowtype; c record; v_new public.project_phase;
begin
  select * into p from project where id = p_project;
  if not found or p.archived or p.is_concept then return p.phase; end if;
  select * into c from compute_phase(p_project);
  v_new := c.phase;
  if p.phase_mode = 'handmatig' then
    if p.phase_suggested is distinct from v_new then
      update project set phase_suggested = v_new where id = p_project;
      if v_new <> p.phase then
        perform notify_project_manager(p_project, 'fase_afwijking',
          'Fase staat handmatig op ' || replace(p.phase::text, '_', ' ') || '; de automatiek zou ' || replace(v_new::text, '_', ' ') || ' kiezen.',
          'fase:' || p_project || ':' || v_new);
      end if;
    end if;
    return p.phase;
  end if;
  if p.phase = 'administratief_klaar' or v_new = p.phase then
    if p.phase_suggested is distinct from v_new then update project set phase_suggested = v_new where id = p_project; end if;
    return p.phase;
  end if;
  perform set_config('regie.reason', 'Automatisch: ' || c.reason, true);
  update project set phase = v_new, phase_suggested = v_new, phase_reason = 'Automatisch: ' || c.reason, phase_changed_at = now(),
    operational_done_at = case when phase_rank(v_new) >= phase_rank('operationeel_klaar') then coalesce(operational_done_at, now()) end,
    admin_done_at = case when v_new = 'administratief_klaar' then now() end
  where id = p_project;
  insert into automation_run(workspace_id, project_id, kind, idem_key, trigger, summary)
  values (p.workspace_id, p_project, 'AU7', p_project || ':' || clock_timestamp(), 'wijziging',
          'Fase ' || replace(p.phase::text, '_', ' ') || ' → ' || replace(v_new::text, '_', ' ') || ': ' || c.reason);
  perform set_config('regie.reason', '', true);
  return v_new;
end $$;

create function public.tg_eval_phase() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform evaluate_phase(coalesce(new.project_id, old.project_id));
  return null;
end $$;
create trigger eval_phase after insert or update or delete on public.deliverable for each row execute function public.tg_eval_phase();
create trigger eval_phase after insert or update or delete on public.shoot_day for each row execute function public.tg_eval_phase();
create trigger eval_phase after insert or update or delete on public.equipment_item for each row execute function public.tg_eval_phase();
create trigger eval_phase after insert or update on public.milestone for each row execute function public.tg_eval_phase();

create function public.tg_eval_phase_project() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform evaluate_phase(new.id);
  return null;
end $$;
create trigger eval_phase after update of production_applicable, is_concept, archived on public.project
  for each row execute function public.tg_eval_phase_project();

-- Handmatige correctie met verplichte reden (eigenaar, admin, PM).
create function public.set_phase_manual(p_project uuid, p_phase public.project_phase, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c record;
begin
  perform require(can_manage_project(p_project), 'Alleen eigenaar, admin of projectmanager corrigeert de fase.');
  perform require(length(btrim(coalesce(p_reason, ''))) > 0, 'Geef een reden voor de handmatige fase.');
  perform require(not (select archived from project where id = p_project), 'Project is gearchiveerd.');
  select * into c from compute_phase(p_project);
  perform set_config('regie.reason', 'Handmatig: ' || p_reason, true);
  update project set phase = p_phase, phase_mode = 'handmatig', phase_suggested = c.phase, phase_reason = 'Handmatig: ' || btrim(p_reason),
    phase_changed_at = now(),
    operational_done_at = case when phase_rank(p_phase) >= phase_rank('operationeel_klaar') then coalesce(operational_done_at, now()) end,
    admin_done_at = case when p_phase = 'administratief_klaar' then coalesce(admin_done_at, now()) end
  where id = p_project;
end $$;

-- "Automatiek hervatten": eerst voorstel tonen (p_confirm = false), daarna bevestigen.
create function public.resume_auto_phase(p_project uuid, p_confirm boolean)
returns table(suggested public.project_phase, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record;
begin
  perform require(can_manage_project(p_project), 'Alleen eigenaar, admin of projectmanager hervat de automatiek.');
  select * into c from compute_phase(p_project);
  if p_confirm then
    perform set_config('regie.reason', 'Automatiek hervat: ' || c.reason, true);
    update project set phase_mode = 'auto', phase = c.phase, phase_suggested = c.phase, phase_reason = 'Automatiek hervat: ' || c.reason,
      phase_changed_at = now(),
      operational_done_at = case when phase_rank(c.phase) >= phase_rank('operationeel_klaar') then coalesce(operational_done_at, now()) end,
      admin_done_at = case when c.phase = 'administratief_klaar' then coalesce(admin_done_at, now()) end
    where id = p_project;
  end if;
  return query select c.phase, c.reason;
end $$;

-- ───────────────────────── Meldingen ─────────────────────────
create table public.notification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  workspace_id uuid references public.workspace(id),
  project_id uuid references public.project(id),
  kind text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, dedupe_key)
);
create index on public.notification(user_id, read_at, created_at desc);

create table public.notification_pref (
  user_id uuid primary key references auth.users(id),
  email_daily boolean not null default false,
  updated_at timestamptz not null default now()
);

create function public.notify_user(p_user uuid, p_ws uuid, p_project uuid, p_kind text, p_title text, p_body text,
  p_link text, p_dedupe text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user is null then return; end if;
  -- Financiële meldingen alleen naar rollen met financiële rechten.
  if p_kind in ('blijft_hangen') and not exists (select 1 from membership where workspace_id = p_ws and user_id = p_user
       and revoked_at is null and role in ('eigenaar','admin','projectmanager')) then return; end if;
  if not exists (select 1 from membership where workspace_id = p_ws and user_id = p_user and revoked_at is null) then return; end if;
  insert into notification(user_id, workspace_id, project_id, kind, title, body, link, dedupe_key)
  values (p_user, p_ws, p_project, p_kind, p_title, p_body, p_link, p_dedupe) on conflict (user_id, dedupe_key) do nothing;
end $$;

-- Melding aan de projectverantwoordelijke; zonder verantwoordelijke naar eigenaar(s).
create function public.notify_project_manager(p_project uuid, p_kind text, p_title text, p_dedupe text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p project%rowtype; v_user uuid;
begin
  select * into p from project where id = p_project;
  v_user := user_for_person(p.manager_person_id);
  if v_user is not null and exists (select 1 from membership where workspace_id = p.workspace_id and user_id = v_user and revoked_at is null) then
    perform notify_user(v_user, p.workspace_id, p_project, p_kind, p_title, null, '/projecten/' || p_project, p_dedupe);
  else
    for v_user in select user_id from membership where workspace_id = p.workspace_id and role = 'eigenaar' and revoked_at is null loop
      perform notify_user(v_user, p.workspace_id, p_project, p_kind, p_title, null, '/projecten/' || p_project, p_dedupe);
    end loop;
  end if;
end $$;

create function public.in_quiet_hours(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when s.quiet_start > s.quiet_end
              then (now() at time zone 'Europe/Amsterdam')::time >= s.quiet_start or (now() at time zone 'Europe/Amsterdam')::time < s.quiet_end
              else (now() at time zone 'Europe/Amsterdam')::time >= s.quiet_start and (now() at time zone 'Europe/Amsterdam')::time < s.quiet_end end
  from org_setting s where s.organization_id = p_org
$$;

-- AU5 (deadlines, gebundeld per gebruiker per dagdeel, niet in stille uren) en AU9 (back-up ontbreekt).
create function public.generate_notifications(p_ws uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := ws_org(p_ws); v_today date := today_ams(); v_soon date := add_workdays(today_ams(), 2);
  v_part text := case when extract(hour from now() at time zone 'Europe/Amsterdam') < 12 then 'ochtend' else 'middag' end;
  r record; v_count int := 0;
begin
  if not coalesce(in_quiet_hours(v_org), false) then
    for r in
      with items as (
        select pe.user_id, t.title, t.deadline, coalesce(t.project_id::text, '') pid,
               case when t.project_id is not null then '/projecten/' || t.project_id else '/mijn-taken' end link
        from task t join person pe on pe.id = t.assignee_person_id
        where t.workspace_id = p_ws and t.deleted_at is null and t.status not in ('klaar','vervallen')
          and t.deadline in (v_today, v_soon) and pe.user_id is not null
        union all
        select pe.user_id, 'Deliverable: ' || d.title, d.deadline, d.project_id::text, '/projecten/' || d.project_id
        from deliverable d join project p on p.id = d.project_id join person pe on pe.id = coalesce(d.responsible_person_id, p.manager_person_id)
        where p.workspace_id = p_ws and d.deleted_at is null and d.status not in ('geleverd','vervallen','goedgekeurd')
          and d.deadline in (v_today, v_soon) and pe.user_id is not null and not p.archived)
      select user_id, count(*) n, string_agg(case when deadline = v_today then 'Vandaag: ' else 'Over 2 werkdagen: ' end || title, E'\n' order by deadline, title) body
      from items group by user_id
    loop
      perform notify_user(r.user_id, p_ws, null, 'deadline', r.n || ' deadline(s) naderen', r.body, '/mijn-taken',
                          'deadlines:' || v_today || ':' || v_part);
      v_count := v_count + 1;
    end loop;
  end if;

  for r in
    select s.id, s.project_id, s.date from shoot_day s join project p on p.id = s.project_id
    where p.workspace_id = p_ws and not p.archived and s.deleted_at is null and s.status = 'bevestigd'
      and shoot_end(s) <= now() and (s.backup_ssd_at is null or s.backup_hdd_at is null)
  loop
    perform notify_project_manager(r.project_id, 'backup',
      'Back-up ontbreekt voor draaidag ' || to_char(r.date, 'DD-MM-YYYY'), 'backup:' || r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.generate_notifications(uuid) from authenticated;

create function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  update notification set read_at = now() where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
$$;

-- Periodieke taak: tijdsafhankelijke fases + meldingen. Draait via pg_cron (indien beschikbaar)
-- en wordt ook aangeroepen bij het laden van het dashboard.
create function public.tick_workspace(p_ws uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select id from project where workspace_id = p_ws and not archived and not is_concept
           and phase in ('pre_productie','productie') loop
    perform evaluate_phase(r.id);
  end loop;
  perform generate_notifications(p_ws);
end $$;
revoke execute on function public.tick_workspace(uuid) from authenticated;

create function public.tick_all() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select w.id from workspace w join organization o on o.id = w.organization_id loop
    perform tick_workspace(r.id);
  end loop;
end $$;
revoke execute on function public.tick_all() from authenticated;

create function public.refresh_workspace(p_ws uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(is_internal(p_ws), 'Geen toegang.');
  perform tick_workspace(p_ws);
end $$;

-- ───────────────────────── Templates ─────────────────────────
create table public.template (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  name text not null check (length(btrim(name)) > 0),
  company public.bedrijf,
  description text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create table public.template_version (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.template(id),
  version_no int not null check (version_no > 0),
  content jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (template_id, version_no)
);
alter table public.project add constraint project_template_version_fk
  foreign key (template_version_id) references public.template_version(id);

create function public.validate_template_content(c jsonb) returns void language plpgsql immutable as $$
declare t jsonb;
begin
  if jsonb_typeof(c) <> 'object' then raise exception 'Template-inhoud is ongeldig.'; end if;
  for t in select * from jsonb_array_elements(coalesce(c->'tasks', '[]')) loop
    if length(btrim(coalesce(t->>'title', ''))) = 0 then raise exception 'Elke taak heeft een titel.'; end if;
    if t ? 'anchor' and t->>'anchor' is not null and t->>'anchor' not in ('S','D','L') then
      raise exception 'Anker moet S, D of L zijn.'; end if;
    if t ? 'phase' and t->>'phase' is not null and t->>'phase' not in ('pre_productie','productie','post_productie','afronding') then
      raise exception 'Onbekende fase in template.'; end if;
  end loop;
  for t in select * from jsonb_array_elements(coalesce(c->'deliverables', '[]')) loop
    if length(btrim(coalesce(t->>'title', ''))) = 0 then raise exception 'Elke deliverable heeft een titel.'; end if;
  end loop;
end $$;

create function public.tg_template_version_validate() returns trigger language plpgsql as $$
begin
  perform public.validate_template_content(new.content);
  return new;
end $$;
create trigger validate before insert on public.template_version for each row execute function public.tg_template_version_validate();

-- Plan van een template t.o.v. de ankers: wat er aangemaakt wordt (voorbeeld én uitvoering).
create function public.template_plan(p_content jsonb, p_d date, p_s date)
returns table(kind text, ord int, title text, phase text, anchor text, anchor_offset int, anchor_calendar boolean,
              due date, extra jsonb)
language plpgsql stable as $$
declare v_l date; v_sd jsonb; v_t jsonb; i int := 0; v_d jsonb;
begin
  select max(p_d + coalesce((x->>'offset_days')::int, 0)) into v_l from jsonb_array_elements(coalesce(p_content->'shoot_days', '[]')) x;
  v_l := coalesce(v_l, p_d);
  for v_sd in select * from jsonb_array_elements(coalesce(p_content->'shoot_days', '[]')) loop
    i := i + 1;
    return query select 'draaidag', i, coalesce(v_sd->>'title', 'Draaidag ' || i), 'productie', 'D',
      coalesce((v_sd->>'offset_days')::int, 0), true, p_d + coalesce((v_sd->>'offset_days')::int, 0), v_sd;
  end loop;
  i := 0;
  for v_d in select * from jsonb_array_elements(coalesce(p_content->'deliverables', '[]')) loop
    i := i + 1;
    return query select 'deliverable', i, v_d->>'title', null::text, null::text, null::int, false, null::date, v_d;
  end loop;
  i := 0;
  for v_t in select * from jsonb_array_elements(coalesce(p_content->'tasks', '[]')) loop
    i := i + 1;
    if coalesce((v_t->>'per_deliverable')::boolean, false) then
      return query select 'taak', i * 100 + d.o::int, (v_t->>'title') || ' – ' || (d.v->>'title'), v_t->>'phase', v_t->>'anchor',
        (v_t->>'offset')::int, coalesce((v_t->>'calendar')::boolean, false),
        anchor_deadline(case v_t->>'anchor' when 'S' then p_s when 'D' then p_d when 'L' then v_l end, (v_t->>'offset')::int,
                        coalesce((v_t->>'calendar')::boolean, false)),
        v_t || jsonb_build_object('deliverable_title', d.v->>'title')
      from jsonb_array_elements(coalesce(p_content->'deliverables', '[]')) with ordinality d(v, o);
    else
      return query select 'taak', i * 100, v_t->>'title', v_t->>'phase', v_t->>'anchor', (v_t->>'offset')::int,
        coalesce((v_t->>'calendar')::boolean, false),
        anchor_deadline(case v_t->>'anchor' when 'S' then p_s when 'D' then p_d when 'L' then v_l end, (v_t->>'offset')::int,
                        coalesce((v_t->>'calendar')::boolean, false)), v_t;
    end if;
  end loop;
end $$;

create function public.template_preview(p_version uuid, p_anchor_d date, p_anchor_s date)
returns table(kind text, ord int, title text, phase text, anchor text, anchor_offset int, due date, extra jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v template_version%rowtype;
begin
  select * into v from template_version where id = p_version;
  perform require(v.id is not null and org_has_role((select organization_id from template where id = v.template_id), internal_roles()), 'Onbekende template.');
  return query select x.kind, x.ord, x.title, x.phase, x.anchor, x.anchor_offset, x.due, x.extra
    from template_plan(v.content, coalesce(p_anchor_d, p_anchor_s), coalesce(p_anchor_s, today_ams())) x order by 1, 2;
end $$;

-- AU1: records uit template aanmaken. Idempotentiesleutel = project-ID + templateversie.
create function public.apply_template(p_project uuid, p_version uuid, p_anchor_d date, p_anchor_s date)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p project%rowtype; v template_version%rowtype; v_run uuid; x record; v_id uuid; v_parent uuid; v_sub jsonb;
  v_deliv jsonb := '{}'; v_count int := 0;
begin
  select * into p from project where id = p_project;
  select * into v from template_version where id = p_version;
  perform require(v.id is not null and (select organization_id from template where id = v.template_id) = ws_org(p.workspace_id), 'Onbekende template.');
  select id into v_run from automation_run where kind = 'AU1' and idem_key = p_project || ':' || p_version and status <> 'duplicaat';
  if v_run is not null then
    insert into automation_run(workspace_id, project_id, kind, idem_key, status, summary)
    values (p.workspace_id, p_project, 'AU1', p_project || ':' || p_version, 'duplicaat', 'Template was al toegepast; niets dubbel aangemaakt.');
    return v_run;
  end if;
  insert into automation_run(workspace_id, project_id, kind, idem_key, trigger)
  values (p.workspace_id, p_project, 'AU1', p_project || ':' || p_version, 'project aangemaakt met template') returning id into v_run;
  perform set_config('regie.automation', 'aan', true);

  update project set template_version_id = p_version, start_date = coalesce(p_anchor_s, start_date) where id = p_project;
  if v.content ? 'freelancers_betaald' then
    update milestone set applicable = coalesce((v.content->>'freelancers_betaald')::boolean, true)
    where project_id = p_project and kind = 'freelancers_betaald';
  end if;
  if coalesce((v.content->>'no_shoot')::boolean, false) then
    update project set production_applicable = false where id = p_project;
  end if;

  for x in select * from template_plan(v.content, coalesce(p_anchor_d, p_anchor_s, today_ams()), coalesce(p_anchor_s, today_ams())) t order by t.kind, t.ord loop
    v_count := v_count + 1;
    if x.kind = 'draaidag' then
      insert into shoot_day(project_id, title, date, status, automation_run_id)
      values (p_project, x.title, x.due, 'optie', v_run);
    elsif x.kind = 'deliverable' then
      insert into deliverable(project_id, title, kind, format, aspect_ratio, duration_text, language, channel, group_label,
                              feedback_rounds_agreed, sort, automation_run_id)
      values (p_project, x.title, x.extra->>'kind', x.extra->>'format', x.extra->>'aspect_ratio', x.extra->>'duration',
              x.extra->>'language', x.extra->>'channel', x.extra->>'group', nullif(x.extra->>'feedback_rounds', '')::int, x.ord, v_run)
      returning id into v_id;
      v_deliv := v_deliv || jsonb_build_object(x.title, v_id);
    else
      insert into task(workspace_id, project_id, title, description, phase_group, anchor, anchor_offset, anchor_calendar,
                       deadline, sort, automation_run_id, template_key)
      values (p.workspace_id, p_project, x.title, x.extra->>'description', x.phase, x.anchor, x.anchor_offset, x.anchor_calendar,
              x.due, x.ord, v_run, x.extra->>'key')
      returning id into v_parent;
      if x.extra ? 'deliverable_title' and v_deliv ? (x.extra->>'deliverable_title') then
        insert into task_deliverable(task_id, deliverable_id) values (v_parent, (v_deliv->>(x.extra->>'deliverable_title'))::uuid);
      end if;
      for v_sub in select * from jsonb_array_elements(coalesce(x.extra->'subtasks', '[]')) loop
        insert into task(workspace_id, project_id, parent_id, title, phase_group, sort, automation_run_id)
        values (p.workspace_id, p_project, v_parent, v_sub->>'title', x.phase, x.ord, v_run);
      end loop;
    end if;
  end loop;
  perform set_config('regie.automation', '', true);
  update automation_run set summary = v_count || ' onderdelen aangemaakt uit template.', result = jsonb_build_object('count', v_count)
  where id = v_run;
  return v_run;
end $$;
revoke execute on function public.apply_template(uuid, uuid, date, date) from authenticated;

-- Project aanmaken vanuit het register (+ optioneel template). Idempotent via operatie-ID.
create function public.create_project_from_number(
  p_number uuid, p_name text, p_client_org_id uuid default null, p_client_name text default null,
  p_contact_person_id uuid default null, p_manager_person_id uuid default null, p_template_version uuid default null,
  p_anchor_d date default null, p_anchor_s date default null, p_no_shoot boolean default false,
  p_briefing text default null, p_op uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare n project_number%rowtype; v_ws uuid; v_project uuid; v_client uuid := p_client_org_id; v_res jsonb;
begin
  if p_op is not null then
    select result into v_res from operation where id = p_op;
    if found then return (v_res->>'project_id')::uuid; end if;
  end if;
  select * into n from project_number where id = p_number for update;
  perform require(n.id is not null and n.kind = 'primair', 'Onbekend nummer.');
  v_ws := org_ws(n.organization_id);
  perform require(my_role(v_ws) in ('eigenaar','admin','projectmanager','medewerker'), 'Je mag geen projecten aanmaken.');
  perform require(n.project_id is null, 'Aan dit nummer hangt al een project.');
  perform require(n.status in ('gereserveerd','pitch','offerte','losse_klus'), 'Dit nummer is ' || replace(n.status::text, '_', ' ') || ' en kan geen project krijgen.');
  perform require(n.company is not null and n.year is not null, 'Nummer zonder bedrijf of jaar.');
  if v_client is null and nullif(btrim(p_client_name), '') is not null then
    select id into v_client from client_org where organization_id = n.organization_id and lower(name) = lower(btrim(p_client_name)) limit 1;
    if v_client is null then insert into client_org(organization_id, name) values (n.organization_id, btrim(p_client_name)) returning id into v_client; end if;
  end if;
  v_client := coalesce(v_client, n.client_org_id);
  insert into project(workspace_id, company, year, name, client_org_id, manager_person_id, contact_person_id, briefing,
                      production_applicable, start_date)
  values (v_ws, n.company, n.year, coalesce(nullif(btrim(p_name), ''), n.name, n.number_display), v_client, p_manager_person_id,
          p_contact_person_id, p_briefing, not p_no_shoot, coalesce(p_anchor_s, today_ams()))
  returning id into v_project;
  insert into project_member(project_id, user_id) values (v_project, auth.uid()) on conflict do nothing;
  update project_number set project_id = v_project, status = 'project', name = coalesce(name, nullif(btrim(p_name), '')),
    client_org_id = coalesce(client_org_id, v_client) where id = p_number;
  update milestone set checked_at = now(), checked_by = auth.uid() where project_id = v_project and kind = 'offerte_akkoord';
  if p_template_version is not null then
    perform apply_template(v_project, p_template_version, p_anchor_d, p_anchor_s);
  end if;
  perform evaluate_phase(v_project);
  if p_op is not null then
    insert into operation(id, user_id, kind, result) values (p_op, auth.uid(), 'create_project', jsonb_build_object('project_id', v_project));
  end if;
  return v_project;
end $$;

-- Template beheren (eigenaar, admin, PM). Een nieuwe versie wijzigt bestaande projecten niet.
create function public.save_template(p_ws uuid, p_template uuid, p_name text, p_company public.bedrijf, p_description text, p_content jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t uuid := p_template; v_no int; v_id uuid;
begin
  perform require(my_role(p_ws) in ('eigenaar','admin','projectmanager'), 'Alleen eigenaar, admin of projectmanager beheert templates.');
  if v_t is null then
    insert into template(organization_id, name, company, description) values (ws_org(p_ws), btrim(p_name), p_company, p_description)
    returning id into v_t;
  else
    perform require((select organization_id from template where id = v_t) = ws_org(p_ws), 'Onbekende template.');
    update template set name = btrim(p_name), company = p_company, description = p_description where id = v_t;
  end if;
  select coalesce(max(version_no), 0) + 1 into v_no from template_version where template_id = v_t;
  insert into template_version(template_id, version_no, content) values (v_t, v_no, p_content) returning id into v_id;
  return v_id;
end $$;

create function public.set_template_archived(p_template uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(org_has_role((select organization_id from template where id = p_template), '{eigenaar,admin,projectmanager}'),
                  'Alleen eigenaar, admin of projectmanager beheert templates.');
  update template set archived = p_archived where id = p_template;
end $$;

-- Project als template opslaan: relatieve deadlines t.o.v. de ankers van het project.
create function public.project_as_template_content(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_d date; v_l date; v_s date; v jsonb;
begin
  perform require(can_manage_project(p_project), 'Alleen eigenaar, admin of projectmanager maakt templates.');
  select min(date), max(date) into v_d, v_l from shoot_day where project_id = p_project and deleted_at is null and status <> 'geannuleerd';
  select start_date into v_s from project where id = p_project;
  select jsonb_build_object(
    'freelancers_betaald', (select applicable from milestone where project_id = p_project and kind = 'freelancers_betaald'),
    'no_shoot', not (select production_applicable from project where id = p_project),
    'shoot_days', coalesce((select jsonb_agg(jsonb_build_object('title', coalesce(title, 'Draaidag'), 'offset_days', date - v_d) order by date)
                            from shoot_day where project_id = p_project and deleted_at is null and status <> 'geannuleerd'), '[]'),
    'deliverables', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('title', title, 'kind', kind, 'format', format,
                              'aspect_ratio', aspect_ratio, 'duration', duration_text, 'language', language, 'channel', channel,
                              'group', group_label, 'feedback_rounds', feedback_rounds_agreed)) order by sort, title)
                              from deliverable where project_id = p_project and deleted_at is null and status <> 'vervallen'), '[]'),
    'tasks', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('title', t.title, 'phase', t.phase_group,
                         'anchor', t.anchor, 'offset', t.anchor_offset, 'calendar', case when t.anchor_calendar then true end,
                         'subtasks', (select jsonb_agg(jsonb_build_object('title', s.title)) from task s where s.parent_id = t.id and s.deleted_at is null)))
                         order by t.sort, t.created_at)
                       from task t where t.project_id = p_project and t.parent_id is null and t.deleted_at is null), '[]'))
  into v;
  return v;
end $$;

-- ───────────────────────── AU2: draaidag verschoven → ankertaken herberekenen ─────────────────────────
create function public.recalc_anchor_tasks(p_project uuid, p_trigger text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare p project%rowtype; v_d date; v_l date; v_run uuid; v_changes jsonb := '[]'; r record; v_new date;
begin
  select * into p from project where id = p_project;
  if not p.automation_enabled or p.archived then return null; end if;
  select min(date), max(date) into v_d, v_l from shoot_day
   where project_id = p_project and deleted_at is null and status <> 'geannuleerd';
  for r in select * from task where project_id = p_project and deleted_at is null and anchor in ('D','L','S')
           and not deadline_manual and status not in ('klaar','vervallen') loop
    v_new := anchor_deadline(case r.anchor when 'D' then v_d when 'L' then v_l else p.start_date end, r.anchor_offset, r.anchor_calendar);
    if v_new is distinct from r.deadline then
      v_changes := v_changes || jsonb_build_object('task_id', r.id, 'title', r.title, 'old', r.deadline, 'new', v_new);
    end if;
  end loop;
  if jsonb_array_length(v_changes) = 0 then return null; end if;
  insert into automation_run(workspace_id, project_id, kind, idem_key, trigger, summary, undo_data)
  values (p.workspace_id, p_project, 'AU2', p_project || ':' || clock_timestamp(), p_trigger,
          jsonb_array_length(v_changes) || ' taakdeadline(s) verschoven', v_changes)
  returning id into v_run;
  perform set_config('regie.automation', 'aan', true);
  update task t set deadline = (c->>'new')::date from jsonb_array_elements(v_changes) c where t.id = (c->>'task_id')::uuid;
  perform set_config('regie.automation', '', true);
  return v_run;
end $$;
revoke execute on function public.recalc_anchor_tasks(uuid, text) from authenticated;

create function public.tg_shoot_day_moved() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_crew int;
begin
  if tg_op = 'UPDATE' and (new.date is distinct from old.date or new.status is distinct from old.status
                           or new.deleted_at is distinct from old.deleted_at)
     or tg_op = 'INSERT' and new.automation_run_id is null then
    perform recalc_anchor_tasks(new.project_id,
      case when tg_op = 'INSERT' then 'draaidag toegevoegd' else 'draaidag ' || to_char(old.date, 'DD-MM-YYYY') || ' gewijzigd' end);
  end if;
  if tg_op = 'UPDATE' and new.date is distinct from old.date then
    select count(*) into v_crew from assignment where shoot_day_id = new.id and status in ('optie','bevestigd');
    if v_crew > 0 then
      perform notify_project_manager(new.project_id, 'crew_controleren',
        'Draaidag verplaatst van ' || to_char(old.date, 'DD-MM-YYYY') || ' naar ' || to_char(new.date, 'DD-MM-YYYY')
        || ': controleer ' || v_crew || ' crewboeking(en). Crew wordt niet automatisch bericht.',
        'verplaatst:' || new.id || ':' || new.date);
    end if;
  end if;
  return null;
end $$;
create trigger moved after insert or update on public.shoot_day for each row execute function public.tg_shoot_day_moved();

-- Ongedaan maken: AU1 binnen 24 uur (alleen onaangeroerde onderdelen), AU2 (alleen ongewijzigde deadlines).
create function public.undo_automation(p_run uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare a automation_run%rowtype; v_n int := 0; v_kept int := 0; c jsonb;
begin
  select * into a from automation_run where id = p_run for update;
  perform require(a.id is not null, 'Onbekende automatisering.');
  perform require(can_manage_project(a.project_id), 'Alleen eigenaar, admin of projectmanager maakt automatiseringen ongedaan.');
  perform require(a.status = 'ok' and a.undone_at is null, 'Deze automatisering is al ongedaan gemaakt of niet ongedaan te maken.');
  perform set_config('regie.reason', 'Automatisering ' || a.kind || ' ongedaan gemaakt', true);
  if a.kind = 'AU1' then
    perform require(a.created_at > now() - interval '24 hours', 'Een template ongedaan maken kan alleen binnen 24 uur.');
    update task set deleted_at = now(), deleted_by = auth.uid() where automation_run_id = p_run and deleted_at is null and revision = 1;
    get diagnostics v_n = row_count;
    update deliverable set deleted_at = now(), deleted_by = auth.uid() where automation_run_id = p_run and deleted_at is null and revision = 1
      and not exists (select 1 from deliverable_version where deliverable_id = deliverable.id);
    get diagnostics v_kept = row_count; v_n := v_n + v_kept;
    update shoot_day set deleted_at = now(), deleted_by = auth.uid() where automation_run_id = p_run and deleted_at is null and revision = 1;
    get diagnostics v_kept = row_count; v_n := v_n + v_kept;
    select (select count(*) from task where automation_run_id = p_run and deleted_at is null)
         + (select count(*) from deliverable where automation_run_id = p_run and deleted_at is null)
         + (select count(*) from shoot_day where automation_run_id = p_run and deleted_at is null) into v_kept;
  elsif a.kind = 'AU2' then
    perform set_config('regie.automation', 'aan', true);
    for c in select * from jsonb_array_elements(a.undo_data) loop
      update task set deadline = (c->>'old')::date where id = (c->>'task_id')::uuid and deadline is not distinct from (c->>'new')::date;
      if found then v_n := v_n + 1; else v_kept := v_kept + 1; end if;
    end loop;
    perform set_config('regie.automation', '', true);
  else
    raise exception 'Deze automatisering kan niet ongedaan worden gemaakt.';
  end if;
  update automation_run set status = 'ongedaan', undone_at = now(), undone_by = auth.uid() where id = p_run;
  perform evaluate_phase(a.project_id);
  return v_n || ' teruggedraaid' || case when v_kept > 0 then ', ' || v_kept || ' blijven staan (intussen gewijzigd)' else '' end;
end $$;

-- ───────────────────────── Versies, goedkeuring (AU3) en meerwerk (AU4) ─────────────────────────
create or replace function public.add_version(p_deliverable uuid, p_file_ref text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare d deliverable%rowtype; v_no int; v_id uuid; v_round int;
begin
  select * into d from deliverable where id = p_deliverable and deleted_at is null for update;
  perform require(d.id is not null and can_edit_project(d.project_id), 'Je mag geen versies toevoegen.');
  perform require(d.status <> 'vervallen', 'Deze deliverable is geannuleerd.');
  select coalesce(max(version_no), 0) + 1 into v_no from deliverable_version where deliverable_id = p_deliverable;
  select count(*) + 1 into v_round from deliverable_version where deliverable_id = p_deliverable and status <> 'concept';
  insert into deliverable_version(deliverable_id, version_no, file_ref, note, status, feedback_round)
  values (p_deliverable, v_no, nullif(btrim(p_file_ref), ''), p_note, 'in_review', v_round) returning id into v_id;
  -- Een nieuwe versie na goedkeuring zet de deliverable terug op review; de oude goedkeuring blijft historie.
  if d.status in ('goedgekeurd','geleverd') then
    update deliverable set status = 'in_review', required_version_id = v_id, delivered_at = null where id = d.id;
    perform notify_project_manager(d.project_id, 'review_na_goedkeuring',
      'Nieuwe versie v' || v_no || ' van "' || d.title || '" na goedkeuring: weer in review.', 'naakkoord:' || v_id);
  elsif d.status in ('gepland','in_uitvoering','wijzigingen_nodig') then
    update deliverable set status = 'in_review', required_version_id = v_id where id = d.id;
  else
    update deliverable set required_version_id = v_id where id = d.id;
  end if;
  if d.feedback_rounds_agreed is not null and v_round > d.feedback_rounds_agreed then
    perform notify_project_manager(d.project_id, 'meerwerk',
      'Mogelijk meerwerk: "' || d.title || '" is in feedbackronde ' || v_round || ' (afgesproken: ' || d.feedback_rounds_agreed || ').',
      'meerwerk:' || d.id || ':' || v_round);
  end if;
  return v_id;
end $$;

create function public.set_version_status(p_version uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v deliverable_version%rowtype; d deliverable%rowtype;
begin
  select * into v from deliverable_version where id = p_version;
  select * into d from deliverable where id = v.deliverable_id for update;
  perform require(can_edit_project(d.project_id), 'Je mag de versiestatus niet wijzigen.');
  perform require(p_status in ('concept','in_review','feedback_ontvangen'), 'Goedkeuren gaat via "Goedkeuring vastleggen".');
  perform require(v.status not in ('goedgekeurd','vervangen'), 'Een goedgekeurde of vervangen versie verandert niet meer.');
  update deliverable_version set status = p_status where id = p_version;
  if p_status = 'feedback_ontvangen' and d.status = 'in_review' and d.required_version_id = p_version then
    update deliverable set status = 'wijzigingen_nodig' where id = d.id;
  end if;
end $$;

-- Interne goedkeuring, ook gebruikt door de reviewtool-koppeling.
create function public.approve_version_internal(p_version uuid, p_approved_by_name text, p_approved_at timestamptz,
  p_evidence text, p_source text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v deliverable_version%rowtype; d deliverable%rowtype; v_id uuid;
begin
  select * into v from deliverable_version where id = p_version;
  perform require(v.id is not null, 'Onbekende versie.');
  select * into d from deliverable where id = v.deliverable_id for update;
  perform require(d.status not in ('vervallen','geleverd') and d.deleted_at is null, 'Deze deliverable is geannuleerd of al opgeleverd.');
  perform require(not exists (select 1 from deliverable_version where deliverable_id = d.id and version_no > v.version_no),
    'Er bestaat al een nieuwere versie. Een goedkeuring geldt alleen voor precies één versie.');
  perform require(v.status <> 'vervangen', 'Deze versie is vervangen.');
  insert into approval(deliverable_id, version_id, approved_by_name, approved_at, evidence, source)
  values (d.id, p_version, btrim(p_approved_by_name), p_approved_at, btrim(p_evidence), p_source) returning id into v_id;
  update deliverable_version set status = 'goedgekeurd' where id = p_version;
  update deliverable_version set status = 'vervangen' where deliverable_id = d.id and id <> p_version
    and status in ('concept','in_review','feedback_ontvangen');
  update deliverable set required_version_id = p_version, status = 'goedgekeurd' where id = d.id;
  insert into decision(project_id, kind, subject, deliverable_id, version_id, taken_by_name, decided_on, evidence, approval_id, source)
  values (d.project_id, 'goedkeuring_versie', 'Goedkeuring ' || d.title || ' v' || v.version_no, d.id, p_version,
          btrim(p_approved_by_name), (p_approved_at at time zone 'Europe/Amsterdam')::date, btrim(p_evidence), v_id, p_source);
  return v_id;
end $$;
revoke execute on function public.approve_version_internal(uuid, text, timestamptz, text, text) from authenticated;

create or replace function public.register_approval(p_version uuid, p_approved_by_name text, p_approved_at timestamptz, p_evidence text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid;
begin
  select d.project_id into v_project from deliverable_version v join deliverable d on d.id = v.deliverable_id where v.id = p_version;
  perform require(can_approve_project(v_project), 'Je mag geen goedkeuring vastleggen.');
  return approve_version_internal(p_version, p_approved_by_name, p_approved_at, p_evidence, 'geregistreerd_door_medewerker');
end $$;

-- Een goedkeuring intrekken maakt een nieuw (correctie)besluit; het oude besluit blijft ongewijzigd.
create or replace function public.revoke_approval(p_approval uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a approval%rowtype; d deliverable%rowtype; v_dec uuid;
begin
  select * into a from approval where id = p_approval;
  select * into d from deliverable where id = a.deliverable_id for update;
  perform require(can_manage_project(d.project_id), 'Je mag geen goedkeuring intrekken.');
  perform require(length(btrim(coalesce(p_reason,''))) > 0, 'Geef een reden.');
  perform require(a.revoked_at is null, 'Deze goedkeuring is al ingetrokken.');
  perform set_config('regie.reason', p_reason, true);
  update approval set revoked_at = now(), revoked_by = auth.uid(), revoked_reason = p_reason where id = p_approval;
  update deliverable_version set status = 'in_review' where id = a.version_id;
  if d.status in ('goedgekeurd','geleverd') and not exists (
      select 1 from approval where version_id = d.required_version_id and revoked_at is null) then
    update deliverable set status = 'in_review', delivered_at = null where id = d.id;
  end if;
  select id into v_dec from decision where approval_id = p_approval;
  insert into decision(project_id, kind, subject, deliverable_id, version_id, decided_on, evidence, corrects_id)
  values (d.project_id, 'overig', 'Goedkeuring ingetrokken: ' || d.title, d.id, a.version_id, today_ams(), btrim(p_reason), v_dec);
end $$;

create or replace function public.mark_delivered(p_deliverable uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d deliverable%rowtype;
begin
  select * into d from deliverable where id = p_deliverable for update;
  perform require(can_approve_project(d.project_id), 'Je mag geen oplevering registreren.');
  perform require(d.status = 'goedgekeurd', 'Alleen een goedgekeurde deliverable kan als opgeleverd worden gemarkeerd.');
  update deliverable set status = 'geleverd', delivered_at = now() where id = d.id;
end $$;

-- ───────────────────────── AU6: dubbele boekingen ─────────────────────────
create function public.booking_conflicts(p_person uuid, p_date date, p_exclude_shoot_day uuid default null)
returns table(shoot_day_id uuid, project_id uuid, project_label text, date date, role_label text, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.project_id,
         coalesce((select number_display || ' | ' from project_number where project_id = p.id and kind = 'primair'), '') || p.name,
         s.date, a.role_label, a.status::text
  from assignment a join shoot_day s on s.id = a.shoot_day_id join project p on p.id = s.project_id
  where a.person_id = p_person and s.date = p_date and s.deleted_at is null and s.status <> 'geannuleerd'
    and a.status in ('optie','bevestigd') and (p_exclude_shoot_day is null or s.id <> p_exclude_shoot_day)
    and can_view_project(p.id)
$$;

-- ───────────────────────── Afgeleide status per project ─────────────────────────
create function public.project_status(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p project%rowtype; c record; v_risk text := 'op_schema'; v_reasons text[] := '{}'; v_block jsonb; v_fin jsonb := null;
  v_today date := today_ams(); v_soon date := add_workdays(today_ams(), 2); n int;
begin
  perform require(can_view_project(p_project), 'Geen toegang.');
  select * into p from project where id = p_project;
  select * into c from compute_phase(p_project);

  -- Blokkades: back-up ontbreekt, apparatuur niet terug, dubbele boekingen.
  select coalesce(jsonb_agg(b), '[]') into v_block from (
    select jsonb_build_object('type', 'backup', 'object_type', 'shoot_day', 'object_id', s.id,
           'text', 'Back-up ' || concat_ws(' en ', case when s.backup_ssd_at is null then 'SSD' end, case when s.backup_hdd_at is null then 'HDD' end)
                   || ' ontbreekt (draaidag ' || to_char(s.date, 'DD-MM-YYYY') || ')') b
    from shoot_day s where s.project_id = p_project and s.deleted_at is null and s.status = 'bevestigd'
      and shoot_end(s) <= now() and (s.backup_ssd_at is null or s.backup_hdd_at is null)
    union all
    select jsonb_build_object('type', 'apparatuur', 'object_type', 'shoot_day', 'object_id', s.id,
           'text', count(*) || ' apparatuurregel(s) niet teruggebracht (draaidag ' || to_char(s.date, 'DD-MM-YYYY') || ')')
    from equipment_item e join shoot_day s on s.id = e.shoot_day_id
    where e.project_id = p_project and e.deleted_at is null and not e.returned and s.deleted_at is null
      and s.status <> 'geannuleerd' and shoot_end(s) <= now()
    group by s.id, s.date
    union all
    select jsonb_build_object('type', 'dubbel', 'object_type', 'shoot_day', 'object_id', s.id,
           'text', pe.full_name || ' staat op ' || to_char(s.date, 'DD-MM-YYYY') || ' ook elders ingeboekt')
    from assignment a join shoot_day s on s.id = a.shoot_day_id join person pe on pe.id = a.person_id
    where a.project_id = p_project and s.deleted_at is null and s.status <> 'geannuleerd' and a.status in ('optie','bevestigd')
      and exists (select 1 from assignment a2 join shoot_day s2 on s2.id = a2.shoot_day_id
                  where a2.person_id = a.person_id and s2.date = s.date and s2.id <> s.id and s2.deleted_at is null
                    and s2.status <> 'geannuleerd' and a2.status in ('optie','bevestigd'))
  ) x;

  -- Planningsrisico.
  select count(*) into n from (
    select 1 from task where project_id = p_project and deleted_at is null and status not in ('klaar','vervallen') and deadline < v_today
    union all select 1 from deliverable where project_id = p_project and deleted_at is null
      and status not in ('geleverd','vervallen','goedgekeurd') and deadline < v_today) t;
  if n > 0 then v_risk := 'te_laat'; v_reasons := v_reasons || (n || ' deadline(s) verstreken')::text; end if;
  select count(*) into n from (
    select 1 from task where project_id = p_project and deleted_at is null and status not in ('klaar','vervallen') and deadline between v_today and v_soon
    union all select 1 from deliverable where project_id = p_project and deleted_at is null
      and status not in ('geleverd','vervallen','goedgekeurd') and deadline between v_today and v_soon) t;
  if n > 0 then v_reasons := v_reasons || (n || ' deadline(s) binnen 2 werkdagen, nog niet klaar')::text; end if;
  select count(*) into n from shoot_day s where s.project_id = p_project and s.deleted_at is null and s.status not in ('geannuleerd')
    and s.date between v_today and v_today + 2 and (s.status <> 'bevestigd'
      or exists (select 1 from assignment a where a.shoot_day_id = s.id and a.status = 'optie'));
  if n > 0 then v_reasons := v_reasons || (n || ' draaidag(en) binnen 2 dagen met onbevestigde crew of status')::text; end if;
  if exists (select 1 from jsonb_array_elements(v_block) b where b->>'type' = 'backup') then
    v_reasons := v_reasons || 'Back-up ontbreekt na draaidag'::text;
  end if;
  if v_risk <> 'te_laat' and array_length(v_reasons, 1) > 0 then v_risk := 'risico'; end if;

  if has_finance(p.workspace_id) then
    select jsonb_build_object(
      'status', case when bool_or(kind = 'betaling_ontvangen' and checked_at is not null) then 'betaald'
                     when bool_or(kind = 'gefactureerd' and checked_at is not null) then 'gefactureerd' else 'nog_niet_gefactureerd' end,
      'freelancers_betaald', bool_or(kind = 'freelancers_betaald' and checked_at is not null),
      'freelancers_van_toepassing', bool_or(kind = 'freelancers_betaald' and applicable))
    into v_fin from milestone where project_id = p_project;
  end if;

  return jsonb_build_object(
    'phase', p.phase, 'phase_mode', p.phase_mode, 'phase_suggested', c.phase, 'phase_reason', p.phase_reason,
    'auto_reason', c.reason, 'waiting', to_jsonb(c.waiting), 'blockers', v_block,
    'risk', v_risk, 'risk_reasons', to_jsonb(v_reasons), 'finance', v_fin,
    'operational_done_at', p.operational_done_at, 'admin_done_at', p.admin_done_at,
    'deliverables', (select jsonb_build_object('totaal', count(*), 'opgeleverd', count(*) filter (where status = 'geleverd'),
                       'in_review', count(*) filter (where status = 'in_review'))
                     from deliverable where project_id = p_project and deleted_at is null and status <> 'vervallen'),
    'shoot_days', (select jsonb_build_object('totaal', count(*), 'voorbij', count(*) filter (where shoot_end(s) <= now()),
                     'bevestigd', count(*) filter (where status = 'bevestigd'))
                   from shoot_day s where project_id = p_project and deleted_at is null and status <> 'geannuleerd'));
end $$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.automation_run enable row level security;
alter table public.notification enable row level security;
alter table public.notification_pref enable row level security;
alter table public.template enable row level security;
alter table public.template_version enable row level security;

create policy sel on public.automation_run for select to authenticated
  using (public.is_internal(workspace_id) and (project_id is null or public.can_view_project(project_id)));
create policy sel on public.notification for select to authenticated using (user_id = auth.uid());
create policy sel on public.notification_pref for select to authenticated using (user_id = auth.uid());
create policy ins on public.notification_pref for insert to authenticated with check (user_id = auth.uid());
create policy upd on public.notification_pref for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sel on public.template for select to authenticated using (public.org_has_role(organization_id, public.internal_roles()));
create policy sel on public.template_version for select to authenticated
  using (exists (select 1 from public.template t where t.id = template_id));

do $$
declare t text;
begin
  foreach t in array array['template','template_version'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
  end loop;
end $$;

revoke all on public.automation_run, public.notification, public.notification_pref, public.template, public.template_version from anon;
revoke insert, update, delete on public.automation_run, public.notification, public.template, public.template_version from authenticated;
revoke delete on public.notification_pref from authenticated;
