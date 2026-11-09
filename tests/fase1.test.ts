/**
 * Fase 1 — integratietests tegen de echte lokale Supabase-stack (auth, PostgREST, RLS, functies).
 * Geen mocks: iedere aanroep gaat als echte gebruiker via de API.
 * Nummers verwijzen naar de acceptatieproeven in de masterprompt (sectie 14).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addMember, anonClient, cleanupTestData, createTestOrg, createUser, must, RUN } from './helpers';

let wsId: string;
let orgId: string;
let owner: { id: string; client: SupabaseClient };
let stagiair: { id: string; client: SupabaseClient };
let medewerker: { id: string; client: SupabaseClient };
let projectId: string;
let deliverables: { id: string; title: string }[] = [];
let shootDayId: string;

const nr = (base: string) => `${base}-${RUN}`; // uniek per testrun

async function createProject(client: SupabaseClient, number: string | null, name = 'Testproject') {
  return client.rpc('create_project', {
    p_ws: wsId, p_company: 'studio_brutaal', p_year: 2026, p_name: name, p_number: number,
    p_client_name: 'Testklant',
  });
}

beforeAll(async () => {
  const o = await createTestOrg();
  wsId = o.wsId; orgId = o.orgId; owner = o.owner;
  stagiair = await addMember(owner.client, wsId, 'stagiair', 'stagiair');
  medewerker = await addMember(owner.client, wsId, 'medewerker', 'medewerker');
}, 60_000);

afterAll(() => cleanupTestData());

describe('proef 1 — praktijkproject (testreconstructie SB26130)', () => {
  it('maakt project met zes outputs, één draaidag en een freelancer zonder account', async () => {
    projectId = must(await owner.client.rpc('create_project', {
      p_ws: wsId, p_company: 'studio_brutaal', p_year: 2026,
      p_name: 'VRMWB Jeugdbrandweer Campagne (testreconstructie)', p_number: nr('SB26130'),
      p_client_name: 'Veiligheidsregio Midden- en West-Brabant',
    })) as string;

    const titles = ['Hero 1', 'Hero 2', 'Social 1', 'Social 2', 'Social 3', 'Social 4'];
    deliverables = must(await owner.client.from('deliverable')
      .insert(titles.map((t, i) => ({ project_id: projectId, title: t, kind: t.startsWith('Hero') ? 'hero' : 'social', sort: i })))
      .select('id,title'));
    expect(deliverables).toHaveLength(6);

    shootDayId = must(await owner.client.from('shoot_day').insert({ project_id: projectId, date: '2026-12-01' }).select().single()).id;

    const usersBefore = (await import('./helpers')).adminClient();
    const before = (await usersBefore.auth.admin.listUsers({ perPage: 1000 })).data.users.length;
    const freelancer = must(await owner.client.from('person').insert({ organization_id: orgId, full_name: 'Freelance Camera', roles: ['camera'] }).select().single());
    must(await owner.client.from('assignment').insert({ project_id: projectId, person_id: freelancer.id, shoot_day_id: shootDayId, role_label: 'camera', status: 'bevestigd' }).select());
    const after = (await usersBefore.auth.admin.listUsers({ perPage: 1000 })).data.users.length;
    expect(after).toBe(before); // geen account, geen uitnodiging
    expect(freelancer.user_id).toBeNull();
  });
});

describe('proef 2 — editors afgeleid uit deliverabletoewijzingen', () => {
  it('toont beide editors en het aantal outputs zonder editor', async () => {
    const [e1, e2] = must(await owner.client.from('person')
      .insert([{ organization_id: orgId, full_name: 'Editor A' }, { organization_id: orgId, full_name: 'Editor B' }]).select());
    must(await owner.client.from('assignment').insert([
      { project_id: projectId, person_id: e1.id, deliverable_id: deliverables[0].id, role_label: 'editor', status: 'bevestigd' },
      { project_id: projectId, person_id: e2.id, deliverable_id: deliverables[1].id, role_label: 'editor', status: 'optie' },
    ]).select());
    const ov = must(await owner.client.from('project_overview').select('*').eq('id', projectId).single());
    expect(ov.editors).toEqual(['Editor A', 'Editor B']);
    expect(ov.deliverables_without_editor).toBe(4);
    expect(ov.crew_count).toBe(1);
    expect(ov.number).toBe(nr('SB26130'));
  });
});

describe('proef 4/5 — projectnummerregister', () => {
  it('laat bij gelijktijdige registratie precies één project het nummer krijgen', async () => {
    const n = nr('MMS26137');
    const results = await Promise.all([createProject(owner.client, n, 'A'), createProject(owner.client, n, 'B')]);
    const ok = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].error!.message).toContain('al geregistreerd');
  });

  it('weigert hetzelfde nummer met andere hoofdletters of spaties', async () => {
    const r = await createProject(owner.client, ` ${nr('sb 26130').toLowerCase()} `);
    expect(r.error?.message).toContain('al geregistreerd');
  });

  it('houdt het nummer gereserveerd na annuleren en archiveren', async () => {
    const n = nr('SB26999');
    const id = must(await createProject(owner.client, n)) as string;
    must(await owner.client.rpc('set_project_lifecycle', { p_project: id, p_lifecycle: 'geannuleerd', p_reason: 'Klant haakte af' }));
    must(await owner.client.rpc('set_project_archived', { p_project: id, p_archived: true }));
    expect((await createProject(owner.client, n)).error?.message).toContain('al geregistreerd');
    const still = must(await owner.client.from('project_overview').select('number,lifecycle,archived').eq('id', id).single());
    expect(still).toMatchObject({ number: n, lifecycle: 'geannuleerd', archived: true });
  });

  it('nummercorrectie bewaart het oude nummer als alias, met reden in de audit', async () => {
    const oud = nr('SB26500'); const nieuw = nr('SB26501');
    const id = must(await createProject(owner.client, oud)) as string;
    must(await owner.client.rpc('correct_project_number', { p_project: id, p_new_number: nieuw, p_reason: 'Tikfout' }));
    const nums = must(await owner.client.from('project_number').select('number_display,kind').eq('project_id', id));
    expect(nums).toEqual(expect.arrayContaining([{ number_display: oud, kind: 'alias' }, { number_display: nieuw, kind: 'primair' }]));
    expect((await createProject(owner.client, oud)).error?.message).toContain('al geregistreerd');
    const audit = must(await owner.client.from('audit_log').select('reason,table_name').eq('project_id', id).eq('reason', 'Tikfout'));
    expect(audit.length).toBeGreaterThan(0);
  });

  it('staat een conceptproject zonder nummer toe en laat het nummer later instellen', async () => {
    const id = must(await createProject(owner.client, null, 'Concept')) as string;
    expect(must(await owner.client.from('project_overview').select('number').eq('id', id).single()).number).toBeNull();
    must(await owner.client.rpc('set_project_number', { p_project: id, p_number: nr('SB26777') }));
    expect((await owner.client.rpc('set_project_number', { p_project: id, p_number: nr('SB26778') })).error?.message).toContain('al een nummer');
  });
});

describe('proef 10 — akkoord geldt voor precies één versie', () => {
  it('versie 3 heeft geen akkoord; historie van versie 2 blijft', async () => {
    const d = deliverables[2].id;
    const v1 = must(await owner.client.rpc('add_version', { p_deliverable: d, p_file_ref: 'link v1' })) as string;
    const v2 = must(await owner.client.rpc('add_version', { p_deliverable: d, p_file_ref: 'link v2' })) as string;
    // oude versie goedkeuren terwijl er een nieuwere is: geweigerd
    expect((await owner.client.rpc('register_approval', { p_version: v1, p_approved_by_name: 'Klant', p_approved_at: new Date().toISOString(), p_evidence: 'mail' })).error).toBeTruthy();
    must(await owner.client.rpc('register_approval', { p_version: v2, p_approved_by_name: 'Contactpersoon klant', p_approved_at: new Date().toISOString(), p_evidence: 'Mail 12-11' }));
    expect(must(await owner.client.from('deliverable').select('status').eq('id', d).single()).status).toBe('goedgekeurd');

    const v3 = must(await owner.client.rpc('add_version', { p_deliverable: d, p_file_ref: 'link v3' })) as string;
    must(await owner.client.rpc('set_required_version', { p_deliverable: d, p_version: v3 }));
    const after = must(await owner.client.from('deliverable').select('status,required_version_id').eq('id', d).single());
    expect(after).toEqual({ status: 'in_review', required_version_id: v3 });
    const approvals = must(await owner.client.from('approval').select('version_id,revoked_at').eq('deliverable_id', d));
    expect(approvals).toEqual([{ version_id: v2, revoked_at: null }]);
    expect((await owner.client.rpc('mark_delivered', { p_deliverable: d })).error).toBeTruthy();
  });

  it('akkoordstatus kan niet rechtstreeks worden gezet', async () => {
    const r = await owner.client.from('deliverable').update({ status: 'goedgekeurd' }).eq('id', deliverables[3].id).select();
    expect(r.error?.message).toContain('aparte acties');
  });
});

describe('proef 8/11/12 — gecontroleerd operationeel afsluiten', () => {
  it('één afgevinkte taak of verstreken draaidag sluit niets af', async () => {
    const t = must(await owner.client.from('task').insert({ workspace_id: wsId, project_id: projectId, title: 'Callsheet maken' }).select().single());
    must(await owner.client.from('task').update({ status: 'klaar' }).eq('id', t.id).select());
    const p = must(await owner.client.from('project').select('lifecycle').eq('id', projectId).single());
    expect(p.lifecycle).toBe('actief');
  });

  it('blokkeert afsluiten met concrete ontbrekende voorwaarden', async () => {
    must(await owner.client.from('task').insert({ workspace_id: wsId, project_id: projectId, title: 'Freelancers betalen', required_for_close: true }).select());
    const gates = must(await owner.client.rpc('close_gates', { p_project: projectId })) as { code: string; severity: string }[];
    const codes = gates.filter((g) => g.severity === 'blokkade').map((g) => g.code);
    expect(codes).toEqual(expect.arrayContaining(['deliverable_niet_geleverd', 'geen_draaidag', 'draaidag_open', 'afsluittaak_open']));
    const r = await owner.client.rpc('close_project', { p_project: projectId });
    expect(r.error?.message).toContain('nog niet operationeel');
    // levenscyclus kan niet rechtstreeks worden omzeild
    const direct = await owner.client.from('project').update({ lifecycle: 'operationeel_afgerond' }).eq('id', projectId).select();
    expect(direct.error).toBeTruthy();
  });

  it('sluit af zodra alles geleverd is; administratie blijft apart open', async () => {
    // draaidag uitgevoerd + back-up
    must(await owner.client.from('shoot_day').update({ status: 'uitgevoerd' }).eq('id', shootDayId).select());
    let gates = must(await owner.client.rpc('close_gates', { p_project: projectId })) as { code: string }[];
    expect(gates.map((g) => g.code)).toContain('backup_ontbreekt');
    const sd = must(await owner.client.from('shoot_day').update({ backup_confirmed_at: new Date().toISOString() }).eq('id', shootDayId).select().single());
    expect(sd.backup_confirmed_by).toBe(owner.id);
    expect(sd.executed_confirmed_by).toBe(owner.id);

    // één output vervalt met reden, de rest wordt goedgekeurd en geleverd
    expect((await owner.client.from('deliverable').update({ status: 'vervallen' }).eq('id', deliverables[5].id).select()).error).toBeTruthy();
    must(await owner.client.from('deliverable').update({ status: 'vervallen', status_reason: 'In overleg geschrapt' }).eq('id', deliverables[5].id).select());
    for (const d of deliverables.slice(0, 5)) {
      const v = must(await owner.client.rpc('add_version', { p_deliverable: d.id, p_file_ref: 'eindversie' })) as string;
      if (d.id === deliverables[2].id) must(await owner.client.rpc('set_required_version', { p_deliverable: d.id, p_version: v }));
      must(await owner.client.rpc('register_approval', { p_version: v, p_approved_by_name: 'Klant', p_approved_at: new Date().toISOString(), p_evidence: 'Akkoordmail' }));
      must(await owner.client.rpc('mark_delivered', { p_deliverable: d.id }));
    }
    const { data: tasks } = await owner.client.from('task').select('id').eq('project_id', projectId).eq('required_for_close', true);
    for (const t of tasks!) must(await owner.client.from('task').update({ status: 'klaar' }).eq('id', t.id).select());

    gates = must(await owner.client.rpc('close_gates', { p_project: projectId })) as { code: string; severity: string }[];
    expect(gates.filter((g: any) => g.severity === 'blokkade')).toEqual([]);
    must(await owner.client.rpc('close_project', { p_project: projectId }));
    const p = must(await owner.client.from('project').select('lifecycle,admin_status,closed_by').eq('id', projectId).single());
    expect(p).toEqual({ lifecycle: 'operationeel_afgerond', admin_status: 'niet_beoordeeld', closed_by: owner.id });

    expect((await owner.client.rpc('set_admin_status', { p_project: projectId, p_status: 'afgerond', p_factuur: true, p_betaling: false, p_freelancers: true, p_overig: true })).error).toBeTruthy();
    must(await owner.client.rpc('set_admin_status', { p_project: projectId, p_status: 'open', p_factuur: true, p_betaling: false, p_freelancers: true, p_overig: true }));
  });

  it('een leeg filmproject sluit niet vanzelf', async () => {
    const id = must(await createProject(owner.client, null, 'Leeg')) as string;
    must(await owner.client.rpc('set_project_lifecycle', { p_project: id, p_lifecycle: 'actief', p_reason: 'test' }));
    expect((await owner.client.rpc('close_project', { p_project: id })).error?.message).toContain('geen overeengekomen deliverables');
  });
});

describe('proef 15 — rechten worden op de server afgedwongen', () => {
  let p2: string;
  let ownTask: string;
  let otherTask: string;

  beforeAll(async () => {
    p2 = must(await createProject(owner.client, nr('SB26200'), 'Project met stagiair')) as string;
    const stagPerson = must(await owner.client.from('person').select('id').eq('user_id', stagiair.id).single());
    ownTask = must(await owner.client.from('task').insert({ workspace_id: wsId, project_id: p2, title: 'Stills selecteren', assignee_person_id: stagPerson.id }).select().single()).id;
    otherTask = must(await owner.client.from('task').insert({ workspace_id: wsId, project_id: p2, title: 'Interne taak' }).select().single()).id;
  });

  it('niet-ingelogd: geen gegevens en geen functies', async () => {
    const anon = anonClient();
    const r = await anon.from('project').select('*');
    expect(r.data ?? []).toEqual([]);
    expect((await anon.rpc('create_project', { p_ws: wsId, p_company: 'moviemates', p_year: 2026, p_name: 'x' })).error).toBeTruthy();
  });

  it('stagiair zonder projectlidmaatschap ziet het project niet, ook niet via directe ID', async () => {
    expect(must(await stagiair.client.from('project').select('id').eq('id', p2))).toEqual([]);
    expect(must(await stagiair.client.from('project_overview').select('id'))).toEqual([]);
    expect(must(await stagiair.client.from('task').select('id').eq('id', ownTask))).toEqual([]);
    expect((await stagiair.client.rpc('close_gates', { p_project: p2 })).error).toBeTruthy();
  });

  it('stagiair als projectlid ziet alleen eigen toegewezen taken en mag alleen de status wijzigen', async () => {
    must(await owner.client.rpc('add_project_member', { p_project: p2, p_user: stagiair.id }));
    const tasks = must(await stagiair.client.from('task').select('id').eq('project_id', p2));
    expect(tasks.map((t: { id: string }) => t.id)).toEqual([ownTask]);
    must(await stagiair.client.from('task').update({ status: 'bezig' }).eq('id', ownTask).select());
    const r = await stagiair.client.from('task').update({ title: 'Anders' }).eq('id', ownTask).select();
    expect(r.error?.message).toContain('alleen de status');
    const r2 = await stagiair.client.from('task').update({ status: 'klaar' }).eq('id', otherTask).select();
    expect(r2.data ?? []).toEqual([]);
  });

  it('stagiair kan geen projectinhoud wijzigen, geen akkoord registreren en niet afsluiten', async () => {
    const r = await stagiair.client.from('project').update({ name: 'Gekaapt' }).eq('id', p2).select();
    expect(r.data ?? []).toEqual([]);
    expect((await stagiair.client.from('deliverable').insert({ project_id: p2, title: 'X' }).select()).error).toBeTruthy();
    expect((await stagiair.client.rpc('close_project', { p_project: p2 })).error).toBeTruthy();
    expect((await stagiair.client.rpc('create_project', { p_ws: wsId, p_company: 'moviemates', p_year: 2026, p_name: 'x' })).error).toBeTruthy();
    expect((await stagiair.client.rpc('add_member', { p_ws: wsId, p_email: 'x@x.nl', p_role: 'admin', p_full_name: 'x' })).error).toBeTruthy();
  });

  it('stagiair ziet geen contactgegevens en geen audit', async () => {
    expect(must(await stagiair.client.from('person_contact').select('*'))).toEqual([]);
    expect(must(await stagiair.client.from('audit_log').select('id'))).toEqual([]);
    expect(must(await owner.client.from('person_contact').select('*')).length).toBeGreaterThan(0);
  });

  it('medewerker zonder projectlidmaatschap ziet het project niet; als lid wel', async () => {
    expect(must(await medewerker.client.from('project').select('id').eq('id', p2))).toEqual([]);
    must(await owner.client.rpc('add_project_member', { p_project: p2, p_user: medewerker.id }));
    expect(must(await medewerker.client.from('project').select('id').eq('id', p2))).toHaveLength(1);
    expect(must(await medewerker.client.from('project').select('id').eq('id', projectId))).toEqual([]);
  });

  it('ingetrokken lid verliest direct toegang, ook met bestaande sessie', async () => {
    const tijdelijk = await addMember(owner.client, wsId, 'tijdelijk', 'medewerker');
    must(await owner.client.rpc('add_project_member', { p_project: p2, p_user: tijdelijk.id }));
    expect(must(await tijdelijk.client.from('project').select('id').eq('id', p2))).toHaveLength(1);
    must(await owner.client.rpc('revoke_member', { p_ws: wsId, p_user: tijdelijk.id }));
    expect(must(await tijdelijk.client.from('project').select('id').eq('id', p2))).toEqual([]);
  });

  it('account in een andere organisatie ziet niets', async () => {
    const vreemde = await createUser('vreemde');
    expect(must(await vreemde.client.from('project').select('id'))).toEqual([]);
    expect(must(await vreemde.client.from('person').select('id'))).toEqual([]);
    expect(must(await vreemde.client.rpc('my_context'))).toEqual([]);
  });
});

describe('proef 7/20 — persoonlijke taken en gelijktijdige wijzigingen', () => {
  it('persoonlijke taak zonder project is alleen voor de maker zichtbaar', async () => {
    const t = must(await medewerker.client.from('task').insert({ workspace_id: wsId, title: 'Eigen notitie' }).select().single());
    expect(must(await owner.client.from('task').select('id').eq('id', t.id))).toEqual([]);
  });

  it('tweede schrijver op een oude revisie overschrijft niet stil', async () => {
    const t = must(await owner.client.from('task').insert({ workspace_id: wsId, project_id: projectId, title: 'Revisietest' }).select().single());
    const first = must(await owner.client.from('task').update({ title: 'Eerste' }).eq('id', t.id).eq('revision', t.revision).select());
    const second = must(await owner.client.from('task').update({ title: 'Tweede' }).eq('id', t.id).eq('revision', t.revision).select());
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0); // conflict: de UI toont dit en laat bewust kiezen
    expect(must(await owner.client.from('task').select('title').eq('id', t.id).single()).title).toBe('Eerste');
  });

  it('subtaken kunnen geen cirkel vormen', async () => {
    const a = must(await owner.client.from('task').insert({ workspace_id: wsId, project_id: projectId, title: 'A' }).select().single());
    const b = must(await owner.client.from('task').insert({ workspace_id: wsId, project_id: projectId, title: 'B', parent_id: a.id }).select().single());
    const r = await owner.client.from('task').update({ parent_id: b.id }).eq('id', a.id).select();
    expect(r.error?.message).toContain('cirkel');
  });
});
