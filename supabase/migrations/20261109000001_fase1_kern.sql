-- Regie · fase 1 · kernmodel, rechten (RLS) en servermatige handelingen
-- Ontwerpregels: UUID-sleutels; projectnummer nooit als foreign key; kritische
-- handelingen alleen via security-definer-functies; rechten in de database.

-- ───────────────────────── Typen ─────────────────────────
create type public.app_role as enum ('eigenaar','admin','projectmanager','medewerker','stagiair','freelancer','klant');
create type public.bedrijf as enum ('studio_brutaal','moviemates');
create type public.project_lifecycle as enum ('actief','gepauzeerd','operationeel_afgerond','geannuleerd');
create type public.admin_status as enum ('niet_beoordeeld','open','afgerond','niet_van_toepassing');
create type public.workflow_kind as enum ('film','eenvoudig');
create type public.task_status as enum ('te_doen','bezig','geblokkeerd','klaar','vervallen');
create type public.deliverable_status as enum ('gepland','in_uitvoering','in_review','wijzigingen_nodig','goedgekeurd','geleverd','vervallen');
create type public.scope_status as enum ('overeengekomen','voorgesteld','afgewezen');
create type public.shoot_status as enum ('gepland','in_uitvoering','uitgevoerd','geannuleerd');
create type public.assignment_status as enum ('optie','bevestigd','geweigerd','geannuleerd');
create type public.number_kind as enum ('primair','alias');

-- ───────────────────────── Tabellen ─────────────────────────
create table public.organization (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  is_test boolean not null default false,   -- testdata is technisch gescheiden van echte data
  created_at timestamptz not null default now()
);

create table public.workspace (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.membership (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspace(id),
  user_id uuid not null references auth.users(id),
  role public.app_role not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (workspace_id, user_id)
);

create table public.person (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  full_name text not null check (length(btrim(full_name)) > 0),
  roles text[] not null default '{}',          -- vakrollen, bijv. {editor,camera}
  user_id uuid unique references auth.users(id), -- optioneel: persoon zonder account kan
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- Contactgegevens apart, zodat beperkte rollen namen wél en contactgegevens níet zien.
create table public.person_contact (
  person_id uuid primary key references public.person(id),
  email text,
  phone text,
  updated_at timestamptz not null default now()
);

create table public.client_org (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.project (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspace(id),
  company public.bedrijf not null,
  year int not null check (year between 2000 and 2100),
  name text not null check (length(btrim(name)) > 0),
  client_org_id uuid references public.client_org(id),
  manager_person_id uuid references public.person(id),
  briefing text,
  agreements text,
  workflow public.workflow_kind not null default 'film',
  production_applicable boolean not null default true,
  lifecycle public.project_lifecycle not null default 'actief',
  lifecycle_reason text,
  archived boolean not null default false,
  closed_at timestamptz,
  closed_by uuid,
  admin_status public.admin_status not null default 'niet_beoordeeld',
  adm_factuur_verstuurd boolean not null default false,
  adm_betaling_ontvangen boolean not null default false,
  adm_freelancers_betaald boolean not null default false,
  adm_overig_afgerond boolean not null default false,
  adm_checked_at timestamptz,
  adm_checked_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  revision int not null default 1
);

create table public.project_member (
  project_id uuid not null references public.project(id),
  user_id uuid not null references auth.users(id),
  added_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Blijvend nummerregister: nummers worden nooit verwijderd of hergebruikt.
create table public.project_number (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  project_id uuid not null references public.project(id),
  number_display text not null check (length(btrim(number_display)) between 1 and 40),
  number_key text generated always as (upper(regexp_replace(number_display, '\s', '', 'g'))) stored,
  kind public.number_kind not null default 'primair',
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (organization_id, number_key)
);
create unique index project_number_een_primair on public.project_number(project_id) where kind = 'primair';

create table public.deliverable (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project(id),
  parent_id uuid,
  title text not null check (length(btrim(title)) > 0),
  kind text,
  format text,
  aspect_ratio text,
  duration_text text,
  language text,
  channel text,
  deadline date,
  status public.deliverable_status not null default 'gepland',
  status_reason text,
  scope public.scope_status not null default 'overeengekomen',
  required_version_id uuid,
  feedback_rounds_agreed int check (feedback_rounds_agreed >= 0),
  delivered_at timestamptz,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision int not null default 1,
  unique (id, project_id),
  foreign key (parent_id, project_id) references public.deliverable(id, project_id),
  check (parent_id is null or parent_id <> id),
  check (status <> 'vervallen' or length(btrim(coalesce(status_reason,''))) > 0)
);

create table public.deliverable_version (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverable(id),
  version_no int not null check (version_no > 0),
  file_ref text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (deliverable_id, version_no),
  unique (id, deliverable_id)
);
alter table public.deliverable
  add constraint deliverable_required_version_fk
  foreign key (required_version_id, id) references public.deliverable_version(id, deliverable_id)
  deferrable initially deferred;

create table public.approval (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references public.deliverable(id),
  version_id uuid not null,
  source text not null default 'geregistreerd_door_medewerker' check (source in ('geregistreerd_door_medewerker')),
  approved_by_name text not null check (length(btrim(approved_by_name)) > 0),
  approved_at timestamptz not null,
  evidence text not null check (length(btrim(evidence)) > 0),
  registered_by uuid not null default auth.uid(),
  registered_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text,
  foreign key (version_id, deliverable_id) references public.deliverable_version(id, deliverable_id)
);

create table public.shoot_day (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project(id),
  title text,
  date date not null,
  start_time time,
  end_time time,
  timezone text not null default 'Europe/Amsterdam',
  location text,
  status public.shoot_status not null default 'gepland',
  status_reason text,
  executed_confirmed_by uuid,
  executed_confirmed_at timestamptz,
  backup_confirmed_at timestamptz,
  backup_confirmed_by uuid,
  callsheet_note text,
  equipment_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision int not null default 1,
  unique (id, project_id),
  check (status <> 'geannuleerd' or length(btrim(coalesce(status_reason,''))) > 0)
);

create table public.assignment (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project(id),
  person_id uuid not null references public.person(id),
  role_label text not null default 'crew',
  shoot_day_id uuid,
  deliverable_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.assignment_status not null default 'optie',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision int not null default 1,
  foreign key (shoot_day_id, project_id) references public.shoot_day(id, project_id),
  foreign key (deliverable_id, project_id) references public.deliverable(id, project_id),
  check (num_nonnulls(shoot_day_id, deliverable_id) = 1),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.task (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspace(id),
  project_id uuid references public.project(id),
  parent_id uuid references public.task(id),
  title text not null check (length(btrim(title)) > 0),
  description text,
  assignee_person_id uuid references public.person(id),
  deadline date,
  priority smallint not null default 2 check (priority between 1 and 3),
  status public.task_status not null default 'te_doen',
  required_for_close boolean not null default false,
  shoot_day_id uuid references public.shoot_day(id),
  completed_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision int not null default 1,
  check (parent_id is null or parent_id <> id)
);

create table public.task_deliverable (
  task_id uuid not null references public.task(id),
  deliverable_id uuid not null references public.deliverable(id),
  primary key (task_id, deliverable_id)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid,
  project_id uuid,
  actor uuid,
  action text not null,
  table_name text not null,
  row_key text,
  changes jsonb,
  reason text,
  at timestamptz not null default now()
);

create index on public.membership(user_id);
create index on public.project(workspace_id);
create index on public.project_number(project_id);
create index on public.deliverable(project_id);
create index on public.shoot_day(project_id, date);
create index on public.assignment(project_id);
create index on public.assignment(person_id);
create index on public.task(project_id);
create index on public.task(assignee_person_id);
create index on public.audit_log(project_id, at);

-- ───────────────────────── Rechtenhelpers ─────────────────────────
create function public.my_role(p_ws uuid) returns public.app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from membership
  where workspace_id = p_ws and user_id = auth.uid() and revoked_at is null
$$;

create function public.project_ws(p_project uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select workspace_id from project where id = p_project
$$;

create function public.ws_org(p_ws uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select organization_id from workspace where id = p_ws
$$;

create function public.is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from project_member where project_id = p_project and user_id = auth.uid())
$$;

-- Bekijken: eigenaar/admin alles; interne rollen alleen als projectlid.
-- Freelancer/klant: pas in fase 3 via een apart, beperkt portaal.
create function public.can_view_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case public.my_role(public.project_ws(p_project))
    when 'eigenaar' then true
    when 'admin' then true
    when 'projectmanager' then public.is_project_member(p_project)
    when 'medewerker' then public.is_project_member(p_project)
    when 'stagiair' then public.is_project_member(p_project)
    else false end
$$;

-- Bewerken van projectinhoud (geen stagiair).
create function public.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case public.my_role(public.project_ws(p_project))
    when 'eigenaar' then true
    when 'admin' then true
    when 'projectmanager' then public.is_project_member(p_project)
    when 'medewerker' then public.is_project_member(p_project)
    else false end
$$;

-- Beheren: afsluiten, akkoord registreren, leden, nummer instellen.
create function public.can_manage_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case public.my_role(public.project_ws(p_project))
    when 'eigenaar' then true
    when 'admin' then true
    when 'projectmanager' then public.is_project_member(p_project)
    else false end
$$;

create function public.org_has_role(p_org uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from membership m join workspace w on w.id = m.workspace_id
    where w.organization_id = p_org and m.user_id = auth.uid()
      and m.revoked_at is null and m.role = any(p_roles))
$$;

create function public.my_person_id(p_org uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from person where organization_id = p_org and user_id = auth.uid()
$$;

create function public.can_edit_task(p_project uuid, p_created_by uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_project is null then p_created_by = auth.uid()
              else public.can_edit_project(p_project) end
$$;

-- ───────────────────────── Triggers: revisie, audit, integriteit ─────────────────────────
create function public.tg_bump_revision() returns trigger language plpgsql as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end $$;

create trigger bump before update on public.project for each row execute function public.tg_bump_revision();
create trigger bump before update on public.deliverable for each row execute function public.tg_bump_revision();
create trigger bump before update on public.shoot_day for each row execute function public.tg_bump_revision();
create trigger bump before update on public.assignment for each row execute function public.tg_bump_revision();
create trigger bump before update on public.task for each row execute function public.tg_bump_revision();

create function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb;
  v_project uuid;
  v_ws uuid;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, jsonb_build_object('oud', v_old->key, 'nieuw', value)) into v_changes
    from jsonb_each(v_new)
    where key not in ('revision','updated_at') and (v_old->key) is distinct from value;
    if v_changes is null then return null; end if;
  else
    v_changes := v_row;
  end if;

  if tg_table_name = 'project' then v_project := (v_row->>'id')::uuid;
  elsif v_row ? 'project_id' then v_project := (v_row->>'project_id')::uuid;
  elsif v_row ? 'deliverable_id' then
    select project_id into v_project from deliverable where id = (v_row->>'deliverable_id')::uuid;
  end if;

  if v_row ? 'workspace_id' then v_ws := (v_row->>'workspace_id')::uuid;
  elsif v_project is not null then select workspace_id into v_ws from project where id = v_project;
  end if;

  insert into audit_log(workspace_id, project_id, actor, action, table_name, row_key, changes, reason)
  values (v_ws, v_project, auth.uid(), lower(tg_op), tg_table_name,
          coalesce(v_row->>'id', v_row->>'project_id' || ':' || coalesce(v_row->>'user_id', v_row->>'deliverable_id', '')),
          v_changes, nullif(current_setting('regie.reason', true), ''));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['membership','project','project_member','project_number','deliverable',
                           'deliverable_version','approval','shoot_day','assignment','task','task_deliverable','person']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
  end loop;
end $$;

-- Project: levenscyclus, archief, afsluiting en administratie alleen via serverfuncties.
create function public.tg_project_guard() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and (
       new.workspace_id is distinct from old.workspace_id
    or new.lifecycle is distinct from old.lifecycle
    or new.lifecycle_reason is distinct from old.lifecycle_reason
    or new.archived is distinct from old.archived
    or new.closed_at is distinct from old.closed_at
    or new.closed_by is distinct from old.closed_by
    or new.admin_status is distinct from old.admin_status
    or new.adm_factuur_verstuurd is distinct from old.adm_factuur_verstuurd
    or new.adm_betaling_ontvangen is distinct from old.adm_betaling_ontvangen
    or new.adm_freelancers_betaald is distinct from old.adm_freelancers_betaald
    or new.adm_overig_afgerond is distinct from old.adm_overig_afgerond
    or new.adm_checked_at is distinct from old.adm_checked_at
    or new.adm_checked_by is distinct from old.adm_checked_by
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at) then
    raise exception 'Dit veld kan alleen via de daarvoor bedoelde actie worden gewijzigd.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard before update on public.project for each row execute function public.tg_project_guard();

create function public.tg_project_refs() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := ws_org(new.workspace_id);
begin
  if new.client_org_id is not null and not exists (select 1 from client_org where id = new.client_org_id and organization_id = v_org) then
    raise exception 'Klant hoort niet bij deze organisatie.';
  end if;
  if new.manager_person_id is not null and not exists (select 1 from person where id = new.manager_person_id and organization_id = v_org) then
    raise exception 'Verantwoordelijke hoort niet bij deze organisatie.';
  end if;
  return new;
end $$;
create trigger refs before insert or update on public.project for each row execute function public.tg_project_refs();

-- Deliverable: akkoordstatus en vereiste versie alleen via serverfuncties;
-- goedgekeurd/geleverd vereist altijd een geldig akkoord op precies de vereiste versie.
create function public.version_has_valid_approval(p_version uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from approval where version_id = p_version and revoked_at is null)
$$;

-- Bewust géén security definer: current_user moet de aanroeper zijn.
create function public.tg_deliverable_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and current_user = 'authenticated' then
    if new.required_version_id is distinct from old.required_version_id
       or new.delivered_at is distinct from old.delivered_at
       or new.project_id is distinct from old.project_id
       or (new.status is distinct from old.status and new.status in ('goedgekeurd','geleverd')) then
      raise exception 'Akkoord, vereiste versie en levering gaan via de aparte acties.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' and current_user = 'authenticated'
     and (new.status in ('goedgekeurd','geleverd') or new.required_version_id is not null or new.delivered_at is not null) then
    raise exception 'Een nieuwe deliverable start zonder akkoord.' using errcode = '42501';
  end if;
  if new.status in ('goedgekeurd','geleverd') and not public.version_has_valid_approval(new.required_version_id) then
    raise exception 'Geen geldig akkoord op de vereiste versie.';
  end if;
  if new.status = 'geleverd' and new.delivered_at is null then
    raise exception 'Leverdatum ontbreekt.';
  end if;
  return new;
end $$;
create trigger guard before insert or update on public.deliverable for each row execute function public.tg_deliverable_guard();

-- Draaidag: uitvoering en back-up worden met actor en tijd gestempeld.
create function public.tg_shoot_day_stamp() returns trigger language plpgsql as $$
begin
  if new.status = 'uitgevoerd' and (tg_op = 'INSERT' or old.status is distinct from 'uitgevoerd') then
    new.executed_confirmed_by := auth.uid();
    new.executed_confirmed_at := now();
  elsif new.status <> 'uitgevoerd' then
    new.executed_confirmed_by := null;
    new.executed_confirmed_at := null;
  end if;
  if new.backup_confirmed_at is not null and (tg_op = 'INSERT' or old.backup_confirmed_at is null) then
    new.backup_confirmed_by := auth.uid();
    new.backup_confirmed_at := now();
  elsif new.backup_confirmed_at is null then
    new.backup_confirmed_by := null;
  elsif tg_op = 'UPDATE' then
    new.backup_confirmed_by := old.backup_confirmed_by;
    new.backup_confirmed_at := old.backup_confirmed_at;
  end if;
  return new;
end $$;
create trigger stamp before insert or update on public.shoot_day for each row execute function public.tg_shoot_day_stamp();

create function public.tg_assignment_refs() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from person pe join project p on p.id = new.project_id
                 where pe.id = new.person_id and pe.organization_id = ws_org(p.workspace_id)) then
    raise exception 'Persoon hoort niet bij deze organisatie.';
  end if;
  return new;
end $$;
create trigger refs before insert or update on public.assignment for each row execute function public.tg_assignment_refs();

-- Taak: werkruimte volgt project; geen cycli; subtaak in dezelfde context; beperkte rollen
-- wijzigen alleen status (en eigen aangemaakte titel/omschrijving/deadline).
create function public.tg_task_integrity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_parent task%rowtype;
begin
  if new.project_id is not null then
    new.workspace_id := (select workspace_id from project where id = new.project_id);
  end if;
  if new.parent_id is not null then
    select * into v_parent from task where id = new.parent_id;
    if v_parent.project_id is distinct from new.project_id or v_parent.workspace_id <> new.workspace_id then
      raise exception 'Een subtaak hoort bij hetzelfde project als de hoofdtaak.';
    end if;
    if tg_op = 'UPDATE' and exists (
      with recursive up(id, parent_id) as (
        select id, parent_id from task where id = new.parent_id
        union all select t.id, t.parent_id from task t join up on t.id = up.parent_id)
      select 1 from up where id = new.id) then
      raise exception 'Deze koppeling zou een cirkel van subtaken maken.';
    end if;
  end if;
  if new.assignee_person_id is not null and not exists (
       select 1 from person where id = new.assignee_person_id and organization_id = ws_org(new.workspace_id)) then
    raise exception 'Persoon hoort niet bij deze organisatie.';
  end if;
  if new.shoot_day_id is not null and not exists (
       select 1 from shoot_day where id = new.shoot_day_id and project_id is not distinct from new.project_id) then
    raise exception 'Draaidag hoort niet bij dit project.';
  end if;
  if new.status = 'klaar' and (tg_op = 'INSERT' or old.status <> 'klaar') then
    new.completed_at := now();
  elsif new.status <> 'klaar' then
    new.completed_at := null;
  end if;
  if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
    raise exception 'Een taak kan niet naar een andere werkruimte worden verplaatst.';
  end if;
  return new;
end $$;
create trigger integrity before insert or update on public.task for each row execute function public.tg_task_integrity();

-- Bewust géén security definer: current_user moet de aanroeper zijn.
create function public.tg_task_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user = 'authenticated' then
    if new.created_by <> old.created_by or new.created_at <> old.created_at then
      raise exception 'Maker van een taak kan niet worden gewijzigd.' using errcode = '42501';
    end if;
    if not can_edit_task(old.project_id, old.created_by) then
      if (to_jsonb(new) - array['status','completed_at','updated_at','revision','title','description','deadline'])
         is distinct from (to_jsonb(old) - array['status','completed_at','updated_at','revision','title','description','deadline'])
         or (old.created_by <> auth.uid() and (new.title, new.description, new.deadline)
             is distinct from (old.title, old.description, old.deadline)) then
        raise exception 'Je kunt bij deze taak alleen de status wijzigen.' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger guard before update on public.task for each row execute function public.tg_task_guard();

create function public.tg_person_guard() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and (new.user_id is distinct from old.user_id
     or new.organization_id is distinct from old.organization_id) then
    raise exception 'Accountkoppeling gaat via ledenbeheer.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard before update on public.person for each row execute function public.tg_person_guard();

create function public.tg_task_deliverable_refs() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from task t join deliverable d on d.project_id = t.project_id
                 where t.id = new.task_id and d.id = new.deliverable_id) then
    raise exception 'Taak en deliverable horen niet bij hetzelfde project.';
  end if;
  return new;
end $$;
create trigger refs before insert on public.task_deliverable for each row execute function public.tg_task_deliverable_refs();

-- ───────────────────────── Row level security ─────────────────────────
alter table public.organization enable row level security;
alter table public.workspace enable row level security;
alter table public.membership enable row level security;
alter table public.person enable row level security;
alter table public.person_contact enable row level security;
alter table public.client_org enable row level security;
alter table public.project enable row level security;
alter table public.project_member enable row level security;
alter table public.project_number enable row level security;
alter table public.deliverable enable row level security;
alter table public.deliverable_version enable row level security;
alter table public.approval enable row level security;
alter table public.shoot_day enable row level security;
alter table public.assignment enable row level security;
alter table public.task enable row level security;
alter table public.task_deliverable enable row level security;
alter table public.audit_log enable row level security;

create policy sel on public.organization for select to authenticated
  using (exists (select 1 from public.workspace w where w.organization_id = id and public.my_role(w.id) is not null));
create policy sel on public.workspace for select to authenticated using (public.my_role(id) is not null);
create policy sel on public.membership for select to authenticated
  using (user_id = auth.uid() or public.my_role(workspace_id) in ('eigenaar','admin'));

create policy sel on public.person for select to authenticated
  using (public.org_has_role(organization_id, '{eigenaar,admin,projectmanager,medewerker,stagiair}'));
create policy ins on public.person for insert to authenticated
  with check (user_id is null and public.org_has_role(organization_id, '{eigenaar,admin,projectmanager,medewerker}'));
create policy upd on public.person for update to authenticated
  using (public.org_has_role(organization_id, '{eigenaar,admin,projectmanager,medewerker}'))
  with check (public.org_has_role(organization_id, '{eigenaar,admin,projectmanager,medewerker}'));

create policy sel on public.person_contact for select to authenticated
  using (exists (select 1 from public.person p where p.id = person_id
                 and public.org_has_role(p.organization_id, '{eigenaar,admin,projectmanager,medewerker}')));
create policy ins on public.person_contact for insert to authenticated
  with check (exists (select 1 from public.person p where p.id = person_id
                 and public.org_has_role(p.organization_id, '{eigenaar,admin,projectmanager,medewerker}')));
create policy upd on public.person_contact for update to authenticated
  using (exists (select 1 from public.person p where p.id = person_id
                 and public.org_has_role(p.organization_id, '{eigenaar,admin,projectmanager,medewerker}')));

create policy sel on public.client_org for select to authenticated
  using (public.org_has_role(organization_id, '{eigenaar,admin,projectmanager,medewerker,stagiair}'));
create policy ins on public.client_org for insert to authenticated
  with check (public.org_has_role(organization_id, '{eigenaar,admin,projectmanager,medewerker}'));
create policy upd on public.client_org for update to authenticated
  using (public.org_has_role(organization_id, '{eigenaar,admin,projectmanager,medewerker}'));

create policy sel on public.project for select to authenticated using (public.can_view_project(id));
create policy upd on public.project for update to authenticated
  using (public.can_edit_project(id)) with check (public.can_edit_project(id));

create policy sel on public.project_member for select to authenticated using (public.can_view_project(project_id));
create policy sel on public.project_number for select to authenticated using (public.can_view_project(project_id));

create policy sel on public.deliverable for select to authenticated using (public.can_view_project(project_id));
create policy ins on public.deliverable for insert to authenticated with check (public.can_edit_project(project_id));
create policy upd on public.deliverable for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

create policy sel on public.deliverable_version for select to authenticated
  using (exists (select 1 from public.deliverable d where d.id = deliverable_id));
create policy sel on public.approval for select to authenticated
  using (exists (select 1 from public.deliverable d where d.id = deliverable_id));

create policy sel on public.shoot_day for select to authenticated using (public.can_view_project(project_id));
create policy ins on public.shoot_day for insert to authenticated with check (public.can_edit_project(project_id));
create policy upd on public.shoot_day for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));

create policy sel on public.assignment for select to authenticated using (public.can_view_project(project_id));
create policy ins on public.assignment for insert to authenticated with check (public.can_edit_project(project_id));
create policy upd on public.assignment for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy del on public.assignment for delete to authenticated using (public.can_edit_project(project_id));

create policy sel on public.task for select to authenticated using (
  public.can_edit_task(project_id, created_by)
  or (project_id is not null and public.can_view_project(project_id)
      and (created_by = auth.uid() or assignee_person_id = public.my_person_id(public.ws_org(workspace_id)))));
create policy ins on public.task for insert to authenticated with check (
  created_by = auth.uid() and (
    (project_id is null and public.my_role(workspace_id) in ('eigenaar','admin','projectmanager','medewerker','stagiair'))
    or (project_id is not null and public.can_view_project(project_id))));
create policy upd on public.task for update to authenticated using (
  public.can_edit_task(project_id, created_by)
  or (project_id is not null and public.can_view_project(project_id)
      and (created_by = auth.uid() or assignee_person_id = public.my_person_id(public.ws_org(workspace_id)))));

create policy sel on public.task_deliverable for select to authenticated
  using (exists (select 1 from public.task t where t.id = task_id));
create policy ins on public.task_deliverable for insert to authenticated
  with check (exists (select 1 from public.deliverable d where d.id = deliverable_id and public.can_edit_project(d.project_id)));
create policy del on public.task_deliverable for delete to authenticated
  using (exists (select 1 from public.deliverable d where d.id = deliverable_id and public.can_edit_project(d.project_id)));

create policy sel on public.audit_log for select to authenticated
  using (workspace_id is not null and public.my_role(workspace_id) in ('eigenaar','admin'));

-- ───────────────────────── Overzicht (afgeleid, met RLS van de aanvrager) ─────────────────────────
create view public.project_overview with (security_invoker = true) as
select
  p.id, p.workspace_id, p.company, p.year, p.name, p.lifecycle, p.archived, p.workflow,
  p.admin_status, p.revision,
  pn.number_display as number,
  co.name as client_name,
  mp.full_name as manager_name,
  (select coalesce(array_agg(distinct pe.full_name order by pe.full_name), '{}')
     from public.assignment a join public.person pe on pe.id = a.person_id
    where a.project_id = p.id and a.deliverable_id is not null and a.status in ('optie','bevestigd')) as editors,
  (select count(distinct a.person_id) from public.assignment a
    where a.project_id = p.id and a.shoot_day_id is not null and a.status in ('optie','bevestigd')) as crew_count,
  (select count(*) from public.deliverable d
    where d.project_id = p.id and d.scope = 'overeengekomen' and d.status <> 'vervallen') as deliverables_total,
  (select count(*) from public.deliverable d
    where d.project_id = p.id and d.scope = 'overeengekomen' and d.status = 'geleverd') as deliverables_delivered,
  (select count(*) from public.deliverable d
    where d.project_id = p.id and d.scope = 'overeengekomen' and d.status not in ('vervallen','geleverd')
      and not exists (select 1 from public.assignment a where a.deliverable_id = d.id and a.status in ('optie','bevestigd'))) as deliverables_without_editor,
  (select min(s.date) from public.shoot_day s
    where s.project_id = p.id and s.status in ('gepland','in_uitvoering') and s.date >= current_date) as next_shoot_date,
  (select min(x.deadline) from (
      select d.deadline from public.deliverable d where d.project_id = p.id and d.status not in ('geleverd','vervallen')
      union all
      select t.deadline from public.task t where t.project_id = p.id and t.status not in ('klaar','vervallen')) x) as next_deadline
from public.project p
left join public.project_number pn on pn.project_id = p.id and pn.kind = 'primair'
left join public.client_org co on co.id = p.client_org_id
left join public.person mp on mp.id = p.manager_person_id;

-- ───────────────────────── Serverfuncties (RPC) ─────────────────────────
create function public.require(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception '%', p_msg using errcode = '42501'; end if;
end $$;

-- Eerste inrichting: alleen mogelijk zolang er nog geen organisatie bestaat.
create function public.bootstrap_organization(p_org_name text, p_workspace_name text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_ws uuid;
begin
  perform require(auth.uid() is not null, 'Niet ingelogd.');
  lock table organization in exclusive mode;
  perform require(not exists (select 1 from organization where not is_test), 'De organisatie is al ingericht.');
  insert into organization(name) values (p_org_name) returning id into v_org;
  insert into workspace(organization_id, name) values (v_org, p_workspace_name) returning id into v_ws;
  insert into membership(workspace_id, user_id, role) values (v_ws, auth.uid(), 'eigenaar');
  insert into person(organization_id, full_name, user_id, roles) values (v_org, p_full_name, auth.uid(), '{productie}');
  return v_ws;
end $$;

create function public.my_context()
returns table(workspace_id uuid, workspace_name text, organization_id uuid, role public.app_role, person_id uuid, person_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.name, w.organization_id, m.role, pe.id, pe.full_name
  from membership m join workspace w on w.id = m.workspace_id
  left join person pe on pe.organization_id = w.organization_id and pe.user_id = m.user_id
  where m.user_id = auth.uid() and m.revoked_at is null
  order by w.created_at
$$;

create function public.organization_exists() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from organization where not is_test)
$$;

-- Lokale fase-1-route om een bestaand account toe te voegen. Fase 3 vervangt dit door uitnodigingen.
create function public.add_member(p_ws uuid, p_email text, p_role public.app_role, p_full_name text, p_person_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_org uuid := ws_org(p_ws); v_me public.app_role := my_role(p_ws); v_person uuid;
begin
  perform require(v_me in ('eigenaar','admin'), 'Alleen eigenaar of admin kan leden toevoegen.');
  perform require(p_role not in ('freelancer','klant'), 'Externe toegang volgt in fase 3.');
  perform require(v_me = 'eigenaar' or p_role not in ('eigenaar','admin'), 'Een admin kan geen eigenaar of admin aanwijzen.');
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  perform require(v_user is not null, 'Er bestaat nog geen account met dit e-mailadres. Laat de persoon eerst een account aanmaken.');
  perform require(not exists (select 1 from membership where workspace_id = p_ws and user_id = v_user and revoked_at is null),
                  'Deze persoon is al lid.');
  insert into membership(workspace_id, user_id, role) values (p_ws, v_user, p_role)
    on conflict (workspace_id, user_id) do update set role = excluded.role, revoked_at = null, created_at = now();

  select id into v_person from person where organization_id = v_org and user_id = v_user;
  if v_person is null then
    if p_person_id is not null then
      update person set user_id = v_user where id = p_person_id and organization_id = v_org and user_id is null
        returning id into v_person;
      perform require(v_person is not null, 'Deze persoon kan niet aan het account worden gekoppeld.');
    else
      insert into person(organization_id, full_name, user_id) values (v_org, p_full_name, v_user) returning id into v_person;
      insert into person_contact(person_id, email) values (v_person, lower(btrim(p_email)));
    end if;
  end if;
  return v_user;
end $$;

create function public.revoke_member(p_ws uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(my_role(p_ws) in ('eigenaar','admin'), 'Alleen eigenaar of admin kan toegang intrekken.');
  perform require(p_user <> auth.uid(), 'Je kunt je eigen toegang niet intrekken.');
  perform require(my_role(p_ws) = 'eigenaar' or (select role from membership where workspace_id = p_ws and user_id = p_user) not in ('eigenaar','admin'),
                  'Een admin kan een eigenaar of admin niet intrekken.');
  update membership set revoked_at = now() where workspace_id = p_ws and user_id = p_user and revoked_at is null;
end $$;

create function public.list_members(p_ws uuid)
returns table(user_id uuid, email text, role public.app_role, person_name text, revoked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.user_id, u.email::text, m.role, pe.full_name, m.revoked_at
  from membership m join auth.users u on u.id = m.user_id
  left join person pe on pe.user_id = m.user_id and pe.organization_id = ws_org(p_ws)
  where m.workspace_id = p_ws and my_role(p_ws) in ('eigenaar','admin')
  order by m.created_at
$$;

create function public.number_in_use(p_org uuid, p_number text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select org_has_role(p_org, '{eigenaar,admin,projectmanager}') and exists (
    select 1 from project_number where organization_id = p_org
      and number_key = upper(regexp_replace(p_number, '\s', '', 'g')))
$$;

create function public.register_number_internal(p_project uuid, p_number text, p_kind public.number_kind, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    insert into project_number(organization_id, project_id, number_display, kind, reason)
    values (ws_org(project_ws(p_project)), p_project, btrim(p_number), p_kind, p_reason);
  exception when unique_violation then
    raise exception 'Projectnummer % is al geregistreerd en kan niet opnieuw worden gebruikt.', btrim(p_number)
      using errcode = '23505';
  end;
end $$;
revoke execute on function public.register_number_internal(uuid, text, public.number_kind, text) from public, anon, authenticated;

create function public.create_project(
  p_ws uuid, p_company public.bedrijf, p_year int, p_name text,
  p_number text default null, p_client_org_id uuid default null, p_client_name text default null,
  p_manager_person_id uuid default null, p_briefing text default null,
  p_workflow public.workflow_kind default 'film', p_production_applicable boolean default true)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid; v_client uuid := p_client_org_id;
begin
  perform require(my_role(p_ws) in ('eigenaar','admin','projectmanager'), 'Je mag geen projecten aanmaken.');
  if v_client is null and nullif(btrim(p_client_name), '') is not null then
    insert into client_org(organization_id, name) values (ws_org(p_ws), btrim(p_client_name)) returning id into v_client;
  end if;
  insert into project(workspace_id, company, year, name, client_org_id, manager_person_id, briefing, workflow, production_applicable)
  values (p_ws, p_company, p_year, btrim(p_name), v_client, p_manager_person_id, p_briefing, p_workflow, p_production_applicable)
  returning id into v_project;
  insert into project_member(project_id, user_id) values (v_project, auth.uid());
  if nullif(btrim(p_number), '') is not null then
    perform register_number_internal(v_project, p_number, 'primair', null);
  end if;
  return v_project;
end $$;

create function public.set_project_number(p_project uuid, p_number text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(can_manage_project(p_project), 'Je mag het nummer van dit project niet instellen.');
  perform require(not exists (select 1 from project_number where project_id = p_project and kind = 'primair'),
                  'Dit project heeft al een nummer. Gebruik nummercorrectie.');
  perform register_number_internal(p_project, p_number, 'primair', null);
end $$;

create function public.correct_project_number(p_project uuid, p_new_number text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(my_role(project_ws(p_project)) in ('eigenaar','admin'), 'Alleen eigenaar of admin kan een nummer corrigeren.');
  perform require(length(btrim(coalesce(p_reason,''))) > 0, 'Geef een reden voor de correctie.');
  perform set_config('regie.reason', p_reason, true);
  update project_number set kind = 'alias', reason = p_reason where project_id = p_project and kind = 'primair';
  perform register_number_internal(p_project, p_new_number, 'primair', p_reason);
end $$;

create function public.add_project_member(p_project uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(can_manage_project(p_project), 'Je mag geen projectleden toevoegen.');
  perform require(exists (select 1 from membership where workspace_id = project_ws(p_project) and user_id = p_user and revoked_at is null),
                  'Deze persoon is geen lid van de werkruimte.');
  insert into project_member(project_id, user_id) values (p_project, p_user) on conflict do nothing;
end $$;

create function public.remove_project_member(p_project uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(can_manage_project(p_project), 'Je mag geen projectleden verwijderen.');
  delete from project_member where project_id = p_project and user_id = p_user;
end $$;

create function public.add_version(p_deliverable uuid, p_file_ref text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid; v_no int; v_id uuid;
begin
  select project_id into v_project from deliverable where id = p_deliverable for update;
  perform require(can_edit_project(v_project), 'Je mag geen versies toevoegen.');
  select coalesce(max(version_no), 0) + 1 into v_no from deliverable_version where deliverable_id = p_deliverable;
  insert into deliverable_version(deliverable_id, version_no, file_ref, note)
  values (p_deliverable, v_no, nullif(btrim(p_file_ref), ''), p_note) returning id into v_id;
  return v_id;
end $$;

-- Maak een versie expliciet de vereiste opleverversie. Een eerder akkoord op een andere
-- versie geldt dan niet meer voor de oplevering; status gaat terug naar review.
create function public.set_required_version(p_deliverable uuid, p_version uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d deliverable%rowtype;
begin
  select * into d from deliverable where id = p_deliverable for update;
  perform require(can_manage_project(d.project_id), 'Je mag de vereiste versie niet wijzigen.');
  perform require(exists (select 1 from deliverable_version where id = p_version and deliverable_id = p_deliverable), 'Onbekende versie.');
  if d.required_version_id is distinct from p_version then
    update deliverable set required_version_id = p_version,
      status = case when status in ('goedgekeurd','geleverd') then 'in_review'::deliverable_status else status end,
      delivered_at = case when status in ('goedgekeurd','geleverd') then null else delivered_at end
    where id = p_deliverable;
  end if;
end $$;

create function public.register_approval(p_version uuid, p_approved_by_name text, p_approved_at timestamptz, p_evidence text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v deliverable_version%rowtype; d deliverable%rowtype; v_id uuid;
begin
  select * into v from deliverable_version where id = p_version;
  perform require(v.id is not null, 'Onbekende versie.');
  select * into d from deliverable where id = v.deliverable_id for update;
  perform require(can_manage_project(d.project_id), 'Je mag geen akkoord registreren.');
  perform require(d.status not in ('vervallen','geleverd'), 'Deze deliverable is vervallen of al geleverd.');
  perform require(d.required_version_id is null or d.required_version_id = p_version,
    'Dit is niet de vereiste opleverversie. Maak deze versie eerst expliciet de vereiste versie.');
  perform require(not exists (select 1 from deliverable_version where deliverable_id = d.id and version_no > v.version_no),
    'Er bestaat al een nieuwere versie. Een akkoord geldt alleen voor precies één versie.');
  insert into approval(deliverable_id, version_id, approved_by_name, approved_at, evidence)
  values (d.id, p_version, btrim(p_approved_by_name), p_approved_at, btrim(p_evidence)) returning id into v_id;
  update deliverable set required_version_id = p_version, status = 'goedgekeurd' where id = d.id;
  return v_id;
end $$;

create function public.revoke_approval(p_approval uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a approval%rowtype; d deliverable%rowtype;
begin
  select * into a from approval where id = p_approval;
  select * into d from deliverable where id = a.deliverable_id for update;
  perform require(can_manage_project(d.project_id), 'Je mag geen akkoord intrekken.');
  perform require(length(btrim(coalesce(p_reason,''))) > 0, 'Geef een reden.');
  perform require(a.revoked_at is null, 'Dit akkoord is al ingetrokken.');
  perform set_config('regie.reason', p_reason, true);
  update approval set revoked_at = now(), revoked_by = auth.uid(), revoked_reason = p_reason where id = p_approval;
  if d.status in ('goedgekeurd','geleverd') and not exists (
      select 1 from approval where version_id = d.required_version_id and revoked_at is null) then
    update deliverable set status = 'in_review', delivered_at = null where id = d.id;
  end if;
end $$;

create function public.mark_delivered(p_deliverable uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d deliverable%rowtype;
begin
  select * into d from deliverable where id = p_deliverable for update;
  perform require(can_manage_project(d.project_id), 'Je mag geen levering registreren.');
  perform require(d.status = 'goedgekeurd', 'Alleen een goedgekeurde deliverable kan als geleverd worden gemarkeerd.');
  update deliverable set status = 'geleverd', delivered_at = now() where id = d.id;
end $$;

-- Afsluitvoorwaarden: lege verzamelingen zijn nooit bewijs van afronding.
create function public.close_gates(p_project uuid)
returns table(severity text, code text, message text, object_type text, object_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p project%rowtype;
begin
  perform require(can_view_project(p_project), 'Geen toegang.');
  select * into p from project where id = p_project;

  if p.lifecycle not in ('actief','gepauzeerd') then
    return query select 'blokkade', 'lifecycle', 'Project is ' || replace(p.lifecycle::text, '_', ' ') || '.', 'project', p.id;
  end if;

  if p.workflow = 'film' then
    if not exists (select 1 from deliverable where project_id = p_project and scope = 'overeengekomen' and status <> 'vervallen') then
      return query select 'blokkade', 'geen_deliverables', 'Er zijn geen overeengekomen deliverables. Een leeg project sluit niet vanzelf.', 'project', p.id;
    end if;
    return query
      select 'blokkade', 'deliverable_niet_geleverd',
             'Deliverable "' || d.title || '" is nog niet geleverd (status: ' || replace(d.status::text, '_', ' ') || ').',
             'deliverable', d.id
      from deliverable d
      where d.project_id = p_project and d.scope = 'overeengekomen' and d.status not in ('geleverd','vervallen')
      order by d.sort, d.title;

    if p.production_applicable then
      if not exists (select 1 from shoot_day where project_id = p_project and status = 'uitgevoerd') then
        return query select 'blokkade', 'geen_draaidag', 'Er is geen uitgevoerde draaidag. Zet productie op "niet van toepassing" als dat klopt.', 'project', p.id;
      end if;
      return query
        select 'blokkade', 'draaidag_open', 'Draaidag ' || to_char(s.date, 'DD-MM-YYYY') || ' is nog niet uitgevoerd of geannuleerd.', 'shoot_day', s.id
        from shoot_day s where s.project_id = p_project and s.status in ('gepland','in_uitvoering') order by s.date;
      return query
        select 'blokkade', 'backup_ontbreekt', 'Back-up van draaidag ' || to_char(s.date, 'DD-MM-YYYY') || ' is niet bevestigd.', 'shoot_day', s.id
        from shoot_day s where s.project_id = p_project and s.status = 'uitgevoerd' and s.backup_confirmed_at is null order by s.date;
    end if;
  end if;

  return query
    select 'blokkade', 'afsluittaak_open', 'Verplichte afsluittaak "' || t.title || '" is nog open.', 'task', t.id
    from task t where t.project_id = p_project and t.required_for_close and t.status not in ('klaar','vervallen');
  return query
    select 'waarschuwing', 'taak_open', 'Taak "' || t.title || '" is nog open.', 'task', t.id
    from task t where t.project_id = p_project and not t.required_for_close and t.status not in ('klaar','vervallen');
end $$;

create function public.close_project(p_project uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_block text;
begin
  perform require(can_manage_project(p_project), 'Je mag dit project niet afsluiten.');
  perform 1 from project where id = p_project for update;
  select string_agg(message, E'\n') into v_block from close_gates(p_project) where severity = 'blokkade';
  if v_block is not null then
    raise exception 'Project kan nog niet operationeel worden afgesloten:%', E'\n' || v_block using errcode = 'P0001';
  end if;
  update project set lifecycle = 'operationeel_afgerond', closed_at = now(), closed_by = auth.uid(), lifecycle_reason = null
  where id = p_project;
end $$;

create function public.set_project_lifecycle(p_project uuid, p_lifecycle public.project_lifecycle, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p project%rowtype;
begin
  perform require(can_manage_project(p_project), 'Je mag de status van dit project niet wijzigen.');
  perform require(p_lifecycle <> 'operationeel_afgerond', 'Gebruik "Operationeel afsluiten" om te sluiten.');
  perform require(length(btrim(coalesce(p_reason,''))) > 0, 'Geef een reden.');
  select * into p from project where id = p_project for update;
  perform set_config('regie.reason', p_reason, true);
  update project set lifecycle = p_lifecycle, lifecycle_reason = p_reason,
    closed_at = case when p_lifecycle = 'actief' then null else closed_at end,
    closed_by = case when p_lifecycle = 'actief' then null else closed_by end
  where id = p_project;
end $$;

create function public.set_project_archived(p_project uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(can_manage_project(p_project), 'Je mag dit project niet archiveren.');
  update project set archived = p_archived where id = p_project;
end $$;

create function public.set_admin_status(p_project uuid, p_status public.admin_status,
  p_factuur boolean, p_betaling boolean, p_freelancers boolean, p_overig boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(my_role(project_ws(p_project)) in ('eigenaar','admin'), 'Alleen eigenaar of admin beheert de administratieve afronding.');
  perform require(p_status <> 'afgerond' or (p_factuur and p_betaling and p_freelancers and p_overig),
                  'Administratief afgerond vereist dat alle controles zijn afgevinkt.');
  update project set admin_status = p_status, adm_factuur_verstuurd = p_factuur, adm_betaling_ontvangen = p_betaling,
    adm_freelancers_betaald = p_freelancers, adm_overig_afgerond = p_overig, adm_checked_at = now(), adm_checked_by = auth.uid()
  where id = p_project;
end $$;

-- ───────────────────────── Grants ─────────────────────────
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function
  public.bootstrap_organization(text, text, text), public.my_context(), public.organization_exists(),
  public.add_member(uuid, text, public.app_role, text, uuid), public.revoke_member(uuid, uuid), public.list_members(uuid),
  public.number_in_use(uuid, text), public.create_project(uuid, public.bedrijf, int, text, text, uuid, text, uuid, text, public.workflow_kind, boolean),
  public.set_project_number(uuid, text), public.correct_project_number(uuid, text, text),
  public.add_project_member(uuid, uuid), public.remove_project_member(uuid, uuid),
  public.add_version(uuid, text, text), public.set_required_version(uuid, uuid),
  public.register_approval(uuid, text, timestamptz, text), public.revoke_approval(uuid, text), public.mark_delivered(uuid),
  public.close_gates(uuid), public.close_project(uuid), public.set_project_lifecycle(uuid, public.project_lifecycle, text),
  public.set_project_archived(uuid, boolean), public.set_admin_status(uuid, public.admin_status, boolean, boolean, boolean, boolean),
  public.my_role(uuid), public.can_view_project(uuid), public.can_edit_project(uuid), public.can_manage_project(uuid)
to authenticated;
-- RLS-helpers worden ook binnen policies aangeroepen:
grant execute on function public.project_ws(uuid), public.ws_org(uuid), public.is_project_member(uuid),
  public.org_has_role(uuid, public.app_role[]), public.my_person_id(uuid), public.can_edit_task(uuid, uuid),
  public.version_has_valid_approval(uuid),
  public.require(boolean, text)
to authenticated;
-- Geen directe delete op kerngegevens; inserts op project, nummers, versies en akkoorden alleen via functies.
revoke delete on public.organization, public.workspace, public.membership, public.person, public.client_org, public.project,
  public.project_member, public.project_number, public.deliverable, public.deliverable_version, public.approval,
  public.shoot_day, public.task, public.audit_log from authenticated;
revoke insert, update on public.project_number, public.deliverable_version, public.approval, public.audit_log,
  public.membership, public.project_member, public.organization, public.workspace from authenticated;
revoke insert on public.project from authenticated;
