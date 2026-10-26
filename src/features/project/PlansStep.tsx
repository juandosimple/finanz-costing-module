import clsx from "clsx";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { OnboardingLine } from "../../bindings/OnboardingLine";
import type { Plan } from "../../bindings/Plan";
import type { PlanResult } from "../../bindings/PlanResult";
import type { Project } from "../../bindings/Project";
import type { ProjectResult } from "../../bindings/ProjectResult";
import { Button, Callout, Card, Field, NumberField, Select, TextInput } from "../../components/ui";
import { fmtNum, fmtPct, perMonth } from "../../lib/format";
import { useApp } from "../../store";
import { PlanChart } from "./PlanChart";
import { defaultSelection, offered, OnboardingPicker, toggleSelection, type Money } from "./shared";

/** Both account types buy the same plans; the screen shows one at a time. */
type Account = "contractor" | "consultant";

const ACCOUNTS: { key: Account; label: string; dot: string; priceField: keyof Plan; storageField: keyof Plan }[] = [
  {
    key: "contractor",
    label: "Contractor",
    dot: "bg-accent-ink",
    priceField: "contractor_price",
    storageField: "contractor_storage_gb",
  },
  {
    key: "consultant",
    label: "Consultant",
    dot: "bg-teal-ink",
    priceField: "consultant_price",
    storageField: "consultant_storage_gb",
  },
];

const of = (account: Account) => ACCOUNTS.find((a) => a.key === account)!;

/** Step 4 for contractors — each plan is sold to both account types, each at its own price. */
export function StepPlans({
  project,
  result,
  money,
}: {
  project: Project;
  result: ProjectResult | null;
  money: Money;
}) {
  const updateProject = useApp((s) => s.updateProject);
  const [account, setAccount] = useState<Account>("contractor");
  const resultById = new Map(result?.plans.map((p) => [p.plan_id, p]));

  const setPlan = (id: string, patch: Partial<Plan>) =>
    updateProject((p) => ({ ...p, plans: p.plans.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan)) }));

  const addPlan = () =>
    updateProject((p) => {
      const last = p.plans[p.plans.length - 1];
      return {
        ...p,
        plans: [
          ...p.plans,
          {
            id: crypto.randomUUID(),
            name: `Plan ${p.plans.length + 1}`,
            projects: last?.projects ?? 20,
            users: last?.users ?? 1,
            contractor_storage_gb: last?.contractor_storage_gb ?? 250,
            consultant_storage_gb: last?.consultant_storage_gb ?? 250,
            contractor_price: null,
            consultant_price: null,
            // A new plan starts from the previous one, so you don't re-tick everything.
            onboarding: [...(last?.onboarding ?? defaultSelection(p.onboarding))],
          },
        ],
      };
    });

  return (
    <div className="space-y-5">
      {result && result.warnings.length > 0 && (
        <Callout tone="warn" icon={<TriangleAlert />}>
          <ul className="space-y-1">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={addPlan}>
          <Plus /> Add plan
        </Button>
      </div>

      {project.plans.map((plan, index) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          index={index}
          account={account}
          onAccount={setAccount}
          computed={resultById.get(plan.id)}
          lines={result?.onboarding_lines ?? []}
          project={project}
          money={money}
          onChange={(patch) => setPlan(plan.id, patch)}
          onToggle={(itemId, on) =>
            setPlan(plan.id, { onboarding: toggleSelection(project.onboarding, plan.onboarding, itemId, on) })
          }
          onRemove={() => updateProject((p) => ({ ...p, plans: p.plans.filter((x) => x.id !== plan.id) }))}
        />
      ))}

      {result && result.plans.length > 0 && (
        <>
          <Card title="Cost and price per account / month">
            <PlanChart plans={result.plans} currency={result.currency} />
          </Card>
          <Card
            title="Plan table"
            description="One account on each plan, over its first year. Storage keeps growing every month, so the last month costs more than the first."
          >
            <PlanTable plans={result.plans} account={account} money={money} />
          </Card>
        </>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  index,
  account,
  onAccount,
  computed,
  lines,
  project,
  money,
  onChange,
  onToggle,
  onRemove,
}: {
  plan: Plan;
  index: number;
  account: Account;
  onAccount: (account: Account) => void;
  computed: PlanResult | undefined;
  lines: OnboardingLine[];
  project: Project;
  money: Money;
  onChange: (patch: Partial<Plan>) => void;
  onToggle: (itemId: string, on: boolean) => void;
  onRemove: () => void;
}) {
  const { priceField: field, storageField } = of(account);
  const storage = account === "contractor" ? plan.contractor_storage_gb : plan.consultant_storage_gb;
  const rule = account === "contractor" ? plan.contractor_price : plan.consultant_price;
  const row = computed?.[account];
  const mode = rule === null ? "project" : rule.type;
  const suggested = row?.suggested_price ?? 0;
  const losing = (row?.subscription.margin ?? 0) < 0;
  const priceById = new Map(lines.map((line) => [line.id, line.unit_price]));

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-4">
        <div className="shrink-0">
          <div className="text-xs font-semibold tracking-wider text-ink-2 uppercase">Plan</div>
          <div className="text-[28px] leading-tight font-bold tracking-tight text-accent-ink">{index + 1}</div>
        </div>
        <Field label="Name" className="flex-[1_1_220px]">
          <TextInput value={plan.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Active projects / Work records" className="flex-[0_1_190px]">
          <NumberField value={plan.projects} min={0} integer onChange={(v) => onChange({ projects: v })} />
        </Field>
        <Field label="Users" className="flex-[0_1_120px]">
          <NumberField value={plan.users} min={0} integer onChange={(v) => onChange({ users: v })} />
        </Field>
        <Field label="Storage" className="flex-[0_1_170px]">
          <NumberField value={storage} min={0} suffix="GB" onChange={(v) => onChange({ [storageField]: v })} />
        </Field>
        <Button aria-label={`Delete plan ${plan.name}`} onClick={onRemove} className="shrink-0">
          <Trash2 />
        </Button>
      </div>

      <div className="mt-4 rounded-[14px] border border-line bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Account type">
            <Select
              value={account}
              label="Account type"
              options={ACCOUNTS.map((a) => ({ value: a.key, label: a.label }))}
              onChange={onAccount}
            />
          </Field>
          <Field label="Charge as">
            <Select
              value={mode}
              label="Charge as"
              options={[
                { value: "project", label: "Project markup" },
                { value: "markup", label: "Account markup" },
                { value: "amount", label: "Fixed price" },
              ]}
              onChange={(next) =>
                onChange({
                  [field]:
                    next === "project"
                      ? null
                      : next === "amount"
                        ? { type: "amount", value: row?.subscription.price ?? suggested }
                        : { type: "markup", percent: project.subscription_markup },
                })
              }
            />
          </Field>
          <Field label={mode === "markup" ? "Markup on cost" : "Price / account / month"}>
            {rule !== null && rule.type === "markup" ? (
              <NumberField
                value={rule.percent}
                min={0}
                scale={100}
                dot="income"
                suffix="%"
                onChange={(v) => onChange({ [field]: { type: "markup", percent: v } })}
              />
            ) : rule !== null && rule.type === "amount" ? (
              <NumberField
                value={rule.value}
                min={0}
                scale={1 / 12}
                dot="income"
                suffix={project.currency}
                onChange={(v) => onChange({ [field]: { type: "amount", value: v } })}
                className="border-accent/25 bg-accent-soft font-semibold text-income"
              />
            ) : (
              <div className="flex h-9 items-center justify-end rounded-md border border-accent/25 bg-accent-soft px-3 text-sm font-semibold text-income tabular-nums">
                {money(perMonth(suggested))}
              </div>
            )}
          </Field>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-xs text-ink-2">
          <span>Costs</span>
          <span className="font-semibold text-bad">
            {money(row?.cost_first_month)} → {money(row?.cost_last_month)}
          </span>
          <span>a month · year 1</span>
          <span className="font-semibold text-bad">{money(row?.subscription.cost)}</span>
          <span className="size-[3px] rounded-full bg-axis" />
          <span className={clsx("font-semibold", losing ? "text-bad" : "text-income")}>
            margin {fmtPct(row?.subscription.margin)}
          </span>
          {plan.users !== 1 && row && (
            <>
              <span className="size-[3px] rounded-full bg-axis" />
              <span>{fmtNum(plan.users)} users</span>
              <span className="font-semibold text-bad">{money(perMonth(row.all_users.cost))}</span>
              <span>→</span>
              <span className="font-semibold text-income">{money(perMonth(row.all_users.price))} / month</span>
            </>
          )}
          {mode !== "project" && (
            <button type="button" className="text-accent hover:underline" onClick={() => onChange({ [field]: null })}>
              · Use the project markup ({money(perMonth(suggested))} / month)
            </button>
          )}
        </div>
      </div>

      {project.onboarding.length > 0 && (
        <OnboardingPicker
          title="Onboarding this plan includes"
          catalogue={offered(project.onboarding)}
          selection={plan.onboarding}
          priced={computed?.onboarding_ids}
          blocked={computed?.blocked}
          price={(id) => money(priceById.get(id))}
          summary={
            computed && computed.onboarding_ids.length > 0
              ? `${money(computed.contractor.onboarding.price)} per account, billed once`
              : undefined
          }
          onToggle={onToggle}
        />
      )}
    </Card>
  );
}

/** One block per plan, showing the account type the screen is set to. */
function PlanTable({ plans, account, money }: { plans: PlanResult[]; account: Account; money: Money }) {
  const shown = of(account);
  const head = "px-4 py-2.5 text-xs font-semibold whitespace-nowrap text-ink-2";
  const cell = "px-4 py-3.5 text-[13px] whitespace-nowrap";
  const group = "border-l border-line";

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-[980px] flex-col gap-4 tabular-nums">
        {plans.map((plan) => {
          const row = plan[account];
          // Onboarding is billed once, so year 1 is where the two streams meet.
          const yearOne = row.onboarding.profit + row.subscription.profit;
          return (
            <div key={plan.plan_id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="flex flex-wrap items-center gap-3.5 px-4 py-3">
                <span className="text-[15px] font-bold tracking-tight text-ink">{plan.name}</span>
                <span className="text-[13px] text-ink-2">
                  {fmtNum(plan.projects)} projects / work records · {fmtNum(row.stored_gb_end_of_year)} GB storage ·{" "}
                  {fmtNum(plan.users)} {plan.users === 1 ? "user" : "users"}
                </span>
                <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <span className={clsx("size-2 rounded-full", shown.dot)} />
                  {shown.label}
                </span>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th />
                    <th className={clsx(head, "text-center tracking-wider uppercase", group)} colSpan={2}>
                      Onboarding · billed once
                    </th>
                    <th className={clsx(head, "text-center tracking-wider uppercase", group)} colSpan={5}>
                      Subscription · year 1
                    </th>
                  </tr>
                  <tr className="border-y border-line bg-surface-2/60">
                    <th className={clsx(head, "text-left")}>Cost / month (1 → 12)</th>
                    <th className={clsx(head, "text-right", group)}>Cost</th>
                    <th className={clsx(head, "text-right")}>Price</th>
                    <th className={clsx(head, "text-right", group)}>Cost</th>
                    <th className={clsx(head, "text-right")}>Price</th>
                    <th className={clsx(head, "text-right")}>Margin</th>
                    <th className={clsx(head, "text-right")}>Quote / month</th>
                    <th className={clsx(head, "text-right")}>Profit year 1</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-right">
                    <td className={clsx(cell, "text-left text-bad")}>
                      {money(row.cost_first_month)} → {money(row.cost_last_month)}
                    </td>
                    <td className={clsx(cell, "text-bad", group)}>{money(row.onboarding.cost)}</td>
                    <td className={clsx(cell, "text-income")}>{money(row.onboarding.price)}</td>
                    <td className={clsx(cell, "text-bad", group)}>{money(row.subscription.cost)}</td>
                    <td className={clsx(cell, "text-income")}>{money(row.subscription.price)}</td>
                    <td className={clsx(cell, "text-ink-2")}>{fmtPct(row.subscription.margin)}</td>
                    <td className={clsx(cell, "text-income")}>{money(perMonth(row.subscription.price))}</td>
                    <td
                      className={clsx(cell, "font-bold", row.subscription.profit < 0 ? "text-bad" : "text-good")}
                    >
                      {row.subscription.profit >= 0 && "+"}
                      {money(row.subscription.profit)}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  {plan.users !== 1 && (
                    <tr className="border-t border-line bg-surface-2/40 text-right">
                      <td className={clsx(cell, "text-left text-ink-2")} colSpan={3}>
                        {fmtNum(plan.users)} users together
                      </td>
                      <td className={clsx(cell, "text-bad", group)}>{money(row.all_users.cost)}</td>
                      <td className={clsx(cell, "text-income")}>{money(row.all_users.price)}</td>
                      <td className={clsx(cell, "text-ink-2")}>{fmtPct(row.all_users.margin)}</td>
                      <td className={clsx(cell, "text-income")}>{money(perMonth(row.all_users.price))}</td>
                      <td
                        className={clsx(cell, "font-bold", row.all_users.profit < 0 ? "text-bad" : "text-good")}
                      >
                        {row.all_users.profit >= 0 && "+"}
                        {money(row.all_users.profit)}
                      </td>
                    </tr>
                  )}
                  <tr className="border-t border-line bg-surface-2/40">
                    <td className={clsx(cell, "text-left text-ink-2")} colSpan={7}>
                      Profit year 1, onboarding and subscription together
                    </td>
                    <td className={clsx(cell, "text-right font-bold", yearOne < 0 ? "text-bad" : "text-good")}>
                      {yearOne >= 0 && "+"}
                      {money(yearOne)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })}
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3.5 text-xs leading-relaxed text-ink-2">
        <span>
          <span className="font-semibold text-bad">Red</span> is what it costs us
        </span>
        <span className="size-[3px] rounded-full bg-axis" />
        <span>
          <span className="font-semibold text-income">Violet</span> is what the account pays us
        </span>
        <span className="size-[3px] rounded-full bg-axis" />
        <span>
          <span className="font-semibold text-ink">Profit</span> is in bold, green when the subscription keeps money in
          year 1 and red when it loses it. The onboarding is billed once, on top.
        </span>
      </p>
    </div>
  );
}
