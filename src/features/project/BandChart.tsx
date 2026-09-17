import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BandResult } from "../../bindings/BandResult";
import type { Currency } from "../../bindings/Currency";
import { fmtMoney } from "../../lib/format";
import { useChartTheme } from "../charts/theme";

/** Monthly subscription cost and price, per building, for each band. */
export function BandChart({ bands, currency }: { bands: BandResult[]; currency: Currency }) {
  const t = useChartTheme();
  const data = bands.map((band) => ({
    label: `Band ${band.position}`,
    buildings: band.buildings,
    cost: (band.subscription.cost_per_building ?? 0) / 12,
    price: (band.subscription.price_per_building ?? 0) / 12,
  }));

  if (data.length === 0) return <p className="text-sm text-muted">Add a band to see the comparison.</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: t.cost }} />
          Monthly cost per building
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: t.income }} />
          Monthly subscription price per building
        </span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
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
            width={76}
          />
          <Tooltip
            cursor={{ fill: t.grid, opacity: 0.5 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content={(props: any) => {
              const row = props.payload?.[0]?.payload as
                | { label: string; buildings: number; cost: number; price: number }
                | undefined;
              if (!props.active || !row) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
                  <div className="mb-1 font-semibold text-ink">
                    {row.label} · {row.buildings} buildings
                  </div>
                  <div className="text-bad">Cost {fmtMoney(row.cost, currency)} per building / month</div>
                  <div className="text-income">Price {fmtMoney(row.price, currency)} per building / month</div>
                </div>
              );
            }}
          />
          <Bar dataKey="cost" fill={t.cost} barSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="price" fill={t.income} barSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
