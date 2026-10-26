import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  FileText,
  LoaderCircle,
  Plus,
  Sparkles,
  RotateCcw,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Band } from "../../bindings/Band";
import type { BandResult } from "../../bindings/BandResult";
import type { OnboardingItem } from "../../bindings/OnboardingItem";
import type { SharedCost } from "../../bindings/SharedCost";
import type { OnboardingLine } from "../../bindings/OnboardingLine";
import type { PriceRule } from "../../bindings/PriceRule";
import type { Project } from "../../bindings/Project";
import type { ProjectTemplate } from "../../bindings/ProjectTemplate";
import type { ProjectResult } from "../../bindings/ProjectResult";
import { Button, Callout, Card, Field, NumberField, Select, StatTile, TextArea, TextInput } from "../../components/ui";
import { fmtDate, fmtMoney, fmtNum, fmtPct, perMonth } from "../../lib/format";
import { BASES, BASIS_LABELS, RECURRENCES, RECURRENCE_LABELS, TEMPLATE_LABELS, TEMPLATES } from "../../lib/labels";
import { useApp, type SaveState, type Step } from "../../store";
import { BandChart } from "./BandChart";
import { StepPlans } from "./PlansStep";
import { ProjectReport } from "./ProjectReport";
import { defaultSelection, offered, OnboardingPicker, Profit, toggleSelection, type Money } from "./shared";

const STEPS: { value: Step; label: string }[] = [
  { value: 1, label: "Project" },
  { value: 2, label: "Costs" },
  { value: 3, label: "Pricing" },
  { value: 4, label: "Scenarios" },
  { value: 5, label: "AI suggestion" },
];

export function ProjectWizard() {
  const project = useApp((s) => s.project);
  const result = useApp((s) => s.result);
  const planError = useApp((s) => s.planError);
  const step = useApp((s) => s.step);
  const saveState = useApp((s) => s.saveState);
  const setStep = useApp((s) => s.setStep);
  const updateProject = useApp((s) => s.updateProject);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!project) return null;
  const money: Money = (v) => fmtMoney(v ?? null, project.currency);

  return (
    <div className="mx-auto max-w-6xl px-8 py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <input
            aria-label="Project name"
            value={project.name}
            onChange={(e) => updateProject((p) => ({ ...p, name: e.target.value }))}
            className="-mx-1 w-full rounded-md bg-transparent px-1 text-2xl font-semibold text-ink hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
          />
          <div className="px-1 text-sm text-ink-2">
            {TEMPLATE_LABELS[project.template]} · results in {project.currency}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <SaveIndicator state={saveState} />
          {confirmingDelete ? (
            <>
              <span className="text-xs text-ink-2">Delete this project permanently?</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  const { deleteProject, showProjects } = useApp.getState();
                  void deleteProject(project.id).then(() => showProjects());
                }}
              >
                <Trash2 /> Delete
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => setReportOpen(true)}>
                <FileText />
                Report
              </Button>
              <Button
                size="sm"
                aria-label="Delete project"
                className="hover:bg-bad/10 hover:text-bad"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </header>

      {reportOpen && <ProjectReport project={project} result={result} onClose={() => setReportOpen(false)} />}

      <nav className="flex flex-wrap gap-1 border-b border-line" aria-label="Steps">
        {STEPS.map((s) => ({
          ...s,
          label: s.value === 4 && project.template === "contractors" ? "Plans" : s.label,
        })).map((s) => (
          <button
            key={s.value}
            type="button"
            aria-current={s.value === step ? "step" : undefined}
            onClick={() => setStep(s.value)}
            className={clsx(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              s.value === step ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            <span
              className={clsx(
                "flex size-5 items-center justify-center rounded-full text-xs",
                s.value === step ? "bg-accent text-white" : "bg-surface-2 text-ink-2",
              )}
            >
              {s.value}
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      {planError && (
        <div className="pt-4">
          <Callout tone="bad" icon={<CircleAlert />}>
            {planError}
          </Callout>
        </div>
      )}

      <div className="pt-6">
        {step === 1 && <StepProject project={project} />}
        {step === 2 && <StepCosts project={project} />}
        {step === 3 && <StepPricing project={project} result={result} money={money} />}
        {step === 4 &&
          (project.template === "contractors" ? (
            <StepPlans project={project} result={result} money={money} />
          ) : (
            <StepScenarios project={project} result={result} money={money} />
          ))}
        {step === 5 && <StepSuggestion project={project} result={result} money={money} />}
      </div>

      <footer className="mt-6 flex items-center justify-between border-t border-line pt-4">
        <Button onClick={() => setStep(Math.max(1, step - 1) as Step)} disabled={step === 1}>
          <ArrowLeft /> Back
        </Button>
        <Button variant="primary" onClick={() => setStep(Math.min(5, step + 1) as Step)} disabled={step === 5}>
          Next <ArrowRight />
        </Button>
      </footer>
    </div>
  );
}

function StepProject({ project }: { project: Project }) {
  const updateProject = useApp((s) => s.updateProject);
  const switchTemplate = useApp((s) => s.switchTemplate);
  return (
    <div className="space-y-4">
      <Card title="Project" description="The template decides which costs you fill in on the next step.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Client">
            <TextInput
              value={project.client}
              placeholder="Optional"
              onChange={(e) => updateProject((p) => ({ ...p, client: e.target.value }))}
            />
          </Field>
          <Field label="Template">
            <Select
              value={project.template}
              label="Template"
              options={TEMPLATES.map((t) => ({ value: t.value, label: t.label }))}
              onChange={(template) => void switchTemplate(template)}
            />
          </Field>
        </div>
      </Card>
      <Card title="Notes">
        <TextArea
          value={project.notes}
          placeholder="Assumptions, sources, what you agreed with the client…"
          onChange={(e) => updateProject((p) => ({ ...p, notes: e.target.value }))}
        />
      </Card>
    </div>
  );
}

/** Step 2 — every cost exists and carries a value. What to charge is step 3;
 *  which scenario needs it is step 4. */
function StepCosts({ project }: { project: Project }) {
  const updateProject = useApp((s) => s.updateProject);
  const structure = project.structure;
  const setStructure = (patch: Partial<Project["structure"]>) =>
    updateProject((p) => ({ ...p, structure: { ...p.structure, ...patch } }));

  const setItem = (id: string, patch: Partial<OnboardingItem>) =>
    updateProject((p) => ({
      ...p,
      onboarding: p.onboarding.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));

  // A deleted element stays in the catalogue so it can be restored, but leaves every
  // selection: restoring it doesn't tick it back anywhere.
  const removeItems = (ids: string[]) =>
    updateProject((p) => ({
      ...p,
      onboarding: p.onboarding.map((i) => (ids.includes(i.id) ? { ...i, removed: true } : i)),
      bands: p.bands.map((b) => ({
        ...b,
        onboarding: b.onboarding.filter((x) => !ids.includes(x)),
      })),
      plans: p.plans.map((pl) => ({
        ...pl,
        onboarding: pl.onboarding.filter((x) => !ids.includes(x)),
      })),
    }));
  const restoreItems = (ids: string[]) =>
    updateProject((p) => ({
      ...p,
      onboarding: p.onboarding.map((i) => (ids.includes(i.id) ? { ...i, removed: false } : i)),
    }));

  const categories: string[] = [];
  for (const item of project.onboarding) if (!categories.includes(item.category)) categories.push(item.category);

  const usage = project.usage;
  const setUsage = (patch: Partial<Project["usage"]>) =>
    updateProject((p) => ({ ...p, usage: { ...p.usage, ...patch } }));

  const setAllShared = (removed: boolean) => setStructure({ shared: structure.shared.map((c) => ({ ...c, removed })) });
  const setShared = (id: string, patch: Partial<SharedCost>) =>
    setStructure({
      shared: structure.shared.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CostTemplates
          template={project.template}
          shared={structure.shared}
          onImport={(shared) => setStructure({ shared })}
        />
      </div>

      {project.template === "contractors" && (
        <Card
          title="Usage costs"
          description="What one account costs: its share of the platform, and the storage its plan carries. Storage fills over the year, so it costs more every month. How much each plan holds is set in step 4."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Platform per account / month" hint="The same on every plan">
              <NumberField
                value={usage.per_account_monthly}
                min={0}
                dot="cost"
                suffix={project.currency}
                onChange={(v) => setUsage({ per_account_monthly: v })}
              />
            </Field>
            <Field label="Platform per project / work record / month" hint="Server and database">
              <NumberField
                value={usage.per_project_monthly}
                min={0}
                dot="cost"
                suffix={project.currency}
                onChange={(v) => setUsage({ per_project_monthly: v })}
              />
            </Field>
            <Field label="Platform fixed cost / month" hint="Of the business — no account carries a share">
              <NumberField
                value={usage.platform_fixed_monthly}
                min={0}
                dot="cost"
                suffix={project.currency}
                onChange={(v) => setUsage({ platform_fixed_monthly: v })}
              />
            </Field>
            <Field label="Storage / GB / month" hint="Blob storage plus its backup copy">
              <NumberField
                value={usage.storage_per_gb_month}
                min={0}
                dot="cost"
                suffix={project.currency}
                onChange={(v) => setUsage({ storage_per_gb_month: v })}
              />
            </Field>
            <Field label="Downloads / GB" hint="Outbound transfer">
              <NumberField
                value={usage.download_per_gb}
                min={0}
                dot="cost"
                suffix={project.currency}
                onChange={(v) => setUsage({ download_per_gb: v })}
              />
            </Field>
            <Field label="Downloaded vs uploaded" hint="100% = each month downloads what it uploads">
              <NumberField
                value={usage.download_share}
                min={0}
                scale={100}
                suffix="%"
                onChange={(v) => setUsage({ download_share: v })}
              />
            </Field>
          </div>
        </Card>
      )}

      <Card
        title="Platform and services"
        actions={
          structure.shared.length > 0 &&
          (structure.shared.every((c) => c.removed) ? (
            <Button variant="primary" onClick={() => setAllShared(false)}>
              <RotateCcw /> Restore all
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setAllShared(true)}>
              <Trash2 /> Delete all
            </Button>
          ))
        }
        description={`What running the platform costs you, per month. Charged at cost, with no margin, for the share this client pays — so one client can cover most of a service and another none of it. ${
          project.template === "contractors"
            ? "Each plan splits it between its users."
            : "Shared by the buildings of each scenario."
        }`}
      >
        <div className="space-y-3">
          {structure.shared.map((cost) => (
            <SharedCostRow
              key={cost.id}
              cost={cost}
              currency={project.currency}
              onChange={(patch) => setShared(cost.id, patch)}
              onRemove={() => setShared(cost.id, { removed: true })}
              onRestore={() => setShared(cost.id, { removed: false })}
            />
          ))}
          <Button
            size="sm"
            onClick={() =>
              setStructure({
                shared: [
                  ...structure.shared,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    monthly: 0,
                    share: 1,
                    removed: false,
                  },
                ],
              })
            }
          >
            <Plus /> Add service
          </Button>
        </div>
      </Card>

      {project.onboarding.length > 0 && (
        <>
          <p className="text-sm text-ink-2">
            Onboarding costs. Every element has a cost here — each scenario in step 4 picks the ones it needs.
          </p>
          {categories.map((category) => {
            const items = project.onboarding.filter((i) => i.category === category);
            const ids = items.map((i) => i.id);
            return (
              <Card
                key={category}
                title={category}
                actions={
                  items.every((i) => i.removed) ? (
                    <Button variant="primary" onClick={() => restoreItems(ids)}>
                      <RotateCcw /> Restore all
                    </Button>
                  ) : (
                    <Button variant="danger" onClick={() => removeItems(ids)}>
                      <Trash2 /> Delete all
                    </Button>
                  )
                }
              >
                <div className="space-y-3">
                  {items.map((item) => (
                    <CostRow
                      key={item.id}
                      item={item}
                      currency={project.currency}
                      onChange={(patch) => setItem(item.id, patch)}
                      onRemove={() => removeItems([item.id])}
                      onRestore={() => restoreItems([item.id])}
                    />
                  ))}
                </div>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

/** Saves this project's platform costs under a name, or replaces them with a saved list. */
function CostTemplates({
  template,
  shared,
  onImport,
}: {
  template: ProjectTemplate;
  shared: SharedCost[];
  onImport: (shared: SharedCost[]) => void;
}) {
  // Selecting the list itself: a fresh `[]` on every read would re-render forever.
  const all = useApp((s) => s.settings?.cost_templates) ?? [];
  // Only the lists saved from this kind of project.
  const templates = all.filter((t) => t.template === template);
  const updateSettings = useApp((s) => s.updateSettings);
  const [name, setName] = useState<string | null>(null);

  const save = () => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    // Saving under a name already taken replaces that template.
    updateSettings({
      cost_templates: [
        ...all.filter((t) => t.name !== trimmed || t.template !== template),
        { name: trimmed, template, shared },
      ],
    });
    setName(null);
  };

  if (name !== null) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextInput
          autoFocus
          aria-label="Template name"
          placeholder="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-48"
        />
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Save
        </Button>
        <Button variant="ghost" onClick={() => setName(null)}>
          Cancel
        </Button>
      </form>
    );
  }

  // Saving comes first, so it stays put whether or not there is anything to import.
  return (
    <>
      <Button onClick={() => setName("")}>
        <Save /> Save costs template
      </Button>
      {templates.length > 0 && (
        <Select
          value=""
          label="Import a costs template"
          className="w-52"
          options={[
            { value: "", label: "Import template…" },
            ...templates.map((t) => ({ value: t.name, label: t.name })),
          ]}
          onChange={(picked) => {
            const template = templates.find((t) => t.name === picked);
            if (template) onImport(template.shared);
          }}
        />
      )}
    </>
  );
}

/** The share and what it comes to are two views of one number: typing either sets the other. */
function SharedCostRow({
  cost,
  currency,
  onChange,
  onRemove,
  onRestore,
}: {
  cost: SharedCost;
  currency: string;
  onChange: (patch: Partial<SharedCost>) => void;
  onRemove: () => void;
  onRestore: () => void;
}) {
  return (
    <div
      className={clsx(
        "grid grid-cols-2 items-end gap-3 rounded-lg border border-line p-3 md:grid-cols-[4fr_2fr_2fr_2fr_7rem]",
        cost.removed && "bg-surface-2",
      )}
    >
      {/* Same as a deleted onboarding element: faded, locked, restorable. */}
      <div className={clsx("contents", cost.removed && "[&>*]:opacity-20")} inert={cost.removed}>
        <Field label="Service" className="col-span-2 md:col-span-1">
          <TextInput value={cost.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Cost / month">
          <NumberField
            value={cost.monthly}
            min={0}
            dot="cost"
            suffix={currency}
            onChange={(v) => onChange({ monthly: v })}
          />
        </Field>
        <Field label="Client pays">
          <NumberField
            value={cost.share}
            min={0}
            scale={100}
            suffix="%"
            onChange={(v) => onChange({ share: Math.min(v, 1) })}
          />
        </Field>
        <Field label="Client pays / month">
          <NumberField
            value={cost.monthly * cost.share}
            min={0}
            suffix={currency}
            onChange={(v) => cost.monthly > 0 && onChange({ share: Math.min(v / cost.monthly, 1) })}
          />
        </Field>
      </div>
      <div className="col-span-2 text-right md:col-span-1">
        {cost.removed ? (
          <Button variant="primary" onClick={onRestore}>
            <RotateCcw /> Restore
          </Button>
        ) : (
          <Button variant="danger" aria-label={`Delete ${cost.name}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  );
}

function CostRow({
  item,
  currency,
  onChange,
  onRemove,
  onRestore,
}: {
  item: OnboardingItem;
  currency: string;
  onChange: (patch: Partial<OnboardingItem>) => void;
  onRemove: () => void;
  onRestore: () => void;
}) {
  return (
    <div
      className={clsx(
        "grid grid-cols-2 items-end gap-3 rounded-lg border border-line p-3 md:grid-cols-[4fr_2fr_2fr_2fr_2fr_7rem]",
        item.removed && "bg-surface-2",
      )}
    >
      {/* `contents` keeps the fields in the row's grid; `inert` locks them while deleted. */}
      <div className={clsx("contents", item.removed && "[&>*]:opacity-20")} inert={item.removed}>
        <Field label="Element" className="col-span-2 md:col-span-1">
          <TextInput value={item.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Basis">
          <Select
            value={item.basis}
            label="Basis"
            options={BASES.map((b) => ({ value: b, label: BASIS_LABELS[b] }))}
            onChange={(basis) => onChange({ basis })}
          />
        </Field>
        <Field label="Billing">
          <Select
            value={item.recurrence}
            label="Billing"
            options={RECURRENCES.map((r) => ({
              value: r,
              label: RECURRENCE_LABELS[r],
            }))}
            onChange={(recurrence) => onChange({ recurrence })}
          />
        </Field>
        <Field label="Qty">
          {item.basis === "per_building" ? (
            <div className="flex h-9 items-center justify-center rounded-md border border-line bg-surface-2 px-2 text-xs text-ink-2">
              per building
            </div>
          ) : (
            <NumberField value={item.quantity} min={0} onChange={(v) => onChange({ quantity: v })} />
          )}
        </Field>
        <Field label="Internal cost">
          <NumberField
            value={item.internal_unit_cost}
            min={0}
            dot="cost"
            suffix={currency}
            onChange={(v) => onChange({ internal_unit_cost: v })}
          />
        </Field>
      </div>
      <div className="col-span-2 text-right md:col-span-1">
        {item.removed ? (
          <Button variant="primary" onClick={onRestore}>
            <RotateCcw /> Restore
          </Button>
        ) : (
          <Button variant="danger" aria-label={`Delete ${item.name}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Step 3 — what to charge: the subscription margin, and a rule per cost. */
function StepPricing({
  project,
  result,
  money,
}: {
  project: Project;
  result: ProjectResult | null;
  money: Money;
}) {
  const updateProject = useApp((s) => s.updateProject);
  const lineById = new Map(result?.onboarding_lines.map((l) => [l.id, l]));
  const setPrice = (id: string, price: PriceRule) =>
    updateProject((p) => ({
      ...p,
      onboarding: p.onboarding.map((i) => (i.id === id ? { ...i, price } : i)),
    }));

  const extras = offered(project.onboarding);
  // Same cards, in the same order, as step 2.
  const categories: string[] = [];
  for (const item of extras) if (!categories.includes(item.category)) categories.push(item.category);
  // On bands the markup only goes on the catalogue's recurring services.
  const markupApplies = project.template === "contractors" || extras.some((item) => item.recurrence === "annual");

  return (
    <div className="space-y-4">
      <Card
        title="Platform and services"
        description={
          project.template === "contractors"
            ? "The monthly price per account covers its plan's share of the server and the database and its storage and downloads with this markup on top, plus its share of the shared services at cost. You can still set the price of any plan in step 4."
            : "The monthly price per building covers the platform and its services at cost, and the recurring services (step 2) with this markup on top. It never goes below what the subscription costs. You can still set the price of any band in step 4."
        }
      >
        {markupApplies ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Subscription markup" hint="On top of cost: 40% on 100 bills 140">
              <NumberField
                value={project.subscription_markup}
                min={0}
                scale={100}
                dot="income"
                suffix="%"
                onChange={(v) =>
                  updateProject((p) => ({
                    ...p,
                    subscription_markup: v,
                  }))
                }
              />
            </Field>
          </div>
        ) : (
          <p className="text-sm text-muted">
            No extra costs added: the subscription is charged at what the platform costs.
          </p>
        )}
      </Card>

      {extras.length === 0 ? (
        <Card title="Onboarding">
          <p className="text-sm text-muted">No extra costs added.</p>
        </Card>
      ) : (
        <>
          <p className="text-sm text-ink-2">
            What to charge for each onboarding cost, billed apart from the subscription. Put a markup on the cost or
            type a fixed price — the Spine unit costs 2,000 and sells at 5,000.
          </p>
          {categories.map((category) => (
            <Card key={category} title={category}>
              <div className="space-y-2">
                {extras
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <PriceRow
                      key={item.id}
                      item={item}
                      line={lineById.get(item.id)}
                      currency={project.currency}
                      money={money}
                      onChange={(price) => setPrice(item.id, price)}
                    />
                  ))}
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

function PriceRow({
  item,
  line,
  currency,
  money,
  onChange,
}: {
  item: OnboardingItem;
  line: OnboardingLine | undefined;
  currency: string;
  money: Money;
  onChange: (price: PriceRule) => void;
}) {
  // Narrowing happens on `rule.type` itself: a boolean flag wouldn't discriminate the union.
  const rule = item.price;
  const isAmount = rule.type === "amount";
  const belowCost = line !== undefined && line.unit_price < line.unit_cost;

  return (
    <div className="grid grid-cols-12 items-end gap-3 rounded-lg border border-line p-3">
      <div className="col-span-12 md:col-span-4">
        <div className="truncate text-sm font-medium text-ink">{item.name}</div>
        <div className="text-xs text-muted">
          {RECURRENCE_LABELS[item.recurrence]} · cost {money(item.internal_unit_cost)} per{" "}
          {item.basis === "per_building" ? "building" : "unit"}
        </div>
      </div>
      <Field label="Charge as" className="col-span-6 md:col-span-3">
        <Select
          value={isAmount ? "amount" : "markup"}
          label="Charge as"
          options={[
            { value: "markup", label: "Markup on cost" },
            { value: "amount", label: "Fixed price" },
          ]}
          onChange={(next) =>
            onChange(
              next === "amount"
                ? { type: "amount", value: line?.unit_price ?? item.internal_unit_cost }
                : { type: "markup", percent: 0.6 },
            )
          }
        />
      </Field>
      <Field label={isAmount ? "Price per unit" : "Markup"} className="col-span-6 md:col-span-2">
        {rule.type === "amount" ? (
          <NumberField
            value={rule.value}
            min={0}
            dot="income"
            suffix={currency}
            onChange={(v) => onChange({ type: "amount", value: v })}
          />
        ) : (
          <NumberField
            value={rule.percent}
            min={0}
            scale={100}
            dot="income"
            suffix="%"
            onChange={(v) => onChange({ type: "markup", percent: v })}
          />
        )}
      </Field>
      <div className="col-span-12 text-xs text-ink-2 md:col-span-3 md:text-right">
        Sells at <strong className={belowCost ? "text-bad" : "text-ink"}>{money(line?.unit_price)}</strong>
        <span className="text-muted"> · margin {fmtPct(line?.margin)}</span>
      </div>
    </div>
  );
}

/** Step 4 — each scenario picks the onboarding it needs and how it is charged. */
function StepScenarios({
  project,
  result,
  money,
}: {
  project: Project;
  result: ProjectResult | null;
  money: Money;
}) {
  const updateProject = useApp((s) => s.updateProject);
  const resultById = new Map(result?.bands.map((b) => [b.band_id, b]));

  const setBand = (id: string, patch: Partial<Band>) =>
    updateProject((p) => ({ ...p, bands: p.bands.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));

  const toggleOnboarding = (bandId: string, itemId: string, on: boolean) =>
    updateProject((p) => ({
      ...p,
      bands: p.bands.map((band) =>
        band.id === bandId
          ? { ...band, onboarding: toggleSelection(p.onboarding, band.onboarding, itemId, on) }
          : band,
      ),
    }));

  const addBand = () =>
    updateProject((p) => ({
      ...p,
      bands: [
        ...p.bands,
        {
          id: crypto.randomUUID(),
          buildings: 10,
          price: null,
          // A new band starts from the previous one, so you don't re-tick everything.
          onboarding: [
            ...(p.bands[p.bands.length - 1]?.onboarding ?? defaultSelection(p.onboarding)),
          ],
        },
      ],
    }));

  return (
    <div className="space-y-4">
      {result && result.warnings.length > 0 && (
        <Callout tone="warn" icon={<TriangleAlert />}>
          <ul className="space-y-1">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          Every scenario uses the costs from step 2 and the prices from step 3. Here you choose how many buildings it
          prices, which onboarding it needs, and what the subscription costs.
        </p>
        <Button size="sm" onClick={addBand}>
          <Plus /> Add band
        </Button>
      </div>

      {project.bands.map((band, index) => (
        <BandCard
          key={band.id}
          band={band}
          index={index}
          computed={resultById.get(band.id)}
          project={project}
          money={money}
          onChange={(patch) => setBand(band.id, patch)}
          onToggle={(itemId, on) => toggleOnboarding(band.id, itemId, on)}
          onRemove={() => updateProject((p) => ({ ...p, bands: p.bands.filter((b) => b.id !== band.id) }))}
        />
      ))}

      {result && (
        <>
          <Card title="Subscription: cost and price per building / month">
            <BandChart bands={result.bands} currency={result.currency} />
          </Card>
          <Card
            title="Scenario table"
            description="You type the price per building per month; this table shows what each scenario bills and costs in a whole year, all of its buildings added up."
          >
            <ScenarioTable bands={result.bands} money={money} />
          </Card>
        </>
      )}
    </div>
  );
}

function BandCard({
  band,
  index,
  computed,
  project,
  money,
  onChange,
  onToggle,
  onRemove,
}: {
  band: Band;
  index: number;
  computed: BandResult | undefined;
  project: Project;
  money: Money;
  onChange: (patch: Partial<Band>) => void;
  onToggle: (itemId: string, on: boolean) => void;
  onRemove: () => void;
}) {
  const rule = band.price;
  const mode = rule === null ? "project" : rule.type;
  const suggested = computed?.suggested_subscription_price ?? 0;
  const losing = (computed?.subscription.margin ?? 0) < 0;

  return (
    <Card className="p-4">
      <div className="grid grid-cols-12 items-end gap-3">
        <div className="col-span-2 md:col-span-1">
          <div className="text-xs font-medium text-ink-2">Band</div>
          <div className="flex h-9 items-center text-lg font-semibold tabular-nums text-ink">{index + 1}</div>
        </div>
        <Field label="Buildings" className="col-span-4 md:col-span-2">
          <NumberField value={band.buildings} min={0} integer onChange={(v) => onChange({ buildings: v })} />
        </Field>
        <Field label="Charge as" className="col-span-6 md:col-span-2">
          <Select
            value={mode}
            label="Charge as"
            options={[
              { value: "project", label: "Project markup" },
              { value: "markup", label: "Own markup" },
              { value: "amount", label: "Fixed price" },
            ]}
            onChange={(next) =>
              onChange({
                price:
                  next === "project"
                    ? null
                    : next === "amount"
                      ? { type: "amount", value: computed?.subscription.price_per_building ?? suggested }
                      : { type: "markup", percent: project.subscription_markup },
              })
            }
          />
        </Field>
        <Field
          label={mode === "markup" ? "Markup on cost" : "Price / building / month"}
          className="col-span-6 md:col-span-2"
        >
          {rule !== null && rule.type === "markup" ? (
            <NumberField
              value={rule.percent}
              min={0}
              scale={100}
              dot="income"
              suffix="%"
              onChange={(v) => onChange({ price: { type: "markup", percent: v } })}
            />
          ) : rule !== null && rule.type === "amount" ? (
            <NumberField
              value={rule.value}
              min={0}
              scale={1 / 12}
              dot="income"
              suffix={project.currency}
              onChange={(v) => onChange({ price: { type: "amount", value: v } })}
            />
          ) : (
            <div className="flex h-9 items-center justify-end rounded-md border border-line bg-surface-2 px-2.5 text-sm tabular-nums text-ink-2">
              {money(perMonth(suggested))}
            </div>
          )}
        </Field>
        <div className="col-span-6 md:col-span-4">
          <div className="text-xs text-ink-2">Total for {fmtNum(band.buildings)} buildings</div>
          <div className="text-sm font-semibold tabular-nums text-income">
            {money(computed?.subscription.price)} <span className="text-xs font-normal text-muted">/ year</span>
          </div>
          <div className="text-xs text-muted">
            Costs{" "}
            <span className="text-bad">{money(perMonth(computed?.subscription.cost_per_building))}</span> per building
            / month ·{" "}
            <strong className={losing ? "text-bad" : "text-income"}>
              margin {fmtPct(computed?.subscription.margin)}
            </strong>
          </div>
        </div>
        <div className="col-span-12 md:col-span-1 md:text-right">
          <Button size="sm" variant="danger" aria-label={`Delete band ${index + 1}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <p className="mt-1 text-xs text-muted">
        {mode === "project" ? (
          `Follows the project markup (${fmtPct(project.subscription_markup)})`
        ) : (
          <button type="button" className="text-accent hover:underline" onClick={() => onChange({ price: null })}>
            Use the project markup ({money(suggested)})
          </button>
        )}
        {" · "}
        {computed && computed.onboarding_ids.length === 0
          ? "No onboarding in this scenario"
          : `Onboarding ${money(computed?.onboarding.price_per_building)} per building, billed once`}
      </p>

      {project.onboarding.length > 0 && (
        <OnboardingPicker
          title="Onboarding this scenario needs"
          catalogue={offered(project.onboarding)}
          selection={band.onboarding}
          priced={computed?.onboarding_ids}
          blocked={computed?.blocked}
          summary={
            computed && computed.onboarding_ids.length > 0
              ? `${money(computed.onboarding.price_per_building)} per building`
              : undefined
          }
          onToggle={onToggle}
        />
      )}
    </Card>
  );
}

/** A year that repeats: the subscription without the onboarding billed once. */
function recurring(band: BandResult) {
  return band.years.find((year) => year.year === 2) ?? band.years[0];
}

function ScenarioTable({ bands, money }: { bands: BandResult[]; money: Money }) {
  const head = "px-4 py-2.5 text-xs font-semibold whitespace-nowrap text-ink-2";
  const cell = "px-4 py-3.5 text-[13px] whitespace-nowrap";
  const group = "border-l border-line";

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-[860px] flex-col gap-4 tabular-nums">
        {bands.map((band) => (
          <div key={band.band_id} className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-3.5 px-4 py-3">
              <span className="text-[15px] font-bold tracking-tight text-ink">Band {band.position}</span>
              <span className="text-[13px] text-ink-2">{fmtNum(band.buildings)} buildings</span>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={clsx(head, "text-center tracking-wider uppercase")} colSpan={3}>
                    Onboarding · billed once
                  </th>
                  <th className={clsx(head, "text-center tracking-wider uppercase", group)} colSpan={5}>
                    Subscription · every year
                  </th>
                  <th className={clsx(head, group)} />
                </tr>
                <tr className="border-y border-line bg-surface-2/60">
                  <th className={clsx(head, "text-right")}>Cost</th>
                  <th className={clsx(head, "text-right")}>Price</th>
                  <th className={clsx(head, "text-right")}>Margin</th>
                  <th className={clsx(head, "text-right", group)}>Cost</th>
                  <th className={clsx(head, "text-right")}>Cost / month</th>
                  <th className={clsx(head, "text-right")}>Price</th>
                  <th className={clsx(head, "text-right")}>Price / month</th>
                  <th className={clsx(head, "text-right")}>Margin</th>
                  <th className={clsx(head, "text-right", group)}>Profit per year</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-right">
                  <td className={clsx(cell, "text-bad")}>{money(band.onboarding.cost)}</td>
                  <td className={clsx(cell, "text-income")}>{money(band.onboarding.price)}</td>
                  <td className={clsx(cell, "text-ink-2")}>{fmtPct(band.onboarding.margin)}</td>
                  <td className={clsx(cell, "text-bad", group)}>{money(band.subscription.cost)}</td>
                  <td className={clsx(cell, "text-bad")}>{money(perMonth(band.subscription.cost))}</td>
                  <td className={clsx(cell, "text-income")}>{money(band.subscription.price)}</td>
                  <td className={clsx(cell, "text-income")}>{money(perMonth(band.subscription.price))}</td>
                  <td className={clsx(cell, "text-ink-2")}>{fmtPct(band.subscription.margin)}</td>
                  <td className={clsx(cell, group)}>
                    <Profit value={recurring(band)?.profit} money={money} strong />
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2/40">
                  <td className={clsx(cell, "text-left text-ink-2")} colSpan={8}>
                    Profit year 1, onboarding and subscription together
                  </td>
                  <td className={clsx(cell, "text-right", group)}>
                    <Profit value={band.years[0]?.profit} money={money} strong />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3.5 text-xs leading-relaxed text-ink-2">
        <span>
          <span className="font-semibold text-bad">Red</span> is what it costs us
        </span>
        <span className="size-[3px] rounded-full bg-axis" />
        <span>
          <span className="font-semibold text-income">Violet</span> is what the client pays us
        </span>
        <span className="size-[3px] rounded-full bg-axis" />
        <span>
          <span className="font-semibold text-ink">Profit</span> is in bold, green when we keep money and red when we
          lose it. Every figure is the total for that scenario's buildings, over a year: a price typed per building is
          multiplied by them, and "Profit per year" is a year that repeats, without the onboarding billed once.
        </span>
      </p>
    </div>
  );
}

/** Step 5 — the market context, and what the model makes of it. */
function StepSuggestion({
  project,
  result,
  money,
}: {
  project: Project;
  result: ProjectResult | null;
  money: Money;
}) {
  const updateProject = useApp((s) => s.updateProject);
  const apiKeySet = useApp((s) => s.apiKeySet);
  const settings = useApp((s) => s.settings);
  const suggesting = useApp((s) => s.suggesting);
  const runSuggestion = useApp((s) => s.runSuggestion);
  const localModels = useApp((s) => s.localModels);
  const loadLocalModels = useApp((s) => s.loadLocalModels);

  const provider = settings?.ai_provider ?? "local";
  const isLocal = provider === "local";
  const plansOnly = project.template === "contractors";

  // Whoever answers has to be there: a model installed locally, or a key for Claude.
  const [checking, setChecking] = useState(isLocal);
  useEffect(() => {
    if (!isLocal) {
      setChecking(false);
      return;
    }
    setChecking(true);
    void loadLocalModels().finally(() => setChecking(false));
  }, [isLocal, loadLocalModels]);

  const available = isLocal ? localModels.length > 0 : provider === "claude" && apiKeySet;
  const ready = available && !plansOnly;
  const answeredBy = isLocal
    ? `${settings?.local_model || "the first model installed"}, running on this machine`
    : "Claude, billed to your Anthropic account";

  const market = project.market;
  const setMarket = (patch: Partial<Project["market"]>) =>
    updateProject((p) => ({ ...p, market: { ...p.market, ...patch } }));
  const suggestion = project.last_suggestion;

  if (checking) return null;
  if (!ready) {
    return (
      <Card>
        <p className="py-16 text-center text-lg font-semibold text-ink-2">Coming soon</p>
      </Card>
    );
  }

  const applyToBands = () => {
    if (!suggestion) return;
    updateProject((p) => ({
      ...p,
      bands: p.bands.map((band) => {
        const match = suggestion.bands.find((b) => b.buildings === band.buildings);
        const value = match?.subscription_price_per_building ?? suggestion.subscription_price_per_building;
        return { ...band, price: { type: "amount", value } };
      }),
    }));
  };

  return (
    <div className="space-y-4">
      <Card
        title="Market"
        description="The model already sees every cost and price in this project. This is what it can't know: who you compete with and what the industry charges."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Industry">
              <TextInput
                value={market.industry}
                placeholder="e.g. Building compliance software, UK"
                onChange={(e) => setMarket({ industry: e.target.value })}
              />
            </Field>
            <Field label="Industry average subscription" hint="Per building / month, if you know it">
              <NumberField
                value={market.average_subscription_price}
                min={0}
                dot="income"
                suffix={project.currency}
                onChange={(v) => setMarket({ average_subscription_price: v })}
              />
            </Field>
            <Field label="Industry average onboarding" hint="Per building">
              <NumberField
                value={market.average_onboarding_price}
                min={0}
                dot="income"
                suffix={project.currency}
                onChange={(v) => setMarket({ average_onboarding_price: v })}
              />
            </Field>
          </div>
          <Field label="Competitors" hint="One per line, with whatever you know about their prices">
            <TextArea
              value={market.competitors}
              placeholder={"Acme Compliance — £420 per building/month, no hardware\nOther Co — bundles onboarding free"}
              onChange={(e) => setMarket({ competitors: e.target.value })}
            />
          </Field>
          <Field label="Anything else" hint="Tenders, regulation, how clients buy…">
            <TextArea value={market.notes} onChange={(e) => setMarket({ notes: e.target.value })} />
          </Field>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          {result
            ? `Answered by ${answeredBy}. It receives your costs, the ${result.bands.length} bands and the prices from steps 2 to 4.`
            : "Fill in the costs first."}
        </p>
        <Button variant="primary" disabled={!ready || suggesting} onClick={() => void runSuggestion()}>
          {suggesting ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          {suggesting ? "Asking…" : suggestion ? "Ask again" : "Ask for a suggestion"}
        </Button>
      </div>

      {suggestion && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <StatTile
              label="Suggested subscription"
              value={money(perMonth(suggestion.subscription_price_per_building))}
              detail="Per building / month"
            />
            <StatTile
              label="Suggested onboarding"
              value={money(suggestion.onboarding_price_per_building)}
              detail="Per building, billed once"
            />
          </div>

          <Card title="What it says" description={suggestion.positioning}>
            <p className="text-sm text-ink-2">{suggestion.rationale}</p>
            {suggestion.risks.length > 0 && (
              <>
                <h3 className="mt-4 mb-1 text-xs font-medium text-ink-2">Risks</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
                  {suggestion.risks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-4 text-xs text-muted">
              {suggestion.model} · {fmtDate(suggestion.created_at)}. A suggestion, not a decision: check it against
              your own markups in step 4.
            </p>
          </Card>

          <Card
            title="Suggested price per band"
            description="Applying this sets each band to a fixed price; step 4 will show the margin it leaves."
            actions={
              <Button size="sm" onClick={applyToBands}>
                Apply to bands
              </Button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-line text-right text-xs text-muted">
                    <th className="py-2 pr-4 text-left font-medium">Buildings</th>
                    <th className="py-2 pr-4 font-medium">Suggested / building / month</th>
                    <th className="py-2 text-left font-medium">Why</th>
                  </tr>
                </thead>
                <tbody className="text-right">
                  {suggestion.bands.map((band) => (
                    <tr key={`${band.buildings}`} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-4 text-left tabular-nums text-ink">{fmtNum(band.buildings)}</td>
                      <td className="py-2.5 pr-4 font-semibold tabular-nums text-ink">
                        {money(perMonth(band.subscription_price_per_building))}
                      </td>
                      <td className="py-2.5 text-left text-ink-2">{band.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }): ReactNode {
  const content = {
    idle: null,
    saving: (
      <>
        <LoaderCircle className="animate-spin" /> Saving…
      </>
    ),
    saved: (
      <>
        <CircleCheck /> Saved
      </>
    ),
    error: (
      <>
        <CircleAlert className="text-bad" /> Couldn't save
      </>
    ),
  }[state];
  return <span className="flex h-9 items-center gap-1.5 text-xs text-muted [&_svg]:size-3.5">{content}</span>;
}
