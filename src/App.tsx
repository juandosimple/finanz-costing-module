import clsx from "clsx";
import { ChartColumn, FolderOpen, Settings, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { ProjectWizard } from "./features/project/ProjectWizard";
import { ProjectsPage } from "./features/projects/ProjectsPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { Isotipo } from "./components/Isotipo";
import { flushPendingSave, useApp } from "./store";

export default function App() {
  const view = useApp((s) => s.view);
  const project = useApp((s) => s.project);
  const projects = useApp((s) => s.projects);
  const error = useApp((s) => s.error);
  const { init, showProjects, showSettings, openProject, dismissError } = useApp.getState();

  useEffect(() => {
    void init();
    window.addEventListener("beforeunload", flushPendingSave);
    return () => window.removeEventListener("beforeunload", flushPendingSave);
  }, [init]);

  return (
    <div className="flex h-full">
      <aside className="glass sticky top-0 flex h-full w-61 shrink-0 flex-col gap-6 border-r border-line px-3.5 py-5">
        <div className="flex items-center gap-2.5 px-2.5 py-1.5">
          <Isotipo className="size-6.5 shrink-0 rounded-[0.42rem]" />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight text-ink">Finanz analyzer</div>
            <div className="text-xs text-ink-2">Costs &amp; pricing</div>
          </div>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5">
          <NavItem icon={<FolderOpen />} active={view === "projects"} onClick={() => void showProjects()}>
            Projects
          </NavItem>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {projects.map((p) => (
              <NavItem
                key={p.id}
                icon={<ChartColumn />}
                active={view === "project" && project?.id === p.id}
                onClick={() => void openProject(p.id)}
              >
                <span className="truncate">{project?.id === p.id ? project.name : p.name}</span>
              </NavItem>
            ))}
          </div>
          <NavItem icon={<Settings />} active={view === "settings"} onClick={() => void showSettings()}>
            Settings
          </NavItem>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {view === "projects" && <ProjectsPage />}
        {view === "project" && project && <ProjectWizard key={project.id} />}
        {view === "settings" && <SettingsPage />}
      </main>

      {error && (
        <div
          role="alert"
          className="fixed right-4 bottom-4 flex max-w-md items-start gap-3 rounded-lg border border-bad/40 bg-surface p-3 text-sm text-ink shadow-lg"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" aria-label="Close" onClick={dismissError} className="text-muted hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function NavItem({
  icon,
  active,
  onClick,
  children,
}: {
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex min-w-0 items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
        "[&_svg]:size-[15px] [&_svg]:shrink-0",
        active
          ? "border-line bg-surface/80 font-semibold text-ink [&_svg]:text-accent"
          : "border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink [&_svg]:text-muted",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
