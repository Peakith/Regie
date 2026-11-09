export type Project = {
  id: string; workspace_id: string; company: string; year: number; name: string; client_org_id: string | null;
  manager_person_id: string | null; contact_person_id: string | null; briefing: string | null; agreements: string | null; workflow: string;
  production_applicable: boolean; lifecycle: string; lifecycle_reason: string | null; archived: boolean; archived_at: string | null;
  phase: string; phase_mode: string; phase_reason: string | null; phase_changed_at: string; is_concept: boolean;
  concept_payload: { deliverables?: unknown[]; shoot_days?: unknown[] } | null; automation_enabled: boolean; start_date: string;
  template_version_id: string | null; revision: number; created_at: string;
  client_org: { name: string } | null;
  template_version: { version_no: number; template: { name: string } } | null;
  project_number: { id: string; number_display: string; kind: string; reason: string | null; created_at: string; source: string }[];
};
export type Person = { id: string; full_name: string; roles: string[]; user_id: string | null };
export type Status = {
  phase: string; phase_mode: string; phase_suggested: string; phase_reason: string | null; auto_reason: string; waiting: string[];
  blockers: { type: string; text: string; object_type: string; object_id: string }[]; risk: string; risk_reasons: string[];
  finance: { status: string; freelancers_betaald: boolean; freelancers_van_toepassing: boolean } | null;
  operational_done_at: string | null; admin_done_at: string | null;
  deliverables: { totaal: number; opgeleverd: number; in_review: number }; shoot_days: { totaal: number; voorbij: number; bevestigd: number };
};
export type TabProps = {
  project: Project; status: Status; canEdit: boolean; canManage: boolean; canApprove: boolean; people: Person[];
  reloadProject: () => Promise<void>;
};
