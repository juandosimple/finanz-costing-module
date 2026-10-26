import clsx from "clsx";
import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { BlockedItem } from "../../bindings/BlockedItem";
import type { OnboardingItem } from "../../bindings/OnboardingItem";

export type Money = (value: number | null | undefined) => string;

/** Mirrors the engine's default selection. Ids a template's catalogue doesn't
 *  have are dropped by `defaultSelection`. */
const DEFAULT_ONBOARDING = [
  "scan-to-bim",
  "fire-strategy-embed",
  "onboarding",
  "go-live",
  "spine-unit",
  "support-overhead",
];

export function defaultSelection(catalogue: OnboardingItem[]): string[] {
  return DEFAULT_ONBOARDING.filter((id) => offered(catalogue).some((item) => item.id === id));
}

/** The catalogue without the elements deleted in step 2. */
export function offered(catalogue: OnboardingItem[]): OnboardingItem[] {
  return catalogue.filter((item) => !item.removed);
}

/** Ticking an element drops the alternatives it rules out, so the list stays honest. */
export function toggleSelection(
  catalogue: OnboardingItem[],
  selection: string[],
  itemId: string,
  on: boolean,
): string[] {
  if (!on) return selection.filter((id) => id !== itemId);
  const item = catalogue.find((i) => i.id === itemId);
  const ruledOut = new Set(item?.makes_unnecessary ?? []);
  for (const other of catalogue) {
    if (item?.exclusive_group && other.exclusive_group === item.exclusive_group && other.id !== itemId) {
      ruledOut.add(other.id);
    }
  }
  return [...selection.filter((id) => !ruledOut.has(id)), itemId];
}

/** Costs are red and income violet; profit is green when kept and red when lost. */
export function Profit({
  value,
  money,
  strong,
}: {
  value: number | null | undefined;
  money: Money;
  strong?: boolean;
}) {
  const losing = (value ?? 0) < 0;
  return (
    <span
      className={clsx(
        strong ? "text-sm font-semibold" : "text-xs font-medium",
        losing ? "text-bad" : "text-good",
      )}
    >
      {!losing && value ? "+" : ""}
      {money(value)}
    </span>
  );
}

/** The folding checklist of onboarding elements a band or a plan includes. */
export function OnboardingPicker({
  title,
  catalogue,
  selection,
  priced,
  blocked,
  summary,
  price,
  onToggle,
}: {
  title: string;
  catalogue: OnboardingItem[];
  selection: string[];
  /** Ids the engine actually priced, once the rules are applied. */
  priced: string[] | undefined;
  blocked: BlockedItem[] | undefined;
  summary?: ReactNode;
  /** What each element is charged at, when the list should show it. */
  price?: (itemId: string) => string;
  onToggle: (itemId: string, on: boolean) => void;
}) {
  const blockedById = new Map(blocked?.map((b) => [b.id, b]));
  return (
    <details className="group mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer list-none text-xs font-medium text-ink-2 hover:text-ink">
        <span className="inline-flex items-center gap-1.5">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          {title} — {priced?.length ?? 0} of {catalogue.length} selected
          {summary && <span className="font-normal text-muted">· {summary}</span>}
        </span>
      </summary>
      <div className="mt-2.5 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {catalogue.map((item) => {
          const block = blockedById.get(item.id);
          const checked = selection.includes(item.id) && !block;
          const note = block
            ? block.reason === "covered"
              ? `covered by ${block.blocked_by}`
              : `alternative to ${block.blocked_by}`
            : undefined;
          return (
            <label
              key={item.id}
              title={note}
              className={clsx(
                "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-[13px] transition-colors",
                block
                  ? "cursor-not-allowed border-line bg-surface-2/60 text-muted"
                  : checked
                    ? "border-accent/30 bg-accent-soft text-ink"
                    : "border-line bg-surface text-ink hover:border-ink-2/30",
              )}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={checked}
                disabled={block !== undefined}
                onChange={(e) => onToggle(item.id, e.target.checked)}
              />
              <span
                className={clsx(
                  "flex size-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] [&_svg]:size-2.5",
                  checked ? "border-accent bg-accent text-white" : "border-line bg-surface text-transparent",
                )}
              >
                <Check strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {item.name}
                {note && <span className="text-xs"> — {note}</span>}
              </span>
              {price && (
                <span className={clsx("shrink-0 text-xs font-semibold", checked ? "text-income" : "text-muted")}>
                  {price(item.id)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </details>
  );
}
