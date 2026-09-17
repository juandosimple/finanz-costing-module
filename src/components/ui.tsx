import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

const inputClass =
  "h-9 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted " +
  "focus:border-accent/50 focus:ring-3 focus:ring-accent/12 focus:outline-none";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs [&_svg]:size-3.5" : "h-9 px-3.5 text-sm [&_svg]:size-4",
        {
          primary: "bg-accent text-white hover:brightness-90",
          secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
          ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
          danger: "text-bad hover:bg-bad/10",
        }[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-2 max-w-[62ch] text-[15px] text-ink-2">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("glass min-w-0 rounded-[18px] border border-line p-6 shadow-sm", className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-2">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(inputClass, className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(inputClass, "h-auto min-h-24 py-2", className)} {...props} />;
}

/**
 * The brand's dropdown: a trigger that opens a panel of options, with the
 * current one marked. It replaces the native select everywhere, so it carries
 * the keyboard behaviour a select has — arrows to move, Enter to choose,
 * Escape to close — and closes when you click away.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
  /** Names the control for screen readers when the visible label isn't tied to it. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Where the panel goes. Cards are frosted, and a backdrop filter traps any
  // child in its own stacking context, so the panel is drawn on the document
  // instead — otherwise the next card covers it.
  const [at, setAt] = useState({ top: 0, left: 0, width: 0, above: false });
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  const place = () => {
    const trigger = box.current?.getBoundingClientRect();
    if (!trigger) return;
    const needed = Math.min(options.length * 38 + 12, 280);
    const above = trigger.bottom + needed > window.innerHeight && trigger.top > needed;
    setAt({
      top: above ? trigger.top - 6 : trigger.bottom + 6,
      left: trigger.left,
      width: trigger.width,
      above,
    });
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const follow = () => place();
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    place();
    setOpen(true);
  };
  const choose = (next: T) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={box} className={clsx("relative min-w-0", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return show();
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
          } else if (e.key === "Enter" || e.key === " ") {
            if (open) {
              e.preventDefault();
              choose(options[active].value);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={clsx(
          inputClass,
          "flex items-center justify-between gap-2.5 text-left",
          open && "border-accent/40",
        )}
      >
        <span className="min-w-0 truncate">{current?.label ?? ""}</span>
        <ChevronDown className={clsx("size-3 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panel}
            role="listbox"
            style={{
              position: "fixed",
              left: at.left,
              minWidth: at.width,
              ...(at.above ? { bottom: window.innerHeight - at.top } : { top: at.top }),
            }}
            className="z-50 rounded-[11px] border border-line bg-surface p-1.5 shadow-lg"
          >
            {options.map((option, i) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(option.value)}
                className={clsx(
                  "block w-full rounded-[7px] px-2.5 py-2 text-left text-[13px] whitespace-nowrap",
                  option.value === value ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink",
                  i === active && option.value !== value && "bg-surface-2",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

type NumberFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min"> & {
  value: number;
  onChange: (value: number) => void;
  /** Display factor: 100 to show fractions as percentages. */
  scale?: number;
  min?: number;
  integer?: boolean;
  prefix?: string;
  suffix?: string;
  /** Marks the field: red for what something costs us, green for what it earns. */
  dot?: "cost" | "income";
};

/** Numeric input that accepts a comma or dot decimal and doesn't overwrite what's being typed. */
export function NumberField({
  value,
  onChange,
  scale = 1,
  min,
  integer,
  prefix,
  suffix,
  dot,
  className,
  ...props
}: NumberFieldProps) {
  const toText = (v: number) => String(Math.round(v * scale * 1e6) / 1e6);
  const [text, setText] = useState(() => toText(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, scale]);

  return (
    <div className={clsx("relative flex items-center", className)}>
      {dot && (
        <span
          aria-hidden
          className={clsx(
            "pointer-events-none absolute left-3 size-1.5 rounded-full",
            dot === "cost" ? "bg-bad" : "bg-good",
          )}
        />
      )}
      {prefix && (
        <span className={clsx("pointer-events-none absolute text-xs text-muted", dot ? "left-6" : "left-2.5")}>
          {prefix}
        </span>
      )}
      <input
        inputMode="decimal"
        className={clsx(
          inputClass,
          "text-right tabular-nums",
          dot && (prefix ? "pl-12" : "pl-7"),
          !dot && prefix && "pl-9",
          suffix && "pr-12",
        )}
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(toText(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseNumber(e.target.value);
          if (parsed === null) return;
          let next = parsed / scale;
          if (integer) next = Math.round(next);
          if (min !== undefined && next < min) return;
          onChange(Math.round(next * 1e10) / 1e10);
        }}
        {...props}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 text-xs text-muted">{suffix}</span>}
    </div>
  );
}

function parseNumber(raw: string): number | null {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (normalized === "" || normalized === "-" || normalized === ".") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: string }[];
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              selected ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function StatTile({
  label,
  value,
  detail,
  tone = "muted",
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: "muted" | "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className="mt-1.5 truncate text-2xl font-semibold text-ink">{value}</div>
      {detail && (
        <div
          className={clsx(
            "mt-1 flex items-center gap-1 text-xs [&_svg]:size-3.5",
            { muted: "text-muted", good: "text-good", bad: "text-bad" }[tone],
          )}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

export function Callout({
  tone,
  icon,
  children,
}: {
  tone: "warn" | "bad" | "info";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={clsx(
        "flex gap-3 rounded-xl border p-4 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        {
          warn: "border-warn/40 bg-warn/10 text-ink",
          bad: "border-bad/40 bg-bad/10 text-ink",
          info: "border-accent/40 bg-accent/10 text-ink",
        }[tone],
      )}
    >
      <span className={clsx("mt-0.5 shrink-0 [&_svg]:size-4", { warn: "text-warn", bad: "text-bad", info: "text-accent" }[tone])}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
