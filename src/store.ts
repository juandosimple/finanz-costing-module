import { create } from "zustand";
import type { AppSettings } from "./bindings/AppSettings";
import type { ExchangeRates } from "./bindings/ExchangeRates";
import type { Project } from "./bindings/Project";
import type { ProjectResult } from "./bindings/ProjectResult";
import type { ProjectSummary } from "./bindings/ProjectSummary";
import type { ProjectTemplate } from "./bindings/ProjectTemplate";
import type { Theme } from "./bindings/Theme";
import { api, errorMessage } from "./lib/api";

export type ViewName = "projects" | "project" | "settings";
export type SaveState = "idle" | "saving" | "saved" | "error";
/** 1 project · 2 costs · 3 pricing · 4 scenarios · 5 AI suggestion. */
export type Step = 1 | 2 | 3 | 4 | 5;

interface AppState {
  view: ViewName;
  step: Step;
  projects: ProjectSummary[];
  project: Project | null;
  result: ProjectResult | null;
  planError: string | null;
  saveState: SaveState;
  settings: AppSettings | null;
  rates: ExchangeRates | null;
  ratesBusy: boolean;
  /** True when an Anthropic key is stored in the OS keychain. */
  apiKeySet: boolean;
  /** Models installed in the local Ollama, empty when it isn't running. */
  localModels: string[];
  suggesting: boolean;
  error: string | null;

  init(): Promise<void>;
  showProjects(): Promise<void>;
  showProject(): void;
  showSettings(): Promise<void>;
  setStep(step: Step): void;
  openProject(id: string): Promise<void>;
  createProject(name: string, client: string, template: ProjectTemplate): Promise<void>;
  duplicateProject(id: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** Writes the project to Downloads; returns where it landed. */
  exportProject(id: string): Promise<string | undefined>;
  importProject(file: File): Promise<void>;
  /** Applies the change immediately; saves and recalculates with a debounce. */
  updateProject(update: (project: Project) => Project): void;
  /** Step 1: swaps the template, rebuilding the catalogue in the engine. */
  switchTemplate(template: ProjectTemplate): Promise<void>;
  updateSettings(patch: Partial<AppSettings>): void;
  saveApiKey(key: string): Promise<void>;
  loadLocalModels(): Promise<void>;
  runSuggestion(): Promise<void>;
  updateRates(rates: ExchangeRates): void;
  refreshRates(): Promise<void>;
  dismissError(): void;
}

const SAVE_DELAY_MS = 600;
const PLAN_DELAY_MS = 120;

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let planTimer: ReturnType<typeof setTimeout> | undefined;
let settingsTimer: ReturnType<typeof setTimeout> | undefined;
let ratesTimer: ReturnType<typeof setTimeout> | undefined;
let planSeq = 0;

/** Stamps the chosen theme on <html>; "system" leaves it to the OS setting. */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = theme;
}

export const useApp = create<AppState>((set, get) => {
  async function persist() {
    const project = get().project;
    if (!project) return;
    set({ saveState: "saving" });
    try {
      await api.saveProject(project);
      // The sidebar lists the saved summaries, so a rename shows there too.
      set((state) => ({
        saveState: "saved",
        projects: state.projects.map((p) => (p.id === project.id ? { ...p, name: project.name, client: project.client } : p)),
      }));
    } catch (e) {
      set({ saveState: "error", error: errorMessage(e) });
    }
  }

  async function flushSave() {
    if (saveTimer === undefined) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    await persist();
  }

  function schedulePlan(delay = PLAN_DELAY_MS) {
    clearTimeout(planTimer);
    planTimer = setTimeout(async () => {
      const project = get().project;
      if (!project) return;
      const seq = ++planSeq;
      try {
        const result = await api.plan(project);
        if (seq === planSeq) set({ result, planError: null });
      } catch (e) {
        if (seq === planSeq) set({ planError: errorMessage(e) });
      }
    }, delay);
  }

  async function reloadProjects() {
    try {
      set({ projects: await api.listProjects() });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  }

  return {
    view: "projects",
    step: 1,
    projects: [],
    project: null,
    result: null,
    planError: null,
    saveState: "idle",
    settings: null,
    rates: null,
    ratesBusy: false,
    apiKeySet: false,
    localModels: [],
    suggesting: false,
    error: null,

    async init() {
      try {
        const [projects, rates, settings, apiKeySet] = await Promise.all([
          api.listProjects(),
          api.getRates(),
          api.getSettings(),
          api.hasApiKey(),
        ]);
        applyTheme(settings.theme);
        set({ projects, rates, settings, apiKeySet });
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    async showProjects() {
      await flushSave();
      set({ view: "projects" });
      await reloadProjects();
    },

    showProject() {
      if (get().project) set({ view: "project" });
    },

    async showSettings() {
      await flushSave();
      set({ view: "settings" });
    },

    setStep(step) {
      set({ step });
    },

    async openProject(id) {
      await flushSave();
      try {
        const project = await api.getProject(id);
        set({ project, result: null, planError: null, saveState: "idle", view: "project", step: 2 });
        const currency = get().settings?.currency;
        if (currency && project.currency !== currency) {
          get().updateProject((p) => ({ ...p, currency }));
        } else {
          schedulePlan(0);
        }
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    async createProject(name, client, template) {
      await flushSave();
      try {
        const project = await api.createProject(name, client, template, get().settings?.currency ?? "GBP");
        set({ project, result: null, planError: null, saveState: "saved", view: "project", step: 2 });
        schedulePlan(0);
        await reloadProjects();
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    async duplicateProject(id) {
      await flushSave();
      try {
        await api.duplicateProject(id);
        await reloadProjects();
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    async exportProject(id) {
      await flushSave();
      try {
        return await api.exportProject(id);
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    async importProject(file) {
      try {
        await api.importProject(await file.text());
        await reloadProjects();
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    async deleteProject(id) {
      if (get().project?.id === id) {
        clearTimeout(saveTimer);
        saveTimer = undefined;
      }
      try {
        await api.deleteProject(id);
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          ...(s.project?.id === id ? { project: null, result: null } : {}),
        }));
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    updateProject(update) {
      const current = get().project;
      if (!current) return;
      set({ project: update(current), saveState: "saving" });
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = undefined;
        void persist();
      }, SAVE_DELAY_MS);
      schedulePlan();
    },

    async switchTemplate(template) {
      const project = get().project;
      if (!project || project.template === template) return;
      try {
        const next = await api.switchTemplate(project, template);
        get().updateProject(() => next);
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    updateSettings(patch) {
      const current = get().settings;
      if (!current) return;
      const settings = { ...current, ...patch };
      if (patch.theme !== undefined) applyTheme(settings.theme);
      set({ settings });

      // The currency is app-wide: the open project follows it.
      if (patch.currency !== undefined && patch.currency !== current.currency && get().project) {
        get().updateProject((p) => ({ ...p, currency: settings.currency }));
      }

      clearTimeout(settingsTimer);
      settingsTimer = setTimeout(async () => {
        settingsTimer = undefined;
        try {
          await api.saveSettings(settings);
        } catch (e) {
          set({ error: errorMessage(e) });
        }
      }, 300);
    },

    async saveApiKey(key) {
      try {
        await api.saveApiKey(key);
        set({ apiKeySet: key.trim().length > 0 });
      } catch (e) {
        set({ error: errorMessage(e) });
      }
    },

    async loadLocalModels() {
      try {
        set({ localModels: await api.listLocalModels() });
      } catch {
        // Ollama not running: the UI says so, it isn't an error worth a toast.
        set({ localModels: [] });
      }
    },

    async runSuggestion() {
      const project = get().project;
      if (!project || get().suggesting) return;
      set({ suggesting: true });
      try {
        const suggestion = await api.suggestPrices(project);
        // Saved with the project, so it survives closing the app.
        get().updateProject((p) => ({ ...p, last_suggestion: suggestion }));
      } catch (e) {
        set({ error: errorMessage(e) });
      } finally {
        set({ suggesting: false });
      }
    },

    updateRates(rates) {
      set({ rates });
      clearTimeout(ratesTimer);
      ratesTimer = setTimeout(async () => {
        try {
          await api.saveRates(rates);
        } catch (e) {
          set({ error: errorMessage(e) });
        }
      }, 400);
    },

    async refreshRates() {
      set({ ratesBusy: true });
      try {
        set({ rates: await api.refreshRates() });
      } catch (e) {
        set({ error: errorMessage(e) });
      } finally {
        set({ ratesBusy: false });
      }
    },

    dismissError() {
      set({ error: null });
    },
  };
});

/** Fires the pending saves (when the window closes). */
export function flushPendingSave() {
  const { project, settings } = useApp.getState();
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (project) void api.saveProject(project);
  }
  if (settingsTimer !== undefined) {
    clearTimeout(settingsTimer);
    settingsTimer = undefined;
    if (settings) void api.saveSettings(settings);
  }
}
