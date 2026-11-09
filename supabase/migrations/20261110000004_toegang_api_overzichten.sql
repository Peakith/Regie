-- Regie · volledige app (deel 4): uitnodigingen en freelancers (§3, fase 8), API en koppelingen (§10),
-- zoeken, dashboard, export, offline-momentopname, realtime, standaardtemplates en periodieke taak.

-- ───────────────────────── Uitnodigingen ─────────────────────────
-- Eenmalige link, 7 dagen geldig. De eigenaar verstuurt de link zelf (mailverzending volgt bij hosting).
create table public.invitation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspace(id),
  email text not null check (position('@' in email) > 1),
  role public.app_role not null check (role <> 'klant'),
  person_id uuid references public.person(id),
  token_hash text not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  accepted_at timestamptz, accepted_by uuid,
  revoked_at timestamptz
);

create function public.create_invitation(p_ws uuid, p_email text, p_role public.app_role, p_person_id uuid default null)
returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_me public.app_role := my_role(p_ws); v_token text := encode(gen_random_bytes(24), 'hex');
begin
  perform require(v_me in ('eigenaar','admin'), 'Alleen eigenaar of admin nodigt uit.');
  perform require(p_role <> 'klant', 'Klanten krijgen geen toegang tot Regie.');
  perform require(v_me = 'eigenaar' or p_role not in ('eigenaar','admin'), 'Een admin kan geen eigenaar of admin uitnodigen.');
  perform require(p_person_id is null or exists (select 1 from person where id = p_person_id and organization_id = ws_org(p_ws) and user_id is null),
                  'Deze persoon heeft al een account of hoort niet bij de organisatie.');
  update invitation set revoked_at = now() where workspace_id = p_ws and lower(email) = lower(btrim(p_email))
    and accepted_at is null and revoked_at is null;
  insert into invitation(workspace_id, email, role, person_id, token_hash)
  values (p_ws, lower(btrim(p_email)), p_role, p_person_id, encode(digest(v_token, 'sha256'), 'hex'));
  return v_token;
end $$;

create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(my_role((select workspace_id from invitation where id = p_invitation)) in ('eigenaar','admin'), 'Geen rechten.');
  update invitation set revoked_at = now() where id = p_invitation and accepted_at is null;
end $$;

create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare i invitation%rowtype; v_email text; v_org uuid; v_person uuid;
begin
  perform require(auth.uid() is not null, 'Log eerst in of maak een account aan.');
  select * into i from invitation where token_hash = encode(digest(btrim(p_token), 'sha256'), 'hex') for update;
  perform require(i.id is not null, 'Deze uitnodiging bestaat niet.');
  perform require(i.revoked_at is null, 'Deze uitnodiging is ingetrokken.');
  perform require(i.accepted_at is null, 'Deze uitnodiging is al gebruikt.');
  perform require(i.expires_at > now(), 'Deze uitnodiging is verlopen. Vraag een nieuwe aan.');
  select lower(email) into v_email from auth.users where id = auth.uid();
  perform require(v_email = i.email, 'Deze uitnodiging is voor een ander e-mailadres.');
  v_org := ws_org(i.workspace_id);
  insert into membership(workspace_id, user_id, role) values (i.workspace_id, auth.uid(), i.role)
    on conflict (workspace_id, user_id) do update set role = excluded.role, revoked_at = null, created_at = now();
  select id into v_person from person where organization_id = v_org and user_id = auth.uid();
  if v_person is null then
    if i.person_id is not null then
      update person set user_id = auth.uid() where id = i.person_id and user_id is null returning id into v_person;
    end if;
    if v_person is null then
      insert into person(organization_id, full_name, user_id) values (v_org, split_part(v_email, '@', 1), auth.uid()) returning id into v_person;
      insert into person_contact(person_id, email) values (v_person, v_email);
    end if;
  end if;
  update invitation set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  return i.workspace_id;
end $$;

create function public.list_invitations(p_ws uuid)
returns table(id uuid, email text, role public.app_role, person_name text, expires_at timestamptz, created_at timestamptz,
              accepted_at timestamptz, revoked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.email, i.role, pe.full_name, i.expires_at, i.created_at, i.accepted_at, i.revoked_at
  from invitation i left join person pe on pe.id = i.person_id
  where i.workspace_id = p_ws and my_role(p_ws) in ('eigenaar','admin') order by i.created_at desc
$$;

-- Gedeactiveerde gebruikers: toegewezen werk blijft bestaan en is zichtbaar.
create function public.tasks_of_deactivated(p_ws uuid)
returns table(task_id uuid, title text, project_id uuid, person_name text, deadline date)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.title, t.project_id, pe.full_name, t.deadline
  from task t join person pe on pe.id = t.assignee_person_id
  join membership m on m.user_id = pe.user_id and m.workspace_id = t.workspace_id
  where t.workspace_id = p_ws and is_internal(p_ws) and m.revoked_at is not null
    and t.deleted_at is null and t.status not in ('klaar','vervallen')
$$;

-- add_member uit fase 1 blijft voor bestaande accounts, nu ook voor freelancers.
create or replace function public.add_member(p_ws uuid, p_email text, p_role public.app_role, p_full_name text, p_person_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_org uuid := ws_org(p_ws); v_me public.app_role := my_role(p_ws); v_person uuid;
begin
  perform require(v_me in ('eigenaar','admin'), 'Alleen eigenaar of admin kan leden toevoegen.');
  perform require(p_role <> 'klant', 'Klanten krijgen geen toegang tot Regie.');
  perform require(v_me = 'eigenaar' or p_role not in ('eigenaar','admin'), 'Een admin kan geen eigenaar of admin aanwijzen.');
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  perform require(v_user is not null, 'Er bestaat nog geen account met dit e-mailadres. Gebruik een uitnodiging.');
  perform require(not exists (select 1 from membership where workspace_id = p_ws and user_id = v_user and revoked_at is null),
                  'Deze persoon is al lid.');
  insert into membership(workspace_id, user_id, role) values (p_ws, v_user, p_role)
    on conflict (workspace_id, user_id) do update set role = excluded.role, revoked_at = null, created_at = now();
  select id into v_person from person where organization_id = v_org and user_id = v_user;
  if v_person is null then
    if p_person_id is not null then
      update person set user_id = v_user where id = p_person_id and organization_id = v_org and user_id is null returning id into v_person;
      perform require(v_person is not null, 'Deze persoon kan niet aan het account worden gekoppeld.');
    else
      insert into person(organization_id, full_name, user_id) values (v_org, p_full_name, v_user) returning id into v_person;
      insert into person_contact(person_id, email) values (v_person, lower(btrim(p_email)));
    end if;
  end if;
  return v_user;
end $$;

create or replace function public.list_members(p_ws uuid)
returns table(user_id uuid, email text, role public.app_role, person_name text, revoked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.user_id, u.email::text, m.role, pe.full_name, m.revoked_at
  from membership m join auth.users u on u.id = m.user_id
  left join person pe on pe.user_id = m.user_id and pe.organization_id = ws_org(p_ws)
  where m.workspace_id = p_ws and my_role(p_ws) in ('eigenaar','admin')
  order by m.created_at
$$;

create function public.set_member_role(p_ws uuid, p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me public.app_role := my_role(p_ws); v_cur public.app_role;
begin
  perform require(v_me in ('eigenaar','admin'), 'Alleen eigenaar of admin wijzigt rollen.');
  perform require(p_user <> auth.uid(), 'Je kunt je eigen rol niet wijzigen.');
  perform require(p_role <> 'klant', 'Klanten krijgen geen toegang tot Regie.');
  select role into v_cur from membership where workspace_id = p_ws and user_id = p_user and revoked_at is null;
  perform require(v_cur is not null, 'Geen actief lid.');
  perform require(v_me = 'eigenaar' or (v_cur not in ('eigenaar','admin') and p_role not in ('eigenaar','admin')),
                  'Een admin kan geen eigenaar of admin aanwijzen of wijzigen.');
  update membership set role = p_role where workspace_id = p_ws and user_id = p_user;
end $$;

-- ───────────────────────── Freelancer-weergave (servermatig samengesteld) ─────────────────────────
create function public.my_person_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(pe.id), '{}') from person pe
  join workspace w on w.organization_id = pe.organization_id
  join membership m on m.workspace_id = w.id and m.user_id = auth.uid() and m.revoked_at is null
  where pe.user_id = auth.uid()
$$;

create function public.crew_shoot_days(p_from date default null, p_to date default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'date', s.date, 'start_time', s.start_time, 'end_time', s.end_time, 'location', s.location,
    'status', s.status, 'title', s.title, 'callsheet_link', s.callsheet_link, 'callsheet_note', s.callsheet_note,
    'project', coalesce((select number_display || ' | ' from project_number where project_id = p.id and kind = 'primair'), '') || p.name,
    'client', (select name from client_org where id = p.client_org_id),
    'my_role', a.role_label, 'my_status', a.status,
    'crew', (select jsonb_agg(jsonb_build_object('name', pe.full_name, 'role', a2.role_label, 'status', a2.status) order by pe.full_name)
             from assignment a2 join person pe on pe.id = a2.person_id
             where a2.shoot_day_id = s.id and a2.status in ('optie','bevestigd')),
    'equipment', (select jsonb_agg(jsonb_build_object('description', e.description, 'picked_up', e.picked_up, 'returned', e.returned) order by e.sort, e.description)
                  from equipment_item e where e.shoot_day_id = s.id and e.deleted_at is null),
    'notes', (select jsonb_agg(jsonb_build_object('body', c.body, 'at', c.created_at) order by c.created_at)
              from comment c where c.subject_type = 'shoot_day' and c.subject_id = s.id and c.visibility = 'crew' and c.deleted_at is null),
    'links', (select jsonb_agg(jsonb_build_object('label', coalesce(l.label, l.url), 'url', l.url))
              from external_link l where l.project_id = p.id and l.visibility = 'crew' and l.deleted_at is null
                and (l.subject_type = 'project' or (l.subject_type = 'shoot_day' and l.subject_id = s.id)))
  ) order by s.date, s.start_time), '[]')
  from assignment a join shoot_day s on s.id = a.shoot_day_id join project p on p.id = s.project_id
  where a.person_id = any(my_person_ids()) and a.status in ('optie','bevestigd')
    and s.deleted_at is null and s.status <> 'geannuleerd' and not p.archived
    and s.date >= coalesce(p_from, today_ams() - 30) and s.date <= coalesce(p_to, today_ams() + 365)
$$;

create function public.crew_tasks() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'deadline', t.deadline,
    'project', p.name,
    'notes', (select jsonb_agg(jsonb_build_object('body', c.body, 'at', c.created_at) order by c.created_at)
              from comment c where c.subject_type = 'task' and c.subject_id = t.id and c.visibility = 'crew' and c.deleted_at is null))
    order by t.deadline nulls last), '[]')
  from task t join project p on p.id = t.project_id
  where t.assignee_person_id = any(my_person_ids()) and t.deleted_at is null and not p.archived
    and t.status not in ('vervallen')
$$;

-- Freelancer: alleen status en opmerking op eigen taken.
create function public.crew_update_task(p_task uuid, p_status public.task_status, p_comment text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t task%rowtype;
begin
  select * into t from task where id = p_task and deleted_at is null;
  perform require(t.id is not null and t.assignee_person_id = any(my_person_ids()) and t.project_id is not null,
                  'Geen toegang tot deze taak.');
  perform require(p_status in ('te_doen','bezig','geblokkeerd','klaar'), 'Ongeldige status.');
  update task set status = p_status where id = p_task;
  if nullif(btrim(p_comment), '') is not null then
    insert into comment(project_id, subject_type, subject_id, body, visibility) values (t.project_id, 'task', p_task, btrim(p_comment), 'crew');
  end if;
end $$;

-- ───────────────────────── API-sleutels, koppelingen en inkomende gebeurtenissen (§10) ─────────────────────────
create table public.integration (
  organization_id uuid not null references public.organization(id),
  source text not null check (source in ('bruto','reviewtool','dropbox','moneybird','overig')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (organization_id, source)
);

create table public.api_key (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  source text not null check (source in ('bruto','reviewtool','overig')),
  label text not null,
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

create table public.integration_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization(id),
  source text not null,
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'ontvangen' check (status in ('ontvangen','verwerkt','duplicaat','fout','genegeerd')),
  attempts int not null default 0,
  next_attempt_at timestamptz,
  error text,
  result jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index integration_event_idem on public.integration_event(organization_id, source, external_event_id)
  where status <> 'duplicaat';
create index on public.integration_event(organization_id, received_at desc);

create function public.set_integration_enabled(p_ws uuid, p_source text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(my_role(p_ws) in ('eigenaar','admin'), 'Alleen eigenaar of admin beheert koppelingen.');
  perform require(p_source in ('bruto','reviewtool','overig'), 'Deze koppeling is nog niet gebouwd.');
  update integration set enabled = p_enabled, updated_at = now() where organization_id = ws_org(p_ws) and source = p_source;
end $$;

create function public.create_api_key(p_ws uuid, p_source text, p_label text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_key text := 'rg_' || encode(gen_random_bytes(24), 'hex');
begin
  perform require(my_role(p_ws) = 'eigenaar', 'Alleen de eigenaar maakt API-sleutels.');
  insert into api_key(organization_id, source, label, key_hash, key_prefix)
  values (ws_org(p_ws), p_source, btrim(p_label), encode(digest(v_key, 'sha256'), 'hex'), left(v_key, 9));
  return v_key; -- wordt één keer getoond; alleen de hash wordt bewaard
end $$;

create function public.revoke_api_key(p_key uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require(org_has_role((select organization_id from api_key where id = p_key), '{eigenaar}'), 'Alleen de eigenaar trekt sleutels in.');
  update api_key set revoked_at = now() where id = p_key and revoked_at is null;
end $$;

-- Sleutel uit de header x-regie-key (of parameter) valideren.
create function public.api_auth(p_key text) returns public.api_key
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare k api_key%rowtype; v_key text;
begin
  v_key := coalesce(nullif(p_key, ''), current_setting('request.headers', true)::json->>'x-regie-key');
  select * into k from api_key where key_hash = encode(digest(coalesce(v_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if k.id is null then raise exception 'Ongeldige of ingetrokken API-sleutel.' using errcode = '28000'; end if;
  update api_key set last_used_at = now() where id = k.id;
  return k;
end $$;
revoke execute on function public.api_auth(text) from authenticated;

-- Verwerking per gebeurtenis. Wijzigingen uit een koppeling dragen hun bron mee (regie.source),
-- zodat ze nooit naar dezelfde bron worden teruggestuurd (lusbescherming).
create function public.process_integration_event(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e integration_event%rowtype; v_ws uuid; n project_number%rowtype; x record; v_client uuid; v_project uuid; v_code text;
  v_ver uuid; v_res jsonb; v_number jsonb;
begin
  select * into e from integration_event where id = p_event for update;
  v_ws := org_ws(e.organization_id);
  perform set_config('regie.source', e.source, true);
  perform set_config('regie.reason', 'Koppeling ' || e.source || ' (' || e.event_type || ')', true);

  if e.source = 'bruto' and e.event_type = 'offerte_akkoord' then
    v_code := upper(regexp_replace(coalesce(e.payload->>'number', ''), '\s', '', 'g'));
    if v_code = '' then raise exception 'Payload mist "number".'; end if;
    select * into n from project_number where organization_id = e.organization_id and number_key = v_code and kind = 'primair';
    if nullif(btrim(e.payload#>>'{client,name}'), '') is not null then
      select id into v_client from client_org where organization_id = e.organization_id
        and (bruto_client_id = e.payload#>>'{client,bruto_id}' or lower(name) = lower(btrim(e.payload#>>'{client,name}'))) limit 1;
      if v_client is null then
        insert into client_org(organization_id, name, kvk, bruto_client_id)
        values (e.organization_id, btrim(e.payload#>>'{client,name}'), e.payload#>>'{client,kvk}', e.payload#>>'{client,bruto_id}')
        returning id into v_client;
      end if;
    end if;
    if n.id is null then
      select * into x from parse_number_code(e.organization_id, v_code);
      if x.company is null then raise exception 'Nummer % heeft een onbekend formaat.', v_code; end if;
      v_number := issue_number(v_ws, x.company, x.year, 'offerte', e.payload->>'project_name', v_client, null, null, null, v_code, null, 'bruto');
      select * into n from project_number where id = (v_number->>'id')::uuid;
    end if;
    if n.project_id is not null then
      return jsonb_build_object('project_id', n.project_id, 'note', 'Nummer had al een project; niets aangemaakt.');
    end if;
    if n.status not in ('gereserveerd','pitch','offerte','losse_klus') then
      raise exception 'Nummer % staat op % en krijgt geen project.', v_code, n.status;
    end if;
    insert into project(workspace_id, company, year, name, client_org_id, is_concept, concept_payload, bruto_production_id)
    values (v_ws, n.company, n.year, coalesce(nullif(btrim(e.payload->>'project_name'), ''), n.name, v_code),
            coalesce(v_client, n.client_org_id), true, e.payload, e.payload->>'bruto_production_id')
    returning id into v_project;
    update project_number set project_id = v_project, status = 'project', client_org_id = coalesce(client_org_id, v_client) where id = n.id;
    update milestone set checked_at = now(), note = 'Uit Bruto' where project_id = v_project and kind = 'offerte_akkoord';
    insert into external_link(project_id, kind, url, label, external_id)
    select v_project, 'bruto', e.payload->>'bruto_url', 'Bruto', e.payload->>'bruto_production_id' where e.payload->>'bruto_url' ~* '^https?://';
    perform notify_project_manager(v_project, 'concept', 'Nieuw conceptproject uit Bruto: ' || v_code || ' — ter bevestiging.', 'concept:' || v_project);
    return jsonb_build_object('project_id', v_project, 'number', v_code, 'concept', true);

  elsif e.source = 'bruto' and e.event_type = 'nummer_status' then
    v_code := upper(regexp_replace(coalesce(e.payload->>'number', ''), '\s', '', 'g'));
    select * into n from project_number where organization_id = e.organization_id and number_key = v_code and kind = 'primair';
    if n.id is null then raise exception 'Onbekend nummer %.', v_code; end if;
    if n.status = 'project' then raise exception 'Nummer % hoort bij een project.', v_code; end if;
    if (e.payload->>'status') not in ('gereserveerd','pitch','offerte','losse_klus','verloren','geannuleerd') then
      raise exception 'Status % niet toegestaan via de API.', e.payload->>'status';
    end if;
    update project_number set status = (e.payload->>'status')::number_status, status_reason = e.payload->>'reason' where id = n.id;
    return jsonb_build_object('number', v_code, 'status', e.payload->>'status');

  elsif e.source = 'reviewtool' and e.event_type in ('feedback_ontvangen','goedgekeurd') then
    select v.id into v_ver from deliverable_version v join deliverable d on d.id = v.deliverable_id join project p on p.id = d.project_id
    where d.id = (e.payload->>'deliverable_id')::uuid and v.version_no = (e.payload->>'version_no')::int
      and p.workspace_id = v_ws;
    if v_ver is null then raise exception 'Onbekende deliverable/versie.'; end if;
    if e.event_type = 'feedback_ontvangen' then
      update deliverable_version set status = 'feedback_ontvangen', review_external_id = coalesce(e.payload->>'review_id', review_external_id)
      where id = v_ver and status in ('in_review','concept');
      update deliverable set status = 'wijzigingen_nodig' where required_version_id = v_ver and status = 'in_review';
      return jsonb_build_object('version_id', v_ver, 'status', 'feedback_ontvangen');
    end if;
    perform approve_version_internal(v_ver, coalesce(e.payload->>'approved_by', 'onbekend'),
      coalesce((e.payload->>'approved_at')::timestamptz, now()), coalesce(e.payload->>'evidence', 'Reviewtool'), 'reviewtool');
    return jsonb_build_object('version_id', v_ver, 'status', 'goedgekeurd');
  end if;
  raise exception 'Onbekend gebeurtenistype % voor bron %.', e.event_type, e.source;
end $$;
revoke execute on function public.process_integration_event(uuid) from authenticated;

create function public.run_event(p_event uuid) returns integration_event
language plpgsql security definer set search_path = public, pg_temp as $$
declare e integration_event%rowtype; v_res jsonb; v_err text;
begin
  begin
    v_res := process_integration_event(p_event);
    update integration_event set status = 'verwerkt', result = v_res, processed_at = now(), attempts = attempts + 1, error = null,
      next_attempt_at = null where id = p_event;
  exception when others then
    get stacked diagnostics v_err = message_text;
    update integration_event set status = 'fout', error = v_err, attempts = attempts + 1,
      next_attempt_at = case when attempts + 1 < 5 then now() + make_interval(mins => power(2, attempts + 1)::int) end
    where id = p_event;
    if (select attempts from integration_event where id = p_event) >= 5 then
      perform notify_user(m.user_id, m.workspace_id, null, 'koppeling_fout', 'Koppeling mislukt na 5 pogingen',
        v_err, '/instellingen', 'eventfout:' || p_event)
      from membership m join workspace w on w.id = m.workspace_id
      where w.organization_id = (select organization_id from integration_event where id = p_event) and m.role = 'eigenaar' and m.revoked_at is null;
    end if;
  end;
  select * into e from integration_event where id = p_event;
  return e;
end $$;
revoke execute on function public.run_event(uuid) from authenticated;

-- POST /rest/v1/rpc/api_events  (header x-regie-key). Idempotent op event_id.
create function public.api_events(p_event_id text, p_type text, p_payload jsonb, p_key text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare k api_key%rowtype; v_id uuid; e integration_event%rowtype; v_enabled boolean;
begin
  k := api_auth(p_key);
  perform require(length(btrim(coalesce(p_event_id, ''))) > 0, 'event_id ontbreekt.');
  select * into e from integration_event where organization_id = k.organization_id and source = k.source
    and external_event_id = p_event_id and status <> 'duplicaat';
  if e.id is not null then
    insert into integration_event(organization_id, source, external_event_id, event_type, payload, status, result)
    values (k.organization_id, k.source, p_event_id, p_type, coalesce(p_payload, '{}'), 'duplicaat',
            jsonb_build_object('origineel', e.id));
    return jsonb_build_object('status', 'duplicaat', 'original_status', e.status, 'result', e.result);
  end if;
  select enabled into v_enabled from integration where organization_id = k.organization_id and source = k.source;
  if not coalesce(v_enabled, false) then
    insert into integration_event(organization_id, source, external_event_id, event_type, payload, status, error)
    values (k.organization_id, k.source, p_event_id, p_type, coalesce(p_payload, '{}'), 'genegeerd', 'Koppeling staat uit.')
    returning id into v_id;
    return jsonb_build_object('status', 'genegeerd', 'reason', 'Koppeling staat uit in Regie.');
  end if;
  insert into integration_event(organization_id, source, external_event_id, event_type, payload)
  values (k.organization_id, k.source, p_event_id, p_type, coalesce(p_payload, '{}')) returning id into v_id;
  e := run_event(v_id);
  return jsonb_build_object('status', e.status, 'result', e.result, 'error', e.error);
end $$;

-- POST /rest/v1/rpc/api_reserve_number  (header x-regie-key)
create function public.api_reserve_number(p_company text, p_year int, p_name text default null, p_client text default null,
  p_op uuid default null, p_key text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare k api_key%rowtype; v_enabled boolean; v_company public.bedrijf;
begin
  k := api_auth(p_key);
  perform require(k.source = 'bruto', 'Alleen Bruto reserveert nummers via de API.');
  select enabled into v_enabled from integration where organization_id = k.organization_id and source = k.source;
  perform require(coalesce(v_enabled, false), 'Koppeling staat uit in Regie.');
  v_company := case upper(p_company) when 'SB' then 'studio_brutaal' when 'MMS' then 'moviemates'
               else p_company::public.bedrijf end;
  perform set_config('regie.source', 'bruto', true);
  return issue_number(org_ws(k.organization_id), v_company, p_year, 'gereserveerd', p_name, null, p_client, null, null, null, p_op, 'bruto');
end $$;

-- Opnieuw proberen (eigenaar, of periodiek met oplopende wachttijd).
create function public.retry_event(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e integration_event%rowtype;
begin
  perform require(org_has_role((select organization_id from integration_event where id = p_event), '{eigenaar,admin}'), 'Geen rechten.');
  perform require((select status from integration_event where id = p_event) = 'fout', 'Alleen mislukte berichten kun je opnieuw proberen.');
  e := run_event(p_event);
  return jsonb_build_object('status', e.status, 'error', e.error);
end $$;

create function public.retry_due_events() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select id from integration_event where status = 'fout' and attempts < 5 and next_attempt_at <= now() loop
    perform run_event(r.id);
  end loop;
end $$;
revoke execute on function public.retry_due_events() from authenticated;

-- Concept uit Bruto bevestigen (eventueel met voorgestelde deliverables en draaidagen).
create function public.confirm_concept_project(p_project uuid, p_take_deliverables boolean, p_take_shoot_days boolean,
  p_template_version uuid default null, p_anchor_d date default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p project%rowtype; x jsonb;
begin
  perform require(can_approve_project(p_project), 'Je mag dit concept niet bevestigen.');
  select * into p from project where id = p_project for update;
  perform require(p.is_concept, 'Dit project is geen concept.');
  update project set is_concept = false where id = p_project;
  if p_template_version is not null then perform apply_template(p_project, p_template_version, p_anchor_d, p.start_date); end if;
  if p_take_deliverables then
    for x in select * from jsonb_array_elements(coalesce(p.concept_payload->'deliverables', '[]')) loop
      insert into deliverable(project_id, title, kind, aspect_ratio, duration_text, feedback_rounds_agreed)
      values (p_project, coalesce(x->>'title', 'Deliverable'), x->>'kind', x->>'aspect_ratio', x->>'duration', nullif(x->>'feedback_rounds','')::int);
    end loop;
  end if;
  if p_take_shoot_days then
    for x in select * from jsonb_array_elements(coalesce(p.concept_payload->'shoot_days', '[]')) loop
      insert into shoot_day(project_id, date, status, location) values (p_project, (x->>'date')::date, 'optie', x->>'location');
    end loop;
  end if;
  perform evaluate_phase(p_project);
end $$;

alter table public.client_org add column kvk text, add column notes text, add column bruto_client_id text,
  add column moneybird_contact_id text;

-- ───────────────────────── Zoeken (§2 succes 3: binnen 10 seconden terugvinden) ─────────────────────────
create function public.search_all(p_ws uuid, p_q text)
returns table(kind text, id uuid, project_id uuid, title text, subtitle text, year int, archived boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_q text := '%' || lower(btrim(p_q)) || '%'; v_key text := upper(regexp_replace(coalesce(p_q,''), '\s', '', 'g'));
begin
  perform require(is_internal(p_ws), 'Geen toegang.');
  if length(btrim(coalesce(p_q, ''))) < 2 then return; end if;
  return query
  select 'nummer', n.id, n.project_id, n.number_display || coalesce(' | ' || coalesce(p.name, n.name), ''),
         replace(n.status::text, '_', ' ') || coalesce(' · ' || c.name, ''), n.year, coalesce(p.archived, false)
  from project_number n left join project p on p.id = n.project_id left join client_org c on c.id = coalesce(p.client_org_id, n.client_org_id)
  where n.organization_id = ws_org(p_ws) and (n.number_key like '%' || v_key || '%' or lower(coalesce(p.name, n.name, '')) like v_q
        or lower(coalesce(c.name, '')) like v_q)
  union all
  select 'project', p.id, p.id, p.name, coalesce(c.name, '') || ' · ' || replace(p.phase::text, '_', ' '), p.year, p.archived
  from project p left join client_org c on c.id = p.client_org_id
  where p.workspace_id = p_ws and not exists (select 1 from project_number n where n.project_id = p.id)
    and (lower(p.name) like v_q or lower(coalesce(c.name, '')) like v_q)
  union all
  select 'klant', c.id, null, c.name, 'Klant', null, false from client_org c
  where c.organization_id = ws_org(p_ws) and lower(c.name) like v_q
  union all
  select 'persoon', pe.id, null, pe.full_name, array_to_string(pe.roles, ', '), null, false from person pe
  where pe.organization_id = ws_org(p_ws) and lower(pe.full_name) like v_q
  union all
  select 'deliverable', d.id, d.project_id, d.title, p.name, p.year, p.archived from deliverable d join project p on p.id = d.project_id
  where p.workspace_id = p_ws and d.deleted_at is null and lower(d.title) like v_q
  union all
  select 'taak', t.id, t.project_id, t.title, coalesce(p.name, 'Losse taak'), p.year, coalesce(p.archived, false)
  from task t left join project p on p.id = t.project_id
  where t.workspace_id = p_ws and t.deleted_at is null and lower(t.title) like v_q
    and (t.project_id is not null or t.created_by = auth.uid() or (t.list_id is not null and can_view_list(t.list_id)))
  limit 60;
end $$;

-- ───────────────────────── Dashboard ─────────────────────────
create function public.project_label(p_project uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select number_display || ' | ' from project_number where project_id = p.id and kind = 'primair'), '') || p.name
         || coalesce(' – ' || (select name from client_org where id = p.client_org_id), '')
  from project p where p.id = p_project
$$;

create function public.dashboard(p_ws uuid, p_company public.bedrijf default null, p_person uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_today date := today_ams(); v_week date := today_ams() + 7; v_fin boolean := has_finance(p_ws);
  v_stale int := coalesce((select stale_days from org_setting where organization_id = ws_org(p_ws)), 14);
  v_me uuid := my_person_id(ws_org(p_ws)); v jsonb;
begin
  perform require(is_internal(p_ws), 'Geen toegang.');
  with proj as (
    select p.* from project p where p.workspace_id = p_ws and not p.archived and not p.is_concept and p.lifecycle <> 'geannuleerd'
      and (p_company is null or p.company = p_company) and (p_person is null or p.manager_person_id = p_person))
  select jsonb_build_object(
    'week', coalesce((select jsonb_agg(x order by x->>'date', x->>'sort') from (
        select jsonb_build_object('type', 'draaidag', 'date', s.date, 'sort', coalesce(s.start_time::text, ''), 'project_id', s.project_id,
          'object_id', s.id, 'title', coalesce(s.title, 'Draaidag') || coalesce(' · ' || s.location, ''), 'project', project_label(s.project_id),
          'status', s.status) x
        from shoot_day s join proj p on p.id = s.project_id
        where s.deleted_at is null and s.status <> 'geannuleerd' and s.date between v_today and v_week
        union all
        select jsonb_build_object('type', 'deliverable', 'date', d.deadline, 'sort', 'z', 'project_id', d.project_id, 'object_id', d.id,
          'title', 'Deadline: ' || d.title, 'project', project_label(d.project_id), 'status', d.status)
        from deliverable d join proj p on p.id = d.project_id
        where d.deleted_at is null and d.status not in ('geleverd','vervallen') and d.deadline between v_today - 30 and v_week
        union all
        select jsonb_build_object('type', 'taak', 'date', t.deadline, 'sort', 'z', 'project_id', t.project_id, 'object_id', t.id,
          'title', t.title, 'project', project_label(t.project_id), 'status', t.status)
        from task t join proj p on p.id = t.project_id
        where t.deleted_at is null and t.status not in ('klaar','vervallen') and t.deadline between v_today and v_week
          and (p_person is null or t.assignee_person_id = p_person)) q), '[]'),
    'overdue', (select count(*) from task t join proj p on p.id = t.project_id
        where t.deleted_at is null and t.status not in ('klaar','vervallen') and t.deadline < v_today),
    'waiting_client', coalesce((select jsonb_agg(jsonb_build_object('project_id', d.project_id, 'object_id', d.id,
        'title', d.title || ' v' || v.version_no, 'project', project_label(d.project_id), 'since', v.submitted_at,
        'meerwerk', d.feedback_rounds_agreed is not null and v.feedback_round > d.feedback_rounds_agreed) order by v.submitted_at)
      from deliverable d join proj p on p.id = d.project_id join deliverable_version v on v.id = d.required_version_id
      where d.deleted_at is null and d.status = 'in_review' and v.status = 'in_review'), '[]'),
    'blockers', coalesce((select jsonb_agg(b || jsonb_build_object('project_id', p.id, 'project', project_label(p.id)))
      from proj p cross join lateral jsonb_array_elements(project_status(p.id)->'blockers') b), '[]'),
    'stale', case when v_fin then coalesce((select jsonb_agg(jsonb_build_object('project_id', p.id, 'project', project_label(p.id),
        'title', s.title, 'days', s.days, 'over_threshold', s.days > v_stale) order by s.days desc)
      from proj p cross join lateral (
        select 'Nog niet gefactureerd (operationeel klaar)' title, (v_today - (p.operational_done_at at time zone 'Europe/Amsterdam')::date) days
        where p.phase = 'operationeel_klaar' and not exists (select 1 from milestone where project_id = p.id and kind = 'gefactureerd' and checked_at is not null)
        union all
        select 'Gefactureerd, betaling nog niet ontvangen', v_today - (m.checked_at at time zone 'Europe/Amsterdam')::date
        from milestone m where m.project_id = p.id and m.kind = 'gefactureerd' and m.checked_at is not null
          and not exists (select 1 from milestone where project_id = p.id and kind = 'betaling_ontvangen' and checked_at is not null)
          and v_today - (m.checked_at at time zone 'Europe/Amsterdam')::date > v_stale
        union all
        select 'Freelancers nog niet betaald', v_today - (p.operational_done_at at time zone 'Europe/Amsterdam')::date
        from milestone m where m.project_id = p.id and m.kind = 'freelancers_betaald' and m.applicable and m.checked_at is null
          and p.operational_done_at is not null and v_today - (p.operational_done_at at time zone 'Europe/Amsterdam')::date > v_stale
        union all
        select 'Debriefing staat open', v_today - (p.phase_changed_at at time zone 'Europe/Amsterdam')::date
        from milestone m where m.project_id = p.id and m.kind = 'debriefing' and m.checked_at is null and p.phase = 'afronding'
          and v_today - (p.phase_changed_at at time zone 'Europe/Amsterdam')::date > v_stale) s), '[]') end,
    'my_actions', coalesce((select jsonb_agg(jsonb_build_object('project_id', t.project_id, 'object_id', t.id, 'title', t.title,
        'deadline', t.deadline, 'status', t.status, 'project', case when t.project_id is not null then project_label(t.project_id) end)
        order by t.deadline nulls last, t.priority)
      from (select * from task t where t.workspace_id = p_ws and t.deleted_at is null and t.status not in ('klaar','vervallen')
              and t.assignee_person_id = v_me order by t.deadline nulls last limit 12) t), '[]'),
    'concepts', coalesce((select jsonb_agg(jsonb_build_object('project_id', p.id, 'project', project_label(p.id)))
      from project p where p.workspace_id = p_ws and p.is_concept and not p.archived), '[]'),
    'phases', (select jsonb_object_agg(phase, n) from (select phase, count(*) n from proj group by phase) q),
    'finance_visible', v_fin)
  into v;
  return v;
end $$;

-- Projectenoverzicht met afgeleide kolommen (vervangt de fase-1-view; RLS via security_invoker).
drop view public.project_overview;
create view public.project_overview with (security_invoker = true) as
select
  p.id, p.workspace_id, p.company, p.year, p.name, p.lifecycle, p.archived, p.workflow, p.revision,
  p.phase, p.phase_mode, p.is_concept, p.manager_person_id,
  pn.number_display as number,
  co.name as client_name,
  mp.full_name as manager_name,
  (select coalesce(array_agg(distinct pe.full_name order by pe.full_name), '{}')
     from public.assignment a join public.person pe on pe.id = a.person_id join public.deliverable d on d.id = a.deliverable_id
    where a.project_id = p.id and d.deleted_at is null and a.status in ('optie','bevestigd')) as editors,
  (select count(distinct a.person_id) from public.assignment a join public.shoot_day s on s.id = a.shoot_day_id
    where a.project_id = p.id and s.deleted_at is null and a.status in ('optie','bevestigd')) as crew_count,
  (select count(*) from public.deliverable d
    where d.project_id = p.id and d.deleted_at is null and d.scope = 'overeengekomen' and d.status <> 'vervallen') as deliverables_total,
  (select count(*) from public.deliverable d
    where d.project_id = p.id and d.deleted_at is null and d.scope = 'overeengekomen' and d.status = 'geleverd') as deliverables_delivered,
  (select count(*) from public.deliverable d
    where d.project_id = p.id and d.deleted_at is null and d.scope = 'overeengekomen' and d.status not in ('vervallen','geleverd')
      and not exists (select 1 from public.assignment a where a.deliverable_id = d.id and a.status in ('optie','bevestigd'))) as deliverables_without_editor,
  (select min(s.date) from public.shoot_day s
    where s.project_id = p.id and s.deleted_at is null and s.status <> 'geannuleerd' and s.date >= public.today_ams()) as next_shoot_date,
  (select min(x.deadline) from (
      select d.deadline from public.deliverable d where d.project_id = p.id and d.deleted_at is null and d.status not in ('geleverd','vervallen')
      union all
      select t.deadline from public.task t where t.project_id = p.id and t.deleted_at is null and t.status not in ('klaar','vervallen')) x) as next_deadline,
  public.project_status(p.id)->>'risk' as risk
from public.project p
left join public.project_number pn on pn.project_id = p.id and pn.kind = 'primair'
left join public.client_org co on co.id = p.client_org_id
left join public.person mp on mp.id = p.manager_person_id;
grant select on public.project_overview to authenticated;
revoke all on public.project_overview from anon;

-- ───────────────────────── Export (eigenaar, admin, PM) ─────────────────────────
create function public.export_data(p_ws uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := ws_org(p_ws); v_out jsonb := '{}'; v_part jsonb; t text;
begin
  perform require(my_role(p_ws) in ('eigenaar','admin','projectmanager'), 'Alleen eigenaar, admin of projectmanager exporteert.');
  select coalesce(jsonb_agg(to_jsonb(x) - 'number_key'), '[]') into v_part from project_number x where organization_id = v_org;
  v_out := v_out || jsonb_build_object('nummerregister', v_part);
  select coalesce(jsonb_agg(x), '[]') into v_part from client_org x where organization_id = v_org;
  v_out := v_out || jsonb_build_object('klanten', v_part);
  select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('email', pc.email, 'phone', pc.phone)), '[]') into v_part
    from person x left join person_contact pc on pc.person_id = x.id where x.organization_id = v_org;
  v_out := v_out || jsonb_build_object('personen', v_part);
  select coalesce(jsonb_agg(x), '[]') into v_part from project x where workspace_id = p_ws;
  v_out := v_out || jsonb_build_object('projecten', v_part);
  foreach t in array array['milestone','deliverable','shoot_day','assignment','equipment_item','decision','comment','external_link'] loop
    execute format('select coalesce(jsonb_agg(x), ''[]'') from %I x where project_id in (select id from project where workspace_id = $1)', t)
      into v_part using p_ws;
    v_out := v_out || jsonb_build_object(t, v_part);
  end loop;
  select coalesce(jsonb_agg(x), '[]') into v_part from deliverable_version x
    where deliverable_id in (select d.id from deliverable d join project p on p.id = d.project_id where p.workspace_id = p_ws);
  v_out := v_out || jsonb_build_object('deliverable_version', v_part);
  select coalesce(jsonb_agg(x), '[]') into v_part from task x where workspace_id = p_ws and project_id is not null;
  v_out := v_out || jsonb_build_object('task', v_part);
  select coalesce(jsonb_agg(x), '[]') into v_part from template_version x
    where template_id in (select id from template where organization_id = v_org);
  v_out := v_out || jsonb_build_object('template_version', v_part);
  return v_out;
end $$;

-- ───────────────────────── Offline-momentopname (fase 7: alleen lezen) ─────────────────────────
create function public.offline_snapshot() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ws uuid; v_shoots jsonb; v_tasks jsonb;
begin
  select m.workspace_id into v_ws from membership m where m.user_id = auth.uid() and m.revoked_at is null order by m.created_at limit 1;
  perform require(v_ws is not null, 'Geen toegang.');
  if is_internal(v_ws) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'date', s.date, 'start_time', s.start_time, 'end_time', s.end_time, 'location', s.location, 'status', s.status,
      'title', s.title, 'callsheet_link', s.callsheet_link, 'callsheet_note', s.callsheet_note, 'project', project_label(s.project_id),
      'project_id', s.project_id,
      'crew', (select jsonb_agg(jsonb_build_object('name', pe.full_name, 'role', a.role_label, 'status', a.status,
                 'phone', case when my_role(v_ws) <> 'stagiair' then pc.phone end) order by pe.full_name)
               from assignment a join person pe on pe.id = a.person_id left join person_contact pc on pc.person_id = pe.id
               where a.shoot_day_id = s.id and a.status in ('optie','bevestigd')),
      'equipment', (select jsonb_agg(jsonb_build_object('description', e.description, 'picked_up', e.picked_up, 'returned', e.returned))
                    from equipment_item e where e.shoot_day_id = s.id and e.deleted_at is null)) order by s.date, s.start_time), '[]')
    into v_shoots
    from shoot_day s join project p on p.id = s.project_id
    where p.workspace_id = v_ws and s.deleted_at is null and s.status <> 'geannuleerd' and s.date between today_ams() and today_ams() + 7;
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'deadline', t.deadline,
      'project', case when t.project_id is not null then project_label(t.project_id) end) order by t.deadline nulls last), '[]')
    into v_tasks from task t
    where t.workspace_id = v_ws and t.deleted_at is null and t.status not in ('klaar','vervallen')
      and t.assignee_person_id = my_person_id(ws_org(v_ws));
  else
    v_shoots := crew_shoot_days(today_ams(), today_ams() + 7);
    v_tasks := crew_tasks();
  end if;
  return jsonb_build_object('generated_at', now(), 'shoot_days', v_shoots, 'tasks', v_tasks);
end $$;

-- ───────────────────────── Statuspagina ─────────────────────────
create function public.system_status(p_ws uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := ws_org(p_ws);
begin
  perform require(my_role(p_ws) in ('eigenaar','admin'), 'Alleen eigenaar of admin.');
  return jsonb_build_object(
    'integrations', (select jsonb_agg(jsonb_build_object('source', source, 'enabled', enabled) order by source) from integration where organization_id = v_org),
    'events_failed', (select count(*) from integration_event where organization_id = v_org and status = 'fout'),
    'events_recent', (select coalesce(jsonb_agg(x order by x->>'received_at' desc), '[]') from (
        select jsonb_build_object('id', id, 'source', source, 'type', event_type, 'event_id', external_event_id, 'status', status,
          'attempts', attempts, 'error', error, 'received_at', received_at) x
        from integration_event where organization_id = v_org order by received_at desc limit 30) q),
    'automations_failed', (select count(*) from automation_run where workspace_id = p_ws and status = 'fout'),
    'automations_recent', (select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]') from (
        select jsonb_build_object('id', id, 'kind', kind, 'status', status, 'summary', summary, 'project_id', project_id,
          'created_at', created_at) x
        from automation_run where workspace_id = p_ws order by created_at desc limit 30) q),
    'api_keys', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'source', source, 'label', label, 'prefix', key_prefix,
        'created_at', created_at, 'revoked_at', revoked_at, 'last_used_at', last_used_at) order by created_at desc), '[]')
      from api_key where organization_id = v_org),
    'cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
    'last_backup', null, 'last_export', null);
end $$;

-- ───────────────────────── Standaardinrichting per organisatie (T1–T3, koppelingen) ─────────────────────────
create function public.seed_organization(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t uuid;
begin
  insert into company_setting(organization_id, company, prefix, digits)
  values (p_org, 'studio_brutaal', 'SB', 3), (p_org, 'moviemates', 'MMS', 3) on conflict do nothing;
  insert into org_setting(organization_id) values (p_org) on conflict do nothing;
  insert into integration(organization_id, source)
  select p_org, s from unnest(array['bruto','reviewtool','dropbox','moneybird','overig']) s on conflict do nothing;
  if exists (select 1 from template where organization_id = p_org) then return; end if;

  insert into template(organization_id, name, company, description)
  values (p_org, 'Merkfilm/bedrijfsfilm', 'studio_brutaal', 'T1 · Gebaseerd op de Asana-werkwijze; termijnen zijn voorstellen.')
  returning id into v_t;
  insert into template_version(template_id, version_no, content) values (v_t, 1, '{
    "freelancers_betaald": true,
    "shoot_days": [{"title": "Draaidag 1", "offset_days": 0}],
    "deliverables": [{"title": "Hoofdfilm", "kind": "hoofdfilm", "aspect_ratio": "16:9", "feedback_rounds": 2}],
    "tasks": [
      {"title": "Brainstorm/concept", "phase": "pre_productie", "anchor": "S", "offset": 3},
      {"title": "Productiedocumenten", "phase": "pre_productie", "anchor": "D", "offset": -10},
      {"title": "Freelancers vastleggen", "phase": "pre_productie", "anchor": "D", "offset": -10},
      {"title": "Muziek en voice-over kiezen", "phase": "pre_productie", "anchor": "D", "offset": -7},
      {"title": "Projectgroepsapp aanmaken", "phase": "pre_productie", "anchor": "D", "offset": -7},
      {"title": "Briefing crew", "phase": "pre_productie", "anchor": "D", "offset": -3},
      {"title": "Callsheet", "phase": "pre_productie", "anchor": "D", "offset": -2},
      {"title": "Apparatuur ophalen", "phase": "pre_productie", "anchor": "D", "offset": -1},
      {"title": "Gear prep", "phase": "pre_productie", "anchor": "D", "offset": -1},
      {"title": "Edit v1", "phase": "post_productie", "anchor": "L", "offset": 5},
      {"title": "Stills online zetten", "phase": "post_productie", "anchor": "L", "offset": 5},
      {"title": "Klant uitnodigen in editsuite/review", "phase": "post_productie", "anchor": "L", "offset": 6},
      {"title": "Feedback verwerken", "phase": "post_productie"},
      {"title": "Definitieve export en oplevering", "phase": "post_productie"},
      {"title": "Apparatuur terugbrengen", "phase": "afronding", "anchor": "L", "offset": 1},
      {"title": "Debriefing", "phase": "afronding"},
      {"title": "Publicatie", "phase": "afronding"},
      {"title": "Behind the scenes", "phase": "afronding"},
      {"title": "Opvolging volgende productie", "phase": "afronding", "description": "Richtlijn: 14 kalenderdagen na oplevering."}
    ]}'::jsonb);

  insert into template(organization_id, name, company, description)
  values (p_org, 'Festivalaftermovie', 'moviemates', 'T2 · Kortere termijnen, meerdere draaidagen (vaak weekend). Voorstel.')
  returning id into v_t;
  insert into template_version(template_id, version_no, content) values (v_t, 1, '{
    "freelancers_betaald": true,
    "shoot_days": [{"title": "Festivaldag 1", "offset_days": 0}, {"title": "Festivaldag 2", "offset_days": 1}],
    "deliverables": [
      {"title": "Aftermovie", "kind": "aftermovie", "aspect_ratio": "16:9", "feedback_rounds": 2},
      {"title": "Cut-down", "kind": "cut-down", "aspect_ratio": "9:16", "feedback_rounds": 2}],
    "tasks": [
      {"title": "Afstemming met organisatie", "phase": "pre_productie", "anchor": "D", "offset": -14},
      {"title": "Crew en accreditatie", "phase": "pre_productie", "anchor": "D", "offset": -7},
      {"title": "Callsheet", "phase": "pre_productie", "anchor": "D", "offset": -2},
      {"title": "Apparatuur ophalen", "phase": "pre_productie", "anchor": "D", "offset": -1},
      {"title": "Gear prep", "phase": "pre_productie", "anchor": "D", "offset": -1},
      {"title": "Stills/selectie online", "phase": "post_productie", "anchor": "L", "offset": 2},
      {"title": "Aftermovie v1", "phase": "post_productie", "anchor": "L", "offset": 3},
      {"title": "Klant uitnodigen in review", "phase": "post_productie"},
      {"title": "Feedback verwerken", "phase": "post_productie"},
      {"title": "Definitieve export en oplevering", "phase": "post_productie"},
      {"title": "Apparatuur terugbrengen", "phase": "afronding", "anchor": "L", "offset": 1},
      {"title": "Debriefing", "phase": "afronding"},
      {"title": "Publicatie", "phase": "afronding"},
      {"title": "Behind the scenes", "phase": "afronding"},
      {"title": "Opvolging volgende productie", "phase": "afronding"}
    ]}'::jsonb);

  insert into template(organization_id, name, company, description)
  values (p_org, 'Socialcontentpakket', null, 'T3 · Deliverablegroep met varianten; elke variant eigen status en versies.')
  returning id into v_t;
  insert into template_version(template_id, version_no, content) values (v_t, 1, '{
    "freelancers_betaald": true,
    "shoot_days": [{"title": "Draaidag 1", "offset_days": 0}],
    "deliverables": [
      {"title": "Social 9:16 #1", "group": "Socialpakket", "aspect_ratio": "9:16", "kind": "social"},
      {"title": "Social 9:16 #2", "group": "Socialpakket", "aspect_ratio": "9:16", "kind": "social"},
      {"title": "Social 9:16 #3", "group": "Socialpakket", "aspect_ratio": "9:16", "kind": "social"},
      {"title": "Social 1:1", "group": "Socialpakket", "aspect_ratio": "1:1", "kind": "social"},
      {"title": "Social 16:9", "group": "Socialpakket", "aspect_ratio": "16:9", "kind": "social"}],
    "tasks": [
      {"title": "Contentplan", "phase": "pre_productie", "anchor": "S", "offset": 5},
      {"title": "Edit", "phase": "post_productie", "per_deliverable": true},
      {"title": "Review Socialpakket", "phase": "post_productie"},
      {"title": "Oplevering", "phase": "post_productie"}
    ]}'::jsonb);
end $$;
revoke execute on function public.seed_organization(uuid) from authenticated;

create function public.tg_seed_organization() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform seed_organization(new.id);
  return null;
end $$;
create trigger seed after insert on public.organization for each row execute function public.tg_seed_organization();

do $$ declare r record; begin
  for r in select id from public.organization loop perform public.seed_organization(r.id); end loop;
end $$;

-- ───────────────────────── RLS en grants ─────────────────────────
alter table public.invitation enable row level security;
alter table public.integration enable row level security;
alter table public.api_key enable row level security;
alter table public.integration_event enable row level security;
create policy sel on public.integration for select to authenticated using (public.org_has_role(organization_id, '{eigenaar,admin}'));
create policy sel on public.integration_event for select to authenticated using (public.org_has_role(organization_id, '{eigenaar,admin}'));
-- invitation en api_key: geen select-policy; alleen via functies (hashes blijven verborgen).

revoke all on public.invitation, public.integration, public.api_key, public.integration_event from anon;
revoke insert, update, delete on public.invitation, public.integration, public.api_key, public.integration_event from authenticated;
revoke insert, update on public.client_org from anon;

-- API-functies zijn de enige ingang voor externe tools (zonder gebruikerslogin).
grant execute on function public.api_events(text, text, jsonb, text), public.api_reserve_number(text, int, text, text, uuid, text) to anon;

do $$ declare t text; begin
  foreach t in array array['invitation','integration','api_key'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
  end loop;
end $$;

-- ───────────────────────── Realtime ─────────────────────────
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['project','project_number','task','deliverable','deliverable_version','shoot_day','assignment',
                             'equipment_item','milestone','comment','notification','decision','external_link','task_list'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;

-- ───────────────────────── Periodieke taak (pg_cron, indien beschikbaar) ─────────────────────────
do $$
begin
  begin
    create extension if not exists pg_cron;
    perform cron.schedule('regie-tick', '*/5 * * * *', 'select public.tick_all(); select public.retry_due_events();');
  exception when others then
    raise notice 'pg_cron niet beschikbaar: fases en meldingen worden bijgewerkt bij het laden van het dashboard.';
  end;
end $$;

-- Audit-log ook voor projectmanagers (rol met financiële rechten); medewerker en stagiair zien het niet.
drop policy sel on public.audit_log;
create policy sel on public.audit_log for select to authenticated
  using (workspace_id is not null and public.my_role(workspace_id) in ('eigenaar','admin','projectmanager'));

-- Persoonstype (§4): intern, freelancer, klantcontact of overig; klantcontact hoort bij een klant.
alter table public.person
  add column kind text not null default 'overig' check (kind in ('intern','freelancer','klantcontact','overig')),
  add column client_org_id uuid references public.client_org(id);
update public.person set kind = 'intern' where user_id is not null;

-- ───────────────────────── Tweestapsverificatie (§3) ─────────────────────────
-- Wie een tweede factor heeft ingesteld, krijgt alleen toegang met een sessie op niveau aal2.
-- Zo kan een gestolen wachtwoord alleen geen toegang geven. Afgedwongen in de database, niet alleen in de app.
create function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;

create or replace function public.my_role(p_ws uuid) returns public.app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from membership
  where workspace_id = p_ws and user_id = auth.uid() and revoked_at is null and public.mfa_ok()
$$;

create or replace function public.org_has_role(p_org uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.mfa_ok() and exists (
    select 1 from membership m join workspace w on w.id = m.workspace_id
    where w.organization_id = p_org and m.user_id = auth.uid()
      and m.revoked_at is null and m.role = any(p_roles))
$$;

create or replace function public.my_context()
returns table(workspace_id uuid, workspace_name text, organization_id uuid, role public.app_role, person_id uuid, person_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.name, w.organization_id, m.role, pe.id, pe.full_name
  from membership m join workspace w on w.id = m.workspace_id
  left join person pe on pe.organization_id = w.organization_id and pe.user_id = m.user_id
  where m.user_id = auth.uid() and m.revoked_at is null and public.mfa_ok()
  order by w.created_at
$$;

create or replace function public.my_person_ids() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(pe.id), '{}') from person pe
  join workspace w on w.organization_id = pe.organization_id
  join membership m on m.workspace_id = w.id and m.user_id = auth.uid() and m.revoked_at is null
  where pe.user_id = auth.uid() and public.mfa_ok()
$$;

-- Eigenaar zonder tweede factor: zichtbaar maken in de app (instellen is verplicht volgens §3).
create function public.owner_without_mfa(p_ws uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select my_role(p_ws) = 'eigenaar' and not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
grant execute on function public.mfa_ok(), public.owner_without_mfa(uuid) to authenticated;
