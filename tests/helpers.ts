import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Status = { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string; DB_URL: string };

let status: Status | undefined;
export function localStatus(): Status {
  if (!status) {
    const out = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    status = JSON.parse(out.slice(out.indexOf('{'))) as Status;
    if (!status.API_URL.includes('127.0.0.1') && !status.API_URL.includes('localhost')) {
      throw new Error('Tests draaien alleen tegen de lokale Supabase-stack.');
    }
  }
  return status;
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export function adminClient(): SupabaseClient {
  const s = localStatus();
  return createClient(s.API_URL, s.SERVICE_ROLE_KEY, opts);
}

export function anonClient(): SupabaseClient {
  const s = localStatus();
  return createClient(s.API_URL, s.ANON_KEY, opts);
}

export const RUN = Math.random().toString(36).slice(2, 8);
const PASSWORD = 'test-wachtwoord-123!';

export async function createUser(label: string): Promise<{ id: string; email: string; client: SupabaseClient }> {
  const email = `test-${label}-${RUN}@regie.test`;
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  const client = anonClient();
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  return { id: data.user!.id, email, client };
}

/** Testorganisatie, gemarkeerd als is_test, met een eigenaar. */
export async function createTestOrg() {
  const admin = adminClient();
  const owner = await createUser('eigenaar');
  const org = must(await admin.from('organization').insert({ name: `TEST ${RUN}`, is_test: true }).select().single());
  const ws = must(await admin.from('workspace').insert({ organization_id: org.id, name: 'Testwerkruimte' }).select().single());
  must(await admin.from('membership').insert({ workspace_id: ws.id, user_id: owner.id, role: 'eigenaar' }).select());
  must(await admin.from('person').insert({ organization_id: org.id, full_name: 'Test Eigenaar', user_id: owner.id }).select());
  return { orgId: org.id as string, wsId: ws.id as string, owner };
}

export async function addMember(owner: SupabaseClient, wsId: string, label: string, role: string) {
  const u = await createUser(label);
  const { error } = await owner.rpc('add_member', { p_ws: wsId, p_email: u.email, p_role: role, p_full_name: `Test ${label}` });
  if (error) throw error;
  return u;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function must(res: { data: unknown; error: unknown }): any {
  if (res.error) throw res.error;
  return res.data;
}

/** Ruimt alle data van testorganisaties op (alleen lokaal, alleen is_test). */
export function cleanupTestData() {
  const s = localStatus();
  const sql = `
    begin;
    create temp table t_org as select id from public.organization where is_test;
    create temp table t_ws as select id from public.workspace where organization_id in (select id from t_org);
    create temp table t_proj as select id from public.project where workspace_id in (select id from t_ws);
    set session_replication_role = replica;
    delete from public.task_deliverable where task_id in (select id from public.task where workspace_id in (select id from t_ws));
    delete from public.task where workspace_id in (select id from t_ws);
    delete from public.approval where deliverable_id in (select id from public.deliverable where project_id in (select id from t_proj));
    delete from public.assignment where project_id in (select id from t_proj);
    delete from public.deliverable_version where deliverable_id in (select id from public.deliverable where project_id in (select id from t_proj));
    delete from public.deliverable where project_id in (select id from t_proj);
    delete from public.shoot_day where project_id in (select id from t_proj);
    delete from public.project_number where organization_id in (select id from t_org);
    delete from public.project_member where project_id in (select id from t_proj);
    delete from public.project where id in (select id from t_proj);
    delete from public.person_contact where person_id in (select id from public.person where organization_id in (select id from t_org));
    delete from public.person where organization_id in (select id from t_org);
    delete from public.client_org where organization_id in (select id from t_org);
    delete from public.membership where workspace_id in (select id from t_ws);
    delete from public.audit_log where workspace_id in (select id from t_ws) or project_id in (select id from t_proj);
    delete from public.workspace where id in (select id from t_ws);
    delete from public.organization where id in (select id from t_org);
    delete from auth.users where email like 'test-%@regie.test';
    commit;`;
  execSync(`psql "${s.DB_URL}" -v ON_ERROR_STOP=1 -q`, { input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
}
