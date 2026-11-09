/**
 * Volledige app — integratietests tegen de lokale Supabase-stack (auth, PostgREST, RLS, functies).
 * Nummers verwijzen naar de acceptatiecriteria in de masterprompt (§16) en de automatiseringen (§9).
 * Geen mocks: iedere aanroep gaat als echte gebruiker (of als externe tool met API-sleutel) via de API.
 */
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addMember, adminClient, anonClient, cleanupTestData, createTestOrg, createUser, dag, must, werkdagen } from './helpers';

type U = { id: string; email: string; client: SupabaseClient };
let wsId: string; let orgId: string;
let owner: U; let pm: U; let stagiair: U; let medewerker: U;
const admin = () => adminClient();
const require = createRequire(import.meta.url);
const tick = async () => must(await admin().rpc('tick_workspace', { p_ws: wsId }));

async function nummer(client: SupabaseClient, company = 'studio_brutaal', extra: Record<string, unknown> = {}) {
  return client.rpc('issue_number', { p_ws: wsId, p_company: company, p_year: 2026, p_status: 'offerte', ...extra });
}
async function templateVersie(naam: string): Promise<string> {
  const t = must(await owner.client.from('template').select('id,template_version(id,version_no)').eq('name', naam).single());
  return t.template_version.sort((a: any, b: any) => b.version_no - a.version_no)[0].id;
}
async function fase(id: string): Promise<string> {
  return must(await owner.client.from('project').select('phase').eq('id', id).single()).phase;
}
async function leegProject(naam: string, extra: Record<string, unknown> = {}) {
  const n = must(await nummer(owner.client));
  return must(await owner.client.rpc('create_project_from_number', { p_number: n.id, p_name: naam, p_client_name: 'Testklant', ...extra })) as string;
}

beforeAll(async () => {
  const o = await createTestOrg();
  wsId = o.wsId; orgId = o.orgId; owner = o.owner as U;
  pm = await addMember(owner.client, wsId, 'pm', 'projectmanager') as U;
  stagiair = await addMember(owner.client, wsId, 'stag2', 'stagiair') as U;
  medewerker = await addMember(owner.client, wsId, 'mw2', 'medewerker') as U;
}, 60_000);

afterAll(() => cleanupTestData());

describe('§5 nummerregister', () => {
  it('stelt het volgende nummer voor als hoogste + 1 en toont gaten als vrije nummers', async () => {
    const a = must(await nummer(owner.client, 'moviemates'));
    expect(a.code).toBe('MMS26001');
    const b = must(await nummer(owner.client, 'moviemates', { p_seq: 4 }));
    expect(b).toMatchObject({ code: 'MMS26004', gap: true });
    const ov = must(await owner.client.rpc('register_year_overview', { p_ws: wsId, p_company: 'moviemates', p_year: 2026 }))[0];
    expect(ov).toMatchObject({ next_seq: 5, next_code: 'MMS26005', free_seqs: [2, 3] });
  });

  it('acceptatie 3: twee gelijktijdige aanvragen krijgen verschillende nummers', async () => {
    const r = await Promise.all([nummer(owner.client), nummer(pm.client), nummer(owner.client), nummer(medewerker.client)]);
    const codes = r.map((x) => must(x).code);
    expect(new Set(codes).size).toBe(4);
  });

  it('acceptatie 4: een bestaand nummer wordt geweigerd met vermelding van het project', async () => {
    const n = must(await nummer(owner.client, 'studio_brutaal', { p_seq: 130 }));
    must(await owner.client.rpc('create_project_from_number', { p_number: n.id, p_name: 'Bestaand project' }));
    const r = await nummer(owner.client, 'studio_brutaal', { p_code: 'sb 26130' });
    expect(r.error?.message).toContain('SB26130 bestaat al');
    expect(r.error?.message).toContain('Bestaand project');
  });

  it('acceptatie 5: een verloren pitch blijft in het register en wordt nooit opnieuw voorgesteld', async () => {
    const n = must(await nummer(owner.client, 'studio_brutaal', { p_status: 'pitch', p_name: 'Verloren pitch' }));
    expect((await medewerker.client.rpc('set_number_status', { p_number: n.id, p_status: 'verloren' })).error).toBeTruthy();
    must(await pm.client.rpc('set_number_status', { p_number: n.id, p_status: 'verloren' }));
    const ov = must(await owner.client.rpc('register_year_overview', { p_ws: wsId, p_company: 'studio_brutaal', p_year: 2026 }))[0];
    expect(ov.next_seq).toBeGreaterThan(Number(n.code.slice(4)));
    expect(ov.free_seqs).not.toContain(Number(n.code.slice(4)));
    const vind = must(await stagiair.client.rpc('search_all', { p_ws: wsId, p_q: 'Verloren pitch' }));
    expect(vind[0]).toMatchObject({ kind: 'nummer', year: 2026 });
    expect((await owner.client.rpc('set_number_status', { p_number: n.id, p_status: 'vervallen' })).error?.message).toContain('reden');
  });

  it('acceptatie 6: een project houdt het nummer en het jaar van uitgifte', async () => {
    const n = must(await nummer(owner.client));
    const id = must(await owner.client.rpc('create_project_from_number', { p_number: n.id, p_name: 'Jaarwisseling', p_anchor_s: '2027-02-01' }));
    const p = must(await owner.client.from('project_overview').select('number,year').eq('id', id).single());
    expect(p).toEqual({ number: n.code, year: 2026 });
  });

  it('import uit Asana: eerst voorbeeld met afwijkingen, daarna ongewijzigd importeren', async () => {
    const rows = [
      { code: 'SB25012', name: 'Oude film', client: 'Klant A', status: 'project' },
      { code: 'SB2513', name: 'Afwijkend', client: '' },
      { code: 'SB25012', name: 'Dubbel', client: 'Klant B' },
      { code: 'X-77', name: 'Onbekend', client: 'C', year: 2024, company: 'MMS' },
    ];
    const preview = must(await owner.client.rpc('import_numbers', { p_ws: wsId, p_rows: rows, p_commit: false }));
    expect(preview[1].issues).toEqual(expect.arrayContaining(['afwijkend aantal cijfers', 'klant ontbreekt']));
    expect(preview[2]).toMatchObject({ action: 'overslaan' });
    expect(preview[3].issues).toContain('onbekend formaat');
    expect(must(await owner.client.from('project_number').select('id').eq('number_display', 'SB25012'))).toEqual([]);
    expect((await stagiair.client.rpc('import_numbers', { p_ws: wsId, p_rows: rows, p_commit: false })).error).toBeTruthy();

    must(await owner.client.rpc('import_numbers', { p_ws: wsId, p_rows: rows, p_commit: true }));
    const imp = must(await owner.client.from('project_number').select('number_display,nonstandard,source,year').in('number_display', ['SB25012', 'SB2513', 'X-77']).order('number_display'));
    expect(imp).toEqual([
      { number_display: 'SB25012', nonstandard: false, source: 'import-asana', year: 2025 },
      { number_display: 'SB2513', nonstandard: true, source: 'import-asana', year: 2025 },
      { number_display: 'X-77', nonstandard: true, source: 'import-asana', year: 2024 },
    ]);
  });
});

describe('§8 templates en AU1', () => {
  let projectId: string;
  const D = '2026-12-07'; // maandag
  const S = '2026-11-23';

  it('T1 maakt de juiste taken, deliverables en draaidagen met werkdag-deadlines', async () => {
    const n = must(await nummer(owner.client));
    const preview = must(await owner.client.rpc('template_preview', { p_version: await templateVersie('Merkfilm/bedrijfsfilm'), p_anchor_d: D, p_anchor_s: S }));
    expect(preview.filter((x: any) => x.kind === 'taak')).toHaveLength(19);
    projectId = must(await owner.client.rpc('create_project_from_number', {
      p_number: n.id, p_name: 'Merkfilm test', p_template_version: await templateVersie('Merkfilm/bedrijfsfilm'),
      p_anchor_d: D, p_anchor_s: S, p_op: crypto.randomUUID(),
    }));
    const tasks = must(await owner.client.from('task').select('title,deadline,anchor,anchor_offset').eq('project_id', projectId));
    const by = Object.fromEntries(tasks.map((t: any) => [t.title, t.deadline]));
    expect(by['Brainstorm/concept']).toBe(werkdagen(S, 3));
    expect(by['Productiedocumenten']).toBe(werkdagen(D, -10));
    expect(by['Callsheet']).toBe('2026-12-03');           // D−2 werkdagen
    expect(by['Apparatuur ophalen']).toBe('2026-12-04');  // D−1
    expect(by['Edit v1']).toBe('2026-12-14');             // L+5
    expect(by['Feedback verwerken']).toBeNull();          // geen termijn in de template: niets verzonnen
    const deliv = must(await owner.client.from('deliverable').select('title,aspect_ratio,feedback_rounds_agreed').eq('project_id', projectId));
    expect(deliv).toEqual([{ title: 'Hoofdfilm', aspect_ratio: '16:9', feedback_rounds_agreed: 2 }]);
    expect(must(await owner.client.from('shoot_day').select('date,status').eq('project_id', projectId))).toEqual([{ date: D, status: 'optie' }]);
  });

  it('AU1 is idempotent: dubbel uitvoeren maakt niets dubbel', async () => {
    const v = await templateVersie('Merkfilm/bedrijfsfilm');
    must(await admin().rpc('apply_template', { p_project: projectId, p_version: v, p_anchor_d: D, p_anchor_s: S }));
    expect(must(await owner.client.from('task').select('id').eq('project_id', projectId))).toHaveLength(19);
    const runs = must(await owner.client.from('automation_run').select('status').eq('project_id', projectId).eq('kind', 'AU1'));
    expect(runs.map((r: any) => r.status).sort()).toEqual(['duplicaat', 'ok']);
  });

  it('acceptatie 13: een verschoven draaidag verschuift alleen open, niet-handmatige ankertaken (werkdagen) met ongedaan maken', async () => {
    const t = must(await owner.client.from('task').select('id,title,deadline').eq('project_id', projectId));
    const id = (title: string) => t.find((x: any) => x.title === title).id;
    must(await owner.client.from('task').update({ deadline: '2026-11-30' }).eq('id', id('Callsheet')).select());
    must(await owner.client.from('task').update({ status: 'klaar' }).eq('id', id('Gear prep')).select());
    const sd = must(await owner.client.from('shoot_day').select('id').eq('project_id', projectId).single());
    must(await owner.client.from('shoot_day').update({ date: '2026-12-10' }).eq('id', sd.id).select()); // +3 dagen (do)

    const after = Object.fromEntries(must(await owner.client.from('task').select('title,deadline,deadline_manual').eq('project_id', projectId)).map((x: any) => [x.title, x]));
    expect(after['Apparatuur ophalen'].deadline).toBe('2026-12-09');  // D−1 werkdag
    expect(after['Edit v1'].deadline).toBe('2026-12-17');            // L+5 werkdagen
    expect(after['Callsheet']).toMatchObject({ deadline: '2026-11-30', deadline_manual: true });
    expect(after['Gear prep'].deadline).toBe('2026-12-04');          // afgerond: ongewijzigd
    expect(after['Brainstorm/concept'].deadline).toBe(werkdagen(S, 3)); // S-anker: ongewijzigd

    const run = must(await owner.client.from('automation_run').select('id,summary').eq('project_id', projectId).eq('kind', 'AU2').single());
    expect(run.summary).toMatch(/taakdeadline/);
    expect((await stagiair.client.rpc('undo_automation', { p_run: run.id })).error).toBeTruthy();
    must(await owner.client.rpc('undo_automation', { p_run: run.id }));
    expect(must(await owner.client.from('task').select('deadline').eq('id', id('Apparatuur ophalen')).single()).deadline).toBe('2026-12-04');
  });

  it('acceptatie 19: een gewijzigde template laat bestaande projecten ongewijzigd', async () => {
    const oud = await templateVersie('Merkfilm/bedrijfsfilm');
    const t = must(await owner.client.from('template').select('id,name,company,description').eq('name', 'Merkfilm/bedrijfsfilm').single());
    const content = must(await owner.client.from('template_version').select('content').eq('id', oud).single()).content;
    content.tasks.push({ title: 'Nieuwe stap', phase: 'afronding' });
    expect((await medewerker.client.rpc('save_template', { p_ws: wsId, p_template: t.id, p_name: t.name, p_company: t.company, p_description: '', p_content: content })).error).toBeTruthy();
    const nieuw = must(await owner.client.rpc('save_template', { p_ws: wsId, p_template: t.id, p_name: t.name, p_company: t.company, p_description: t.description, p_content: content }));
    expect(nieuw).not.toBe(oud);
    expect(must(await owner.client.from('project').select('template_version_id').eq('id', projectId).single()).template_version_id).toBe(oud);
    expect(must(await owner.client.from('task').select('id').eq('project_id', projectId).eq('title', 'Nieuwe stap'))).toEqual([]);
  });

  it('T3 maakt per variant een eigen deliverable en edit-taak', async () => {
    const id = await leegProject('Social test', { p_template_version: await templateVersie('Socialcontentpakket'), p_anchor_d: D, p_anchor_s: S });
    const d = must(await owner.client.from('deliverable').select('title,group_label').eq('project_id', id));
    expect(d).toHaveLength(5);
    expect(new Set(d.map((x: any) => x.group_label))).toEqual(new Set(['Socialpakket']));
    const edits = must(await owner.client.from('task').select('title,task_deliverable(deliverable_id)').eq('project_id', id).like('title', 'Edit –%'));
    expect(edits).toHaveLength(5);
    expect(edits.every((e: any) => e.task_deliverable.length === 1)).toBe(true);
  });
});

describe('§6 faselogica', () => {
  let id: string; let sd: string; let deliv: string;

  it('een verstreken datum rondt niets af; bevestigde draaidag start productie', async () => {
    id = await leegProject('Fasetest');
    expect(await fase(id)).toBe('pre_productie');
    sd = must(await owner.client.from('shoot_day').insert({ project_id: id, date: dag(-1), status: 'optie' }).select().single()).id;
    expect(await fase(id)).toBe('pre_productie'); // optie telt niet
    must(await owner.client.from('shoot_day').update({ status: 'bevestigd', start_time: '09:00', end_time: '18:00' }).eq('id', sd).select());
    expect(await fase(id)).toBe('productie');
  });

  it('acceptatie 8: zonder HDD-back-up blijft het project in productie met een blokkade op het dashboard', async () => {
    must(await owner.client.from('shoot_day').update({ backup_ssd_at: new Date().toISOString() }).eq('id', sd).select());
    expect(await fase(id)).toBe('productie');
    const dash = must(await owner.client.rpc('dashboard', { p_ws: wsId }));
    expect(dash.blockers.some((b: any) => b.project_id === id && b.text.includes('HDD'))).toBe(true);
    const row = must(await owner.client.from('shoot_day').update({ backup_hdd_at: new Date().toISOString() }).eq('id', sd).select().single());
    expect(row.backup_hdd_by).toBe(owner.id);
    expect(await fase(id)).toBe('post_productie'); // geen deliverables → blijft post
  });

  it('post → afronding pas als alles is opgeleverd; nieuwe deliverable zet terug', async () => {
    deliv = must(await owner.client.from('deliverable').insert({ project_id: id, title: 'Film' }).select().single()).id;
    const v = must(await owner.client.rpc('add_version', { p_deliverable: deliv, p_file_ref: 'https://review.example/v1' }));
    must(await owner.client.rpc('register_approval', { p_version: v, p_approved_by_name: 'Klant', p_approved_at: new Date().toISOString(), p_evidence: 'Mail' }));
    expect(await fase(id)).toBe('post_productie');
    must(await owner.client.rpc('mark_delivered', { p_deliverable: deliv }));
    expect(await fase(id)).toBe('afronding');
    const extra = must(await owner.client.from('deliverable').insert({ project_id: id, title: 'Extra' }).select().single()).id;
    expect(await fase(id)).toBe('post_productie');
    must(await owner.client.rpc('soft_delete', { p_kind: 'deliverable', p_id: extra }));
    expect(await fase(id)).toBe('afronding');
    const audit = must(await owner.client.from('audit_log').select('reason').eq('project_id', id).eq('table_name', 'project').like('reason', 'Automatisch%'));
    expect(audit.length).toBeGreaterThanOrEqual(3);
  });

  it('afronding → operationeel klaar vereist apparatuur terug en debriefing', async () => {
    const eq = must(await owner.client.from('equipment_item').insert({ project_id: id, shoot_day_id: sd, description: 'FX6' }).select().single());
    must(await owner.client.rpc('set_milestone', { p_project: id, p_kind: 'debriefing', p_checked: true }));
    expect(await fase(id)).toBe('afronding');
    must(await owner.client.from('equipment_item').update({ returned: true }).eq('id', eq.id).select());
    expect(await fase(id)).toBe('operationeel_klaar');
  });

  it('acceptatie 9: operationeel klaar maar niet gefactureerd → "Blijft hangen" (alleen met financiële rechten)', async () => {
    const dash = must(await pm.client.rpc('dashboard', { p_ws: wsId }));
    expect(dash.stale.some((s: any) => s.project_id === id)).toBe(true);
    const stag = must(await stagiair.client.rpc('dashboard', { p_ws: wsId }));
    expect(stag.stale).toBeNull();
    // na 14 dagen: drempel overschreden
    await admin().from('project').update({ operational_done_at: new Date(Date.now() - 15 * 86_400_000).toISOString() }).eq('id', id);
    const later = must(await pm.client.rpc('dashboard', { p_ws: wsId }));
    expect(later.stale.find((s: any) => s.project_id === id).over_threshold).toBe(true);
  });

  it('acceptatie 15: de stagiair ziet geen financiële gegevens, ook niet via de API', async () => {
    expect((await stagiair.client.rpc('set_milestone', { p_project: id, p_kind: 'gefactureerd', p_checked: true })).error).toBeTruthy();
    expect((await medewerker.client.rpc('set_milestone', { p_project: id, p_kind: 'gefactureerd', p_checked: true })).error).toBeTruthy();
    expect(must(await stagiair.client.from('milestone').select('kind').eq('project_id', id).in('kind', ['gefactureerd', 'betaling_ontvangen', 'freelancers_betaald']))).toEqual([]);
    expect(must(await stagiair.client.rpc('project_status', { p_project: id })).finance).toBeNull();
    expect(must(await pm.client.rpc('project_status', { p_project: id })).finance.status).toBe('nog_niet_gefactureerd');
    expect(JSON.stringify(must(await stagiair.client.rpc('search_all', { p_ws: wsId, p_q: 'Fasetest' })))).not.toMatch(/factu|betaal/i);
  });

  it('administratief klaar na financiële mijlpalen; gaat nooit automatisch terug; archiveren pas dan', async () => {
    expect((await owner.client.rpc('set_project_archived', { p_project: id, p_archived: true })).error?.message).toContain('Administratief klaar');
    for (const k of ['gefactureerd', 'betaling_ontvangen', 'freelancers_betaald']) {
      must(await pm.client.rpc('set_milestone', { p_project: id, p_kind: k, p_checked: true }));
    }
    expect(await fase(id)).toBe('administratief_klaar');
    must(await owner.client.from('deliverable').insert({ project_id: id, title: 'Late extra' }).select());
    expect(await fase(id)).toBe('administratief_klaar');
  });

  it('acceptatie 10: handmatige fase met reden in audit; automatiek blijft eraf tot hervatten', async () => {
    expect((await medewerker.client.rpc('set_phase_manual', { p_project: id, p_phase: 'post_productie', p_reason: 'x' })).error).toBeTruthy();
    expect((await owner.client.rpc('set_phase_manual', { p_project: id, p_phase: 'post_productie', p_reason: '' })).error?.message).toContain('reden');
    must(await owner.client.rpc('set_phase_manual', { p_project: id, p_phase: 'post_productie', p_reason: 'Klant wil extra versie' }));
    const audit = must(await owner.client.from('audit_log').select('actor,reason,at').eq('project_id', id).eq('reason', 'Handmatig: Klant wil extra versie'));
    expect(audit[0].actor).toBe(owner.id);
    // wijziging die de automatiek anders zou laten bewegen
    const late = must(await owner.client.from('deliverable').select('id').eq('project_id', id).eq('title', 'Late extra').single());
    must(await owner.client.rpc('soft_delete', { p_kind: 'deliverable', p_id: late.id }));
    expect(await fase(id)).toBe('post_productie');
    const voorstel = must(await owner.client.rpc('resume_auto_phase', { p_project: id, p_confirm: false }))[0];
    expect(voorstel.suggested).toBe('administratief_klaar');
    expect(await fase(id)).toBe('post_productie');
    must(await owner.client.rpc('resume_auto_phase', { p_project: id, p_confirm: true }));
    expect(await fase(id)).toBe('administratief_klaar');
  });

  it('acceptatie 7: gearchiveerd project is vindbaar en alleen-lezen', async () => {
    must(await owner.client.rpc('set_project_archived', { p_project: id, p_archived: true }));
    const hit = must(await owner.client.rpc('search_all', { p_ws: wsId, p_q: 'Fasetest' }));
    expect(hit.some((h: any) => h.project_id === id && h.archived)).toBe(true);
    expect(must(await owner.client.from('project').update({ name: 'X' }).eq('id', id).select())).toEqual([]);
    expect((await owner.client.from('task').insert({ workspace_id: wsId, project_id: id, title: 'x' }).select()).error).toBeTruthy();
  });

  it('geen opnames: pre → post zodra een deliverable in productie is', async () => {
    const p = await leegProject('Zonder opnames', { p_no_shoot: true });
    const d = must(await owner.client.from('deliverable').insert({ project_id: p, title: 'Animatie' }).select().single());
    expect(await fase(p)).toBe('pre_productie');
    must(await owner.client.from('deliverable').update({ status: 'in_uitvoering' }).eq('id', d.id).select());
    expect(await fase(p)).toBe('post_productie');
  });
});

describe('AU3/AU4 versies en goedkeuring', () => {
  it('acceptatie 11: goedkeuring van v2 keurt v3 niet goed; het besluit over v2 blijft', async () => {
    const p = await leegProject('Versietest');
    const d = must(await owner.client.from('deliverable').insert({ project_id: p, title: 'Spot', feedback_rounds_agreed: 2 }).select().single()).id;
    const v1 = must(await owner.client.rpc('add_version', { p_deliverable: d, p_file_ref: 'https://x.nl/1' }));
    const v2 = must(await owner.client.rpc('add_version', { p_deliverable: d, p_file_ref: 'https://x.nl/2' }));
    expect((await stagiair.client.rpc('register_approval', { p_version: v2, p_approved_by_name: 'K', p_approved_at: new Date().toISOString(), p_evidence: 'm' })).error).toBeTruthy();
    must(await medewerker.client.rpc('register_approval', { p_version: v2, p_approved_by_name: 'Klant X', p_approved_at: new Date().toISOString(), p_evidence: 'Mail 12-11' }));
    let vs = must(await owner.client.from('deliverable_version').select('id,status').eq('deliverable_id', d));
    expect(vs.find((x: any) => x.id === v1).status).toBe('vervangen');
    expect(vs.find((x: any) => x.id === v2).status).toBe('goedgekeurd');

    const v3 = must(await owner.client.rpc('add_version', { p_deliverable: d, p_file_ref: 'https://x.nl/3' }));
    vs = must(await owner.client.from('deliverable_version').select('id,status').eq('deliverable_id', d));
    expect(vs.find((x: any) => x.id === v3).status).toBe('in_review');
    expect(must(await owner.client.from('deliverable').select('status').eq('id', d).single()).status).toBe('in_review');
    const dec = must(await owner.client.from('decision').select('version_id,taken_by_name,kind').eq('deliverable_id', d));
    expect(dec).toEqual([{ version_id: v2, taken_by_name: 'Klant X', kind: 'goedkeuring_versie' }]);
    expect((await owner.client.from('decision').update({ taken_by_name: 'Ander' }).eq('deliverable_id', d).select()).error).toBeTruthy();

    // acceptatie 12: derde ronde bij 2 afgesproken → signaal mogelijk meerwerk
    const meld = must(await owner.client.from('notification').select('kind,title').eq('kind', 'meerwerk'));
    expect(meld.some((m: any) => m.title.includes('feedbackronde 3'))).toBe(true);
  });
});

describe('AU6 dubbele boeking', () => {
  it('acceptatie 14: waarschuwing als iemand op dezelfde datum al is ingeboekt', async () => {
    const a = await leegProject('Boeking A'); const b = await leegProject('Boeking B');
    const fl = must(await owner.client.from('person').insert({ organization_id: orgId, full_name: 'Freelancer Dubbel', roles: ['camera'] }).select().single());
    const sa = must(await owner.client.from('shoot_day').insert({ project_id: a, date: '2027-03-06', status: 'bevestigd' }).select().single());
    const sb = must(await owner.client.from('shoot_day').insert({ project_id: b, date: '2027-03-06', status: 'bevestigd' }).select().single());
    must(await owner.client.from('assignment').insert({ project_id: a, person_id: fl.id, shoot_day_id: sa.id, status: 'bevestigd' }).select());
    const c = must(await owner.client.rpc('booking_conflicts', { p_person: fl.id, p_date: '2027-03-06', p_exclude_shoot_day: sb.id }));
    expect(c).toHaveLength(1);
    expect(c[0].project_label).toContain('Boeking A');
  });
});

describe('fase 8 freelancer-toegang', () => {
  let fl: U; let eigen: string; let ander: string; let sd: string;

  it('uitnodiging: eenmalige link, alleen voor het juiste e-mailadres', async () => {
    eigen = await leegProject('Freelance eigen'); ander = await leegProject('Freelance ander');
    fl = await createUser('freelancer') as U;
    const pers = must(await owner.client.from('person').insert({ organization_id: orgId, full_name: 'Fien Freelance', roles: ['geluid'] }).select().single());
    expect((await pm.client.rpc('create_invitation', { p_ws: wsId, p_email: fl.email, p_role: 'freelancer', p_person_id: pers.id })).error).toBeTruthy();
    const token = must(await owner.client.rpc('create_invitation', { p_ws: wsId, p_email: fl.email, p_role: 'freelancer', p_person_id: pers.id }));
    const vreemd = await createUser('vreemd2');
    expect((await vreemd.client.rpc('accept_invitation', { p_token: token })).error?.message).toContain('ander e-mailadres');
    must(await fl.client.rpc('accept_invitation', { p_token: token }));
    expect((await fl.client.rpc('accept_invitation', { p_token: token })).error?.message).toContain('al gebruikt');

    sd = must(await owner.client.from('shoot_day').insert({ project_id: eigen, date: dag(2), status: 'bevestigd', location: 'Studio', callsheet_note: 'Om 8:00 aanwezig' }).select().single()).id;
    must(await owner.client.from('assignment').insert({ project_id: eigen, person_id: pers.id, shoot_day_id: sd, role_label: 'geluid', status: 'bevestigd' }).select());
    must(await owner.client.from('comment').insert({ project_id: eigen, subject_type: 'shoot_day', subject_id: sd, body: 'Parkeren achter', visibility: 'crew' }).select());
    must(await owner.client.from('comment').insert({ project_id: eigen, subject_type: 'shoot_day', subject_id: sd, body: 'INTERN: budget krap', visibility: 'intern' }).select());
  });

  it('ziet de eigen callsheet zonder interne opmerkingen', async () => {
    const days = must(await fl.client.rpc('crew_shoot_days', {}));
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ location: 'Studio', callsheet_note: 'Om 8:00 aanwezig', my_role: 'geluid' });
    expect(JSON.stringify(days)).not.toContain('INTERN');
    expect(JSON.stringify(days)).not.toContain('Freelance ander');
  });

  it('acceptatie 16: geen toegang en geen titel van een ander project, ook niet via directe ID', async () => {
    expect(must(await fl.client.from('project').select('id,name').eq('id', ander))).toEqual([]);
    expect(must(await fl.client.from('project').select('id,name').eq('id', eigen))).toEqual([]); // ook eigen: alleen via servermatige weergave
    expect(must(await fl.client.from('comment').select('body'))).toEqual([]);
    expect(must(await fl.client.from('milestone').select('kind'))).toEqual([]);
    expect(must(await fl.client.from('person').select('id'))).toEqual([]);
    expect((await fl.client.rpc('project_status', { p_project: ander })).error).toBeTruthy();
    expect((await fl.client.rpc('dashboard', { p_ws: wsId })).error).toBeTruthy();
    expect((await fl.client.rpc('search_all', { p_ws: wsId, p_q: 'Freelance' })).error).toBeTruthy();
  });

  it('acceptatie 17: ingetrokken freelancer is bij de volgende aanvraag buitengesloten', async () => {
    must(await owner.client.rpc('revoke_member', { p_ws: wsId, p_user: fl.id }));
    expect(must(await fl.client.rpc('crew_shoot_days', {}))).toEqual([]);
    expect(must(await fl.client.rpc('my_context'))).toEqual([]);
  });
});

describe('§10 API en koppelingen (Bruto)', () => {
  let key: string;
  const payload = (n: string) => ({ number: n, project_name: 'Bruto campagne', client: { name: 'Bruto Klant BV', kvk: '12345678', bruto_id: 'c-9' },
    deliverables: [{ title: 'Hoofdfilm', aspect_ratio: '16:9' }], shoot_days: [{ date: '2027-01-12' }] });

  it('alleen de eigenaar maakt een sleutel; zonder geldige sleutel geen toegang', async () => {
    expect((await pm.client.rpc('create_api_key', { p_ws: wsId, p_source: 'bruto', p_label: 'Bruto Mac' })).error).toBeTruthy();
    key = must(await owner.client.rpc('create_api_key', { p_ws: wsId, p_source: 'bruto', p_label: 'Bruto Mac' }));
    const r = await anonClient({ 'x-regie-key': 'rg_fout' }).rpc('api_events', { p_event_id: 'e0', p_type: 'offerte_akkoord', p_payload: {} });
    expect(r.error?.message).toContain('API-sleutel');
    const anon = await anonClient().from('project').select('id');
    expect(anon.data ?? []).toEqual([]);
  });

  it('een koppeling die uit staat negeert berichten', async () => {
    const r = must(await anonClient({ 'x-regie-key': key }).rpc('api_events', { p_event_id: 'e-uit', p_type: 'offerte_akkoord', p_payload: payload('SB26900') }));
    expect(r.status).toBe('genegeerd');
  });

  it('acceptatie 18: hetzelfde "offerte akkoord" twee keer → één project, tweede als duplicaat gelogd', async () => {
    must(await owner.client.rpc('set_integration_enabled', { p_ws: wsId, p_source: 'bruto', p_enabled: true }));
    const api = anonClient({ 'x-regie-key': key });
    const res = must(await api.rpc('api_reserve_number', { p_company: 'SB', p_year: 2026, p_name: 'Bruto campagne' }));
    const [a, b] = [must(await api.rpc('api_events', { p_event_id: 'evt-1', p_type: 'offerte_akkoord', p_payload: payload(res.code) })),
                    must(await api.rpc('api_events', { p_event_id: 'evt-1', p_type: 'offerte_akkoord', p_payload: payload(res.code) }))];
    expect(a.status).toBe('verwerkt');
    expect(b.status).toBe('duplicaat');
    const projects = must(await owner.client.from('project_number').select('project_id,status').eq('number_display', res.code));
    expect(projects).toHaveLength(1);
    expect(projects[0].status).toBe('project');
    const log = must(await owner.client.from('integration_event').select('status').eq('external_event_id', 'evt-1'));
    expect(log.map((l: any) => l.status).sort()).toEqual(['duplicaat', 'verwerkt']);
    const p = must(await owner.client.from('project').select('is_concept,client_org(name)').eq('id', projects[0].project_id).single());
    expect(p).toMatchObject({ is_concept: true, client_org: { name: 'Bruto Klant BV' } });
    must(await owner.client.rpc('confirm_concept_project', { p_project: projects[0].project_id, p_take_deliverables: true, p_take_shoot_days: true }));
    expect(must(await owner.client.from('deliverable').select('title').eq('project_id', projects[0].project_id))).toEqual([{ title: 'Hoofdfilm' }]);
  });
});

describe('lijsten, prullenbak, meldingen en export', () => {
  it('acceptatie 22: losse lijst zonder template, fases of project', async () => {
    const l = must(await stagiair.client.from('task_list').insert({ workspace_id: wsId, name: 'Boodschappen kantoor' }).select().single());
    must(await stagiair.client.from('task').insert({ workspace_id: wsId, list_id: l.id, title: 'Koffie' }).select());
    expect(must(await stagiair.client.from('task').select('title').eq('list_id', l.id))).toEqual([{ title: 'Koffie' }]);
    expect(must(await owner.client.from('task_list').select('id').eq('id', l.id))).toEqual([]); // niet gedeeld
  });

  it('verwijderen is soft delete met herstel; alleen PM+ mag projectonderdelen verwijderen', async () => {
    const p = await leegProject('Prullenbak');
    const t = must(await owner.client.from('task').insert({ workspace_id: wsId, project_id: p, title: 'Weg ermee' }).select().single());
    expect((await medewerker.client.rpc('soft_delete', { p_kind: 'task', p_id: t.id })).error).toBeTruthy();
    must(await pm.client.rpc('soft_delete', { p_kind: 'task', p_id: t.id }));
    expect(must(await owner.client.from('task').select('id').eq('id', t.id))).toEqual([]);
    const trash = must(await pm.client.rpc('trash_items', { p_ws: wsId }));
    expect(trash.some((x: any) => x.id === t.id)).toBe(true);
    must(await pm.client.rpc('restore_item', { p_kind: 'task', p_id: t.id }));
    expect(must(await owner.client.from('task').select('id').eq('id', t.id))).toHaveLength(1);
  });

  it('AU5/AU9: meldingen worden gebundeld en niet dubbel aangemaakt', async () => {
    const p = await leegProject('Meldingen');
    const me = must(await owner.client.from('person').select('id').eq('user_id', owner.id).single());
    await admin().from('project').update({ manager_person_id: me.id }).eq('id', p);
    must(await owner.client.from('task').insert([
      { workspace_id: wsId, project_id: p, title: 'Vandaag af', deadline: dag(0), assignee_person_id: me.id },
      { workspace_id: wsId, project_id: p, title: 'Ook vandaag', deadline: dag(0), assignee_person_id: me.id },
    ]).select());
    must(await owner.client.from('shoot_day').insert({ project_id: p, date: dag(-2), status: 'bevestigd' }).select());
    await admin().from('org_setting').update({ quiet_start: '00:00', quiet_end: '00:00' }).eq('organization_id', orgId);
    await tick(); await tick();
    const n = must(await owner.client.from('notification').select('kind,body,dedupe_key'));
    const deadlines = n.filter((x: any) => x.kind === 'deadline');
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].body).toContain('Vandaag af');
    expect(deadlines[0].body).toContain('Ook vandaag');
    expect(n.filter((x: any) => x.kind === 'backup').length).toBeGreaterThanOrEqual(1);
    expect(must(await stagiair.client.from('notification').select('id').in('dedupe_key', n.map((x: any) => x.dedupe_key)))).toEqual([]);
  });

  it('export alleen voor eigenaar, admin en PM', async () => {
    const data = must(await pm.client.rpc('export_data', { p_ws: wsId }));
    expect(data.nummerregister.length).toBeGreaterThan(5);
    expect(Object.keys(data)).toEqual(expect.arrayContaining(['projecten', 'deliverable', 'shoot_day', 'task', 'decision']));
    expect((await medewerker.client.rpc('export_data', { p_ws: wsId })).error).toBeTruthy();
  });

  it('offline-momentopname bevat draaidagen van de komende 7 dagen', async () => {
    const snap = must(await owner.client.rpc('offline_snapshot'));
    expect(snap.shoot_days.every((s: any) => s.date >= dag(0) && s.date <= dag(7))).toBe(true);
  });
});

describe('§3 tweestapsverificatie wordt servermatig afgedwongen', () => {
  function totp(secret: string): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
    const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const h = require('node:crypto').createHmac('sha1', key).update(counter).digest();
    const o = h[h.length - 1] & 0xf;
    return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
  }

  it('met een tweede factor geeft een sessie zonder code (aal1) geen gegevens', async () => {
    const u = await addMember(owner.client, wsId, 'mfa', 'projectmanager') as U;
    expect(must(await u.client.rpc('my_context'))).toHaveLength(1);
    const { data: enroll, error } = await u.client.auth.mfa.enroll({ factorType: 'totp' });
    if (error) throw error;
    must(await u.client.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: totp(enroll.totp.secret) }));
    await leegProject('MFA-test');
    expect(must(await u.client.rpc('my_context'))).toHaveLength(1); // aal2: toegang
    expect(must(await u.client.from('project').select('id').limit(1))).toHaveLength(1);

    const fresh = anonClient();
    must(await fresh.auth.signInWithPassword({ email: u.email, password: 'test-wachtwoord-123!' }));
    expect(must(await fresh.rpc('my_context'))).toEqual([]);
    expect(must(await fresh.from('project').select('id'))).toEqual([]);
    expect((await fresh.rpc('dashboard', { p_ws: wsId })).error).toBeTruthy();
  });
});
