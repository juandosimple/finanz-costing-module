import { invoke } from "@tauri-apps/api/core";
import type { AiSuggestion } from "../bindings/AiSuggestion";
import type { AppSettings } from "../bindings/AppSettings";
import type { Currency } from "../bindings/Currency";
import type { ExchangeRates } from "../bindings/ExchangeRates";
import type { Project } from "../bindings/Project";
import type { ProjectResult } from "../bindings/ProjectResult";
import type { ProjectSummary } from "../bindings/ProjectSummary";
import type { ProjectTemplate } from "../bindings/ProjectTemplate";

/** Typed wrappers for the commands defined in `src-tauri/src/lib.rs`. */
export const api = {
  listProjects: () => invoke<ProjectSummary[]>("list_projects"),
  createProject: (name: string, client: string, template: ProjectTemplate, currency: Currency) =>
    invoke<Project>("create_project", { name, client, template, currency }),
  getProject: (id: string) => invoke<Project>("get_project", { id }),
  saveProject: (project: Project) => invoke<Project>("save_project", { project }),
  switchTemplate: (project: Project, template: ProjectTemplate) =>
    invoke<Project>("switch_template", { project, template }),
  duplicateProject: (id: string) => invoke<Project>("duplicate_project", { id }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  exportProject: (id: string) => invoke<string>("export_project", { id }),
  importProject: (data: string) => invoke<Project>("import_project", { data }),
  plan: (project: Project) => invoke<ProjectResult>("plan", { project }),
  hasApiKey: () => invoke<boolean>("has_api_key"),
  listLocalModels: () => invoke<string[]>("list_local_models"),
  saveApiKey: (key: string) => invoke<void>("save_api_key", { key }),
  suggestPrices: (project: Project) => invoke<AiSuggestion>("suggest_prices", { project }),
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<void>("save_settings", { settings }),
  getRates: () => invoke<ExchangeRates>("get_rates"),
  saveRates: (rates: ExchangeRates) => invoke<ExchangeRates>("save_rates", { rates }),
  refreshRates: () => invoke<ExchangeRates>("refresh_rates"),
};

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
