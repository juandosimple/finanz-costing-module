import { useEffect, useState } from "react";
import { useApp } from "../../store";

export const MAX_CATEGORICAL = 8;

export interface ChartTheme {
  /** Costs are read in red, income in the brand violet. */
  cost: string;
  income: string;
  /** Validated categorical palette, in fixed order. */
  categorical: string[];
  grid: string;
  axis: string;
  muted: string;
  ink: string;
  ink2: string;
  surface: string;
}

function readTheme(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    cost: v("--cost-soft"),
    income: v("--income"),
    categorical: Array.from({ length: MAX_CATEGORICAL }, (_, i) => v(`--cat-${i + 1}`)),
    grid: v("--line"),
    axis: v("--axis"),
    muted: v("--muted"),
    ink: v("--ink"),
    ink2: v("--ink-2"),
    surface: v("--surface"),
  };
}

/** Colors from the CSS tokens, re-read when the theme setting or the OS mode changes. */
export function useChartTheme(): ChartTheme {
  const setting = useApp((s) => s.settings?.theme);
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    // The store stamps data-theme on <html> before this runs, so the tokens are current.
    setTheme(readTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(readTheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [setting]);

  return theme;
}

/** Color for the scenario at `index` (0 = base). Past the palette size it falls back to gray. */
export function categoricalColor(theme: ChartTheme, index: number): string {
  return index < MAX_CATEGORICAL ? theme.categorical[index] : theme.muted;
}
