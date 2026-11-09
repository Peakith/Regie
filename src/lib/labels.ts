export const bedrijfLabel: Record<string, string> = { studio_brutaal: 'Studio Brutaal', moviemates: "Moviemates Studio's" };
export const lifecycleLabel: Record<string, string> = {
  actief: 'Actief', gepauzeerd: 'Gepauzeerd', operationeel_afgerond: 'Operationeel afgerond', geannuleerd: 'Geannuleerd',
};
export const deliverableStatusLabel: Record<string, string> = {
  gepland: 'Gepland', in_uitvoering: 'In productie', in_review: 'In review', wijzigingen_nodig: 'Feedback verwerken',
  goedgekeurd: 'Goedgekeurd', geleverd: 'Opgeleverd', vervallen: 'Geannuleerd',
};
/** Statussen die rechtstreeks gekozen mogen worden; akkoord en levering gaan via eigen acties. */
export const deliverableManualStatuses = ['gepland', 'in_uitvoering', 'in_review', 'wijzigingen_nodig', 'vervallen'];
export const shootStatusLabel: Record<string, string> = {
  gepland: 'Gepland', in_uitvoering: 'In uitvoering', uitgevoerd: 'Uitgevoerd', geannuleerd: 'Geannuleerd',
};
export const assignmentStatusLabel: Record<string, string> = {
  optie: 'Optie', bevestigd: 'Bevestigd', geweigerd: 'Geweigerd', geannuleerd: 'Geannuleerd',
};
export const taskStatusLabel: Record<string, string> = {
  te_doen: 'Open', bezig: 'Bezig', geblokkeerd: 'Wacht', klaar: 'Klaar', vervallen: 'Vervallen',
};
export const adminStatusLabel: Record<string, string> = {
  niet_beoordeeld: 'Niet beoordeeld', open: 'Open', afgerond: 'Afgerond', niet_van_toepassing: 'Niet van toepassing',
};
export const roleLabel: Record<string, string> = {
  eigenaar: 'Eigenaar', admin: 'Admin', projectmanager: 'Projectmanager', medewerker: 'Medewerker',
  stagiair: 'Stagiair', freelancer: 'Freelancer', klant: 'Klant',
};

export function datum(d?: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}-${m}-${y}`;
}
export function datumTijd(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'short', timeStyle: 'short' });
}
export function vandaag(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(new Date());
}
export function isVerlopen(d?: string | null): boolean {
  return !!d && d < vandaag();
}
/** Waarschuwing voor ongebruikelijke spaties in een projectnummer (nummer wordt niet herschreven). */
export function nummerWaarschuwing(n: string): string | null {
  if (!n) return null;
  if (n !== n.trim()) return 'Let op: spatie aan begin of eind. Voor de controle op dubbele nummers telt die niet mee.';
  if (/\s/.test(n)) return 'Let op: het nummer bevat een spatie. "SB 26130" en "SB26130" gelden als hetzelfde nummer.';
  return null;
}

// ───────── Volledige app: extra labels ─────────
export const phaseLabel: Record<string, string> = {
  pre_productie: 'Pre-productie', productie: 'Productie', post_productie: 'Post-productie', afronding: 'Afronding',
  operationeel_klaar: 'Operationeel klaar', administratief_klaar: 'Administratief klaar',
};
export const phaseOrder = Object.keys(phaseLabel);
export const numberStatusLabel: Record<string, string> = {
  gereserveerd: 'Gereserveerd', pitch: 'Pitch', offerte: 'Offerte', losse_klus: 'Losse klus', project: 'Project',
  verloren: 'Verloren', geannuleerd: 'Geannuleerd', vervallen: 'Vervallen',
};
export const milestoneLabel: Record<string, string> = {
  offerte_akkoord: 'Offerte akkoord', debriefing: 'Debriefing gedaan', gefactureerd: 'Gefactureerd',
  betaling_ontvangen: 'Betaling ontvangen', freelancers_betaald: 'Freelancers betaald',
};
export const financeMilestones = ['gefactureerd', 'betaling_ontvangen', 'freelancers_betaald'];
export const riskLabel: Record<string, string> = { op_schema: 'Op schema', risico: 'Risico', te_laat: 'Te laat' };
export const riskTone = (r?: string | null) => (r === 'te_laat' ? 'danger' : r === 'risico' ? 'warn' : 'ok') as 'danger' | 'warn' | 'ok';
export const financeLabel: Record<string, string> = {
  nog_niet_gefactureerd: 'Nog niet gefactureerd', gefactureerd: 'Gefactureerd', betaald: 'Betaald',
};
export const shootStatusLabel2: Record<string, string> = {
  optie: 'Optie', bevestigd: 'Bevestigd', verplaatst: 'Verplaatst', geannuleerd: 'Geannuleerd',
};
export const versionStatusLabel: Record<string, string> = {
  concept: 'Concept', in_review: 'In review', feedback_ontvangen: 'Feedback ontvangen', goedgekeurd: 'Goedgekeurd', vervangen: 'Vervangen',
};
export const decisionKindLabel: Record<string, string> = {
  goedkeuring_versie: 'Goedkeuring versie', scopewijziging: 'Scopewijziging', meerwerk: 'Meerwerk', afspraak: 'Afspraak', overig: 'Overig',
};
export const linkKindLabel: Record<string, string> = {
  dropbox: 'Dropbox', bruto: 'Bruto', asana: 'Asana', review: 'Reviewtool', moneybird: 'Moneybird', licentie: 'Licentie', overig: 'Overig',
};
export const anchorLabel: Record<string, string> = { S: 'projectstart', D: 'eerste draaidag', L: 'laatste draaidag' };

/** Dag van de week + datum, bijv. "ma 07-12". */
export function dagKort(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d.slice(0, 10) + 'T12:00:00Z');
  return `${dt.toLocaleDateString('nl-NL', { weekday: 'short', timeZone: 'UTC' })} ${datum(d).slice(0, 5)}`;
}
export function plusDagen(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
