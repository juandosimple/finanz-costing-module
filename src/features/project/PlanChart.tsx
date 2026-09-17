import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Currency } from "../../bindings/Currency";
import type { PlanResult } from "../../bindings/PlanResult";
import { fmtMoney, fmtNum } from "../../lib/format";
import { useChartTheme } from "../charts/theme";

const ACCOUNTS = [
  { key: "contractor", label: "Contractor" },
  { key: "consultant", label: "Consultant" },
] as const;

interface Row {
  label: string;
  projects: number;
  cost: number;
  price: number;
  firstMonth: number;
  lastMonth: number;
}

/**
 * What one account costs and pays per month on each plan, one chart per account
 * type so both read on the same kind of axis. Cost is year 1's average month:
 * storage grows, so a single month would flatter or punish the plan.
 */
export function PlanChart({ plans, currency }: { plans: PlanResult[]; currency: Currency }) {
  const t = useChartTheme();
  if (plans.length === 0) return <p className="text-sm text-muted">Add a plan to see the comparison.</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: t.cost }} />
          Cost per account / month (year 1 average)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: t.income }} />
          Price per account / month
        </span>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {ACCOUNTS.map((account) => {
          const data: Row[] = plans.map((plan) => {
            const row = plan[account.key];
            return {
              label: plan.name,
              projects: plan.projects,
              cost: row.subscription.cost / 12,
              price: row.subscription.price / 12,
              firstMonth: row.cost_first_month,
              lastMonth: row.cost_last_month,
            };
          });
          return (
            <figure key={account.key} className="min-w-0">
              <figcaption className="mb-1 text-sm font-medium text-ink">{account.label}</figcaption>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={t.grid} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: t.muted, fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: t.axis }}
                    interval={0}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtMoney(Number(v), currency, { compact: true })}
                    tick={{ fill: t.muted, fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={70}
                  />
                  <Tooltip
                    cursor={{ fill: t.grid, opacity: 0.5 }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={(props: any) => {
                      const row = props.payload?.[0]?.payload as Row | undefined;
                      if (!props.active || !row) return null;
                      return (
                        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
                          <div className="mb-1 font-semibold text-ink">
                            {row.label} · {fmtNum(row.projects)} projects / work records · {account.label.toLowerCase()}
                          </div>
                          <div className="text-bad">
                            Cost {fmtMoney(row.cost, currency)} / month on average ({fmtMoney(row.firstMonth, currency)}{" "}
                            → {fmtMoney(row.lastMonth, currency)})
                          </div>
                          <div className="text-income">Price {fmtMoney(row.price, currency)} / month</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="cost" fill={t.cost} barSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="price" fill={t.income} barSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
