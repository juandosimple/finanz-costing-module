import { Printer, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Logo } from "../../components/Logo";
import type { Project } from "../../bindings/Project";
import type { ProjectResult } from "../../bindings/ProjectResult";
import { fmtDate, fmtMoney, fmtNum, fmtPct, perMonth } from "../../lib/format";
import { BASIS_LABELS, RECURRENCE_LABELS, TEMPLATE_LABELS } from "../../lib/labels";

/**
 * The whole project as one document: what it costs us, what we charge, every
 * scenario and what the model said about the price. It is what leaves the app
 * for a client, so printing is the point — the screen chrome carries the
 * `report-hide` class and the print rules in index.css drop it.
 */
export function ProjectReport({
  project,
  result,
  onClose,
}: {
  project: Project;
  result: ProjectResult | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const money = (value: number | null | undefined) => fmtMoney(value ?? null, project.currency);
  const suggestion = project.last_suggestion;
  const plansOnly = project.template === "contractors";
  const nameById = new Map(result?.onboarding_lines.map((line) => [line.id, line.name]));

  return createPortal(
    <div className="report fixed inset-0 z-50 overflow-y-auto bg-page">
      <div className="report-hide sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-6 py-3">
        <div className="text-sm text-ink-2">
          Report · <span className="text-ink">{project.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white [&_svg]:size-4"
          >
            <Printer />
            Print / Save as PDF
          </button>
          <button
            type="button"
            aria-label="Close report"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:text-ink [&_svg]:size-4"
          >
            <X />
            Close
          </button>
        </div>
      </div>

      <article className="report-sheet mx-auto max-w-[820px] px-10 py-8">
        <header className="report-section mb-8 border-b border-line pb-4">
          <Logo className="mb-5 h-5 w-auto text-ink" />
          <h1 className="text-2xl font-semibold text-ink">{project.name}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {project.client ? `${project.client} · ` : ""}
            {TEMPLATE_LABELS[project.template]} · all figures in {project.currency}
          </p>
          <p className="mt-0.5 text-xs text-muted">Generated {fmtDate(new Date().toISOString())}</p>
          {project.notes.trim() && <p className="mt-3 text-sm text-ink-2">{project.notes}</p>}
        </header>

        <Section title="1 · What it costs us">
          {plansOnly ? (
            <>
              <Row label="Platform per account" value={`${money(project.usage.per_account_monthly)} / month`} />
              <Row
                label="Platform per active project / work record"
                value={`${money(project.usage.per_project_monthly)} / month`}
              />
              <Row
                label="Platform fixed cost, not carried by any account"
                value={`${money(project.usage.platform_fixed_monthly)} / month`}
              />
              <Row
                label="Storage, with its backup copy"
                value={`${money(project.usage.storage_per_gb_month)} / GB / month`}
              />
              <Row label="Downloads" value={`${money(project.usage.download_per_gb)} / GB`} />
              <Row label="Downloaded each month vs uploaded" value={fmtPct(project.usage.download_share)} />
              {project.plans.map((plan) => (
                <Row
                  key={plan.id}
                  label={`Storage after a year · ${plan.name}`}
                  value={`${fmtNum(plan.contractor_storage_gb)} GB contractor · ${fmtNum(plan.consultant_storage_gb)} GB consultant`}
                />
              ))}
            </>
          ) : (
            <>
              <Row label="Fixed costs, whole platform" value={`${money(project.structure.fixed_monthly)} / month`} />
              <Row label="Cost of one building" value={`${money(project.structure.per_building_monthly)} / month`} />
            </>
          )}
          <Row label="Payment fee on every charge" value={fmtPct(project.structure.fee_percent)} />

          {project.onboarding.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-4 font-medium">Onboarding element</th>
                  <th className="py-2 pr-4 font-medium">Billed</th>
                  <th className="py-2 pr-4 font-medium">Charged per</th>
                  <th className="py-2 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {project.onboarding.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4 text-ink">
                      {item.name}
                      <span className="block text-xs text-muted">{item.category}</span>
                    </td>
                    <td className="py-2 pr-4 text-ink-2">{RECURRENCE_LABELS[item.recurrence]}</td>
                    <td className="py-2 pr-4 text-ink-2">{BASIS_LABELS[item.basis]}</td>
                    <td className="py-2 text-right tabular-nums text-bad">{money(item.internal_unit_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="2 · What we charge">
          <Row label="Subscription margin" value={fmtPct(project.subscription_margin)} />
          <p className="mt-1 text-xs text-muted">
            {plansOnly
              ? "The subscription price per account covers its plan's share of the server and the database, its storage and downloads, the payment fee and that margin."
              : "The subscription price per building covers the structure costs, the payment fee and that margin."}{" "}
            Onboarding is billed once, apart from it.
          </p>

          {result && result.onboarding_lines.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-4 font-medium">Element</th>
                  <th className="py-2 pr-4 text-right font-medium">Cost</th>
                  <th className="py-2 pr-4 text-right font-medium">We charge</th>
                  <th className="py-2 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {result.onboarding_lines.map((line) => (
                  <tr key={line.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4 text-ink">{line.name}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-bad">{money(line.unit_cost)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium text-income">
                      {money(line.unit_price)}
                      {line.manual_price && <span className="ml-1 text-xs font-normal text-muted">fixed</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-2">{fmtPct(line.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {result && plansOnly && (
          <Section title="3 · Plans">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-right text-xs text-muted">
                  <th className="py-2 pr-4 text-left font-medium">Plan</th>
                  <th className="py-2 pr-4 text-left font-medium">Account</th>
                  <th className="py-2 pr-4 font-medium">
                    Quote
                    <span className="block font-normal">per account / month</span>
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    Onboarding
                    <span className="block font-normal">billed once</span>
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    Subscription
                    <span className="block font-normal">year 1</span>
                  </th>
                  <th className="py-2 font-medium">
                    Profit
                    <span className="block font-normal">year 1</span>
                  </th>
                </tr>
              </thead>
              <tbody className="text-right tabular-nums">
                {result.plans.flatMap((plan) =>
                  (["contractor", "consultant"] as const).map((kind, i) => {
                    const row = plan[kind];
                    const losing = row.subscription.profit < 0;
                    return (
                      <tr key={`${plan.plan_id}-${kind}`} className={i === 1 ? "border-b border-line last:border-0" : ""}>
                        <td className="py-2 pr-4 text-left font-medium text-ink">
                          {i === 0 && (
                            <>
                              {plan.name}
                              <span className="block text-xs font-normal text-muted">
                                {fmtNum(plan.projects)} projects · {fmtNum(plan.users)}{" "}
                                {plan.users === 1 ? "user" : "users"}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-left text-ink-2 capitalize">{kind}</td>
                        <td className="py-2 pr-4 font-medium text-income">
                          {money(perMonth(row.subscription.price))}
                          {plan.users !== 1 && (
                            <span className="block text-xs font-normal">
                              {money(perMonth(row.all_users.price))} for {fmtNum(plan.users)} users
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-income">
                          {money(row.onboarding.price)}
                          <span className="block text-xs text-bad">costs {money(row.onboarding.cost)}</span>
                        </td>
                        <td className="py-2 pr-4 text-income">
                          {money(row.subscription.price)}
                          <span className="block text-xs text-bad">
                            costs {money(row.subscription.cost)} ({money(row.cost_first_month)} →{" "}
                            {money(row.cost_last_month)} a month)
                          </span>
                        </td>
                        <td className="py-2">
                          <span className={losing ? "font-semibold text-bad" : "font-semibold text-good"}>
                            {money(row.subscription.profit)}
                          </span>
                          <span className="block text-xs text-muted">margin {fmtPct(row.subscription.margin)}</span>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted">
              Figures are for one account over its first year; a plan sold to several users is that many times the
              subscription. Storage keeps every month's evidence, so each month
              costs a little more than the one before.
            </p>

            <h3 className="mt-6 mb-2 text-xs font-medium text-ink-2">What each plan includes</h3>
            <ul className="space-y-1 text-sm text-ink-2">
              {result.plans.map((plan) => (
                <li key={plan.plan_id}>
                  <span className="font-medium text-ink">{plan.name}</span> · {fmtNum(plan.projects)} active projects / work records ·{" "}
                  {fmtNum(plan.users)} {plan.users === 1 ? "user" : "users"} —{" "}
                  {plan.onboarding_ids.length === 0
                    ? "subscription only, no onboarding"
                    : plan.onboarding_ids.map((id) => nameById.get(id) ?? id).join(", ")}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {result && !plansOnly && (
          <Section title="3 · Scenarios">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-right text-xs text-muted">
                  <th className="py-2 pr-4 text-left font-medium">Scenario</th>
                  <th className="py-2 pr-4 font-medium">Buildings</th>
                  <th className="py-2 pr-4 font-medium">
                    Quote
                    <span className="block font-normal">per building / month</span>
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    Onboarding
                    <span className="block font-normal">billed once</span>
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    Subscription
                    <span className="block font-normal">every year</span>
                  </th>
                  <th className="py-2 font-medium">
                    Profit
                    <span className="block font-normal">per year</span>
                  </th>
                </tr>
              </thead>
              <tbody className="text-right tabular-nums">
                {result.bands.map((band) => {
                  const recurring = band.years.find((year) => year.year === 2) ?? band.years[0];
                  const losing = (recurring?.profit ?? 0) < 0;
                  return (
                    <tr key={band.band_id} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-4 text-left font-medium text-ink">Band {band.position}</td>
                      <td className="py-2.5 pr-4 text-ink-2">{fmtNum(band.buildings)}</td>
                      <td className="py-2.5 pr-4 font-medium text-income">
                        {money(perMonth(band.subscription.price_per_building))}
                      </td>
                      <td className="py-2.5 pr-4 text-income">
                        {money(band.onboarding.price)}
                        <span className="block text-xs text-bad">costs {money(band.onboarding.cost)}</span>
                      </td>
                      <td className="py-2.5 pr-4 text-income">
                        {money(band.subscription.price)}
                        <span className="block text-xs text-bad">costs {money(band.subscription.cost)}</span>
                      </td>
                      <td className="py-2.5">
                        <span className={losing ? "font-semibold text-bad" : "font-semibold text-good"}>
                          {money(recurring?.profit)}
                        </span>
                        <span className="block text-xs text-muted">margin {fmtPct(band.subscription.margin)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted">
              Onboarding and subscription are totals for that scenario's buildings, over a whole year. The quote column
              is the price for one building in one month, which is what the client is told.
            </p>

            <h3 className="mt-6 mb-2 text-xs font-medium text-ink-2">What each scenario includes</h3>
            <ul className="space-y-1 text-sm text-ink-2">
              {result.bands.map((band) => (
                <li key={band.band_id}>
                  <span className="font-medium text-ink">Band {band.position}</span> · {fmtNum(band.buildings)} buildings
                  —{" "}
                  {band.onboarding_ids.length === 0
                    ? "subscription only, no onboarding"
                    : band.onboarding_ids.map((id) => nameById.get(id) ?? id).join(", ")}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {suggestion && (
          <Section title="4 · What the AI suggests">
            <div className="mb-4 flex flex-wrap gap-8">
              <div>
                <div className="text-xs text-muted">Subscription</div>
                <div className="text-lg font-semibold text-ink">
                  {money(perMonth(suggestion.subscription_price_per_building))}
                </div>
                <div className="text-xs text-muted">per building / month</div>
              </div>
              <div>
                <div className="text-xs text-muted">Onboarding</div>
                <div className="text-lg font-semibold text-ink">
                  {money(suggestion.onboarding_price_per_building)}
                </div>
                <div className="text-xs text-muted">per building, billed once</div>
              </div>
            </div>

            <p className="text-sm font-medium text-ink">{suggestion.positioning}</p>
            <p className="mt-1 text-sm text-ink-2">{suggestion.rationale}</p>

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

            {suggestion.bands.length > 0 && (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-4 font-medium">Buildings</th>
                    <th className="py-2 pr-4 text-right font-medium">Suggested / building / month</th>
                    <th className="py-2 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestion.bands.map((band) => (
                    <tr key={`${band.buildings}`} className="border-b border-line last:border-0">
                      <td className="py-2 pr-4 tabular-nums text-ink">{fmtNum(band.buildings)}</td>
                      <td className="py-2 pr-4 text-right font-medium tabular-nums text-ink">
                        {money(perMonth(band.subscription_price_per_building))}
                      </td>
                      <td className="py-2 text-ink-2">{band.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="mt-4 text-xs text-muted">
              Answered by {suggestion.model} on {fmtDate(suggestion.created_at)}
              {project.market.industry.trim() && `, told the industry is ${project.market.industry.trim()}`}. A
              suggestion, not a decision: the arithmetic above is the app's own.
            </p>
          </Section>
        )}
      </article>
    </div>,
    document.body,
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="report-section mb-8">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <span className="text-ink-2">{label}</span>
      <span className="tabular-nums text-ink">{value}</span>
    </div>
  );
}
