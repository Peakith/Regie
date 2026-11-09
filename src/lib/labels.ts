export const bedrijfLabel: Record<string, string> = { studio_brutaal: 'Studio Brutaal', moviemates: "Moviemates Studio's" };
export const lifecycleLabel: Record<string, string> = {
  actief: 'Actief', gepauzeerd: 'Gepauzeerd', operationeel_afgerond: 'Operationeel afgerond', geannuleerd: 'Geannuleerd',
};
export const deliverableStatusLabel: Record<string, string> = {
  gepland: 'Gepland', in_uitvoering: 'In uitvoering', in_review: 'In review', wijzigingen_nodig: 'Wijzigingen nodig',
  goedgekeurd: 'Goedgekeurd', geleverd: 'Geleverd', vervallen: 'Vervallen',
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
  te_doen: 'Te doen', bezig: 'Bezig', geblokkeerd: 'Geblokkeerd', klaar: 'Klaar', vervallen: 'Vervallen',
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
