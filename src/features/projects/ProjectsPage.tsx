import clsx from "clsx";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ProjectTemplate } from "../../bindings/ProjectTemplate";
import { Button, Card, Field, Page, TextInput } from "../../components/ui";
import { fmtDate } from "../../lib/format";
import { TEMPLATE_LABELS, TEMPLATES } from "../../lib/labels";
import { useApp } from "../../store";

export function ProjectsPage() {
  const projects = useApp((s) => s.projects);
  const { createProject, openProject, duplicateProject, deleteProject } = useApp.getState();

  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [template, setTemplate] = useState<ProjectTemplate>("building_owners");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <Page title="Projects" subtitle="Pick a template, enter the costs and the app works out the price per building.">
      <Card title="New project" className="mb-7">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void createProject(name, client, template);
            setName("");
            setClient("");
          }}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Project name">
              <TextInput value={name} placeholder="e.g. MODLE pricing 2026" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Client">
              <TextInput value={client} placeholder="Optional" onChange={(e) => setClient(e.target.value)} />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2.5 text-[13px] font-medium text-ink-2">Template</legend>
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              {TEMPLATES.map((option) => {
                const selected = option.value === template;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setTemplate(option.value)}
                    className={clsx(
                      "flex flex-col gap-2.5 rounded-lg border p-4 text-left transition-colors",
                      selected
                        ? "border-accent/40 bg-accent-soft ring-3 ring-accent/10"
                        : "border-line bg-surface hover:border-ink-2/30",
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className={clsx(
                          "flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] bg-surface",
                          selected ? "border-accent" : "border-line",
                        )}
                      >
                        <span className={clsx("size-2 rounded-full", selected && "bg-accent")} />
                      </span>
                      <span className="text-[15px] font-semibold tracking-tight text-ink">{option.label}</span>
                    </span>
                    <span className="text-[13px] leading-relaxed text-ink-2">{option.hint}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Button type="submit" variant="primary" className="h-11 px-4.5 font-semibold">
            <Plus /> Create project
          </Button>
        </form>
      </Card>

      <div className="mb-4 flex items-baseline gap-2.5 px-0.5">
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">All projects</h2>
        <span className="text-[13px] text-muted">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </span>
      </div>

      {projects.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">No projects yet. Create the first one above.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const owners = p.template === "building_owners";
            return (
              <li
                key={p.id}
                className="glass flex flex-col overflow-hidden rounded-xl border border-line shadow-sm transition-colors hover:border-accent/40"
              >
                <button
                  type="button"
                  onClick={() => void openProject(p.id)}
                  className="flex flex-1 flex-col gap-3.5 p-4.5 text-left"
                >
                  <span className="flex items-start gap-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold tracking-tight text-ink">{p.name}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-ink-2">{p.client || "No client"}</span>
                    </span>
                    <span
                      className={clsx(
                        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
                        owners ? "bg-accent-soft text-accent-ink" : "bg-teal-soft text-teal-ink",
                      )}
                    >
                      {TEMPLATE_LABELS[p.template].replace("Modle - ", "")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                    <span className="font-medium">{p.currency}</span>
                    <span className="size-[3px] rounded-full bg-axis" />
                    <span className="text-muted">Edited {fmtDate(p.updated_at)}</span>
                  </span>
                </button>
                <div className="flex items-center justify-end gap-1 border-t border-line bg-page/60 px-3 py-2">
                  {confirmingId === p.id ? (
                    <>
                      <span className="mr-auto text-xs text-ink-2">Delete permanently?</span>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          setConfirmingId(null);
                          void deleteProject(p.id);
                        }}
                      >
                        <Trash2 /> Delete
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => void duplicateProject(p.id)}>
                        <Copy /> Duplicate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${p.name}`}
                        className="hover:bg-bad/10 hover:text-bad"
                        onClick={() => setConfirmingId(p.id)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
