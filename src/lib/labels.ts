import type { CostBasis } from "../bindings/CostBasis";
import type { Currency } from "../bindings/Currency";
import type { ProjectTemplate } from "../bindings/ProjectTemplate";
import type { Recurrence } from "../bindings/Recurrence";

export const CURRENCIES: Currency[] = ["USD", "ARS", "CLP", "COP", "MXN", "UYU", "GBP", "EUR"];

export const CURRENCY_LABELS: Record<Currency, string> = {
  USD: "US dollar",
  ARS: "Argentine peso",
  CLP: "Chilean peso",
  COP: "Colombian peso",
  MXN: "Mexican peso",
  UYU: "Uruguayan peso",
  GBP: "British pound",
  EUR: "Euro",
};

export const TEMPLATES: { value: ProjectTemplate; label: string; hint: string }[] = [
  {
    value: "building_owners",
    label: "Modle - Building owners",
    hint: "Platform costs plus the whole onboarding catalogue: surveys, modelling, compliance, hardware.",
  },
  {
    value: "contractors",
    label: "Modle - Contractors/Consultants",
    hint: "Platform costs plus setup and ongoing services — no modelling, surveys, drawings, compliance or hardware.",
  },
];

export const TEMPLATE_LABELS: Record<ProjectTemplate, string> = {
  building_owners: "Modle - Building owners",
  contractors: "Modle - Contractors/Consultants",
};

export const BASES: CostBasis[] = ["per_building", "per_project"];

export const BASIS_LABELS: Record<CostBasis, string> = {
  per_building: "Per building",
  per_project: "Per project",
};

export const RECURRENCES: Recurrence[] = ["one_off", "annual"];

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  one_off: "One-off",
  annual: "Annual",
};
