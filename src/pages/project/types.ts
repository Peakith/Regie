export type Project = {
  id: string; workspace_id: string; company: string; year: number; name: string; client_org_id: string | null;
  manager_person_id: string | null; briefing: string | null; agreements: string | null; workflow: string;
  production_applicable: boolean; lifecycle: string; lifecycle_reason: string | null; archived: boolean;
  closed_at: string | null; admin_status: string; adm_factuur_verstuurd: boolean; adm_betaling_ontvangen: boolean;
  adm_freelancers_betaald: boolean; adm_overig_afgerond: boolean; adm_checked_at: string | null; revision: number;
  client_org: { name: string } | null;
  project_number: { number_display: string; kind: string; reason: string | null; created_at: string }[];
};
export type Person = { id: string; full_name: string; roles: string[] };
export type TabProps = {
  project: Project; canEdit: boolean; canManage: boolean; people: Person[]; reloadProject: () => Promise<void>;
};
