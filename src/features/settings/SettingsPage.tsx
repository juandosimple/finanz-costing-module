import clsx from "clsx";
import { Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AiProvider } from "../../bindings/AiProvider";
import type { Currency } from "../../bindings/Currency";
import type { Theme } from "../../bindings/Theme";
import { Button, Card, Field, NumberField, Page, Select, TextInput } from "../../components/ui";
import { CURRENCIES, CURRENCY_LABELS } from "../../lib/labels";
import { useApp } from "../../store";

const THEMES: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: "system", label: "System", icon: <Monitor /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
];

export function SettingsPage() {
  const settings = useApp((s) => s.settings);
  const rates = useApp((s) => s.rates);
  const ratesBusy = useApp((s) => s.ratesBusy);
  const apiKeySet = useApp((s) => s.apiKeySet);
  const saveApiKey = useApp((s) => s.saveApiKey);
  const localModels = useApp((s) => s.localModels);
  const loadLocalModels = useApp((s) => s.loadLocalModels);
  const { updateSettings, updateRates, refreshRates } = useApp.getState();
  const [apiKey, setApiKey] = useState("");

  // Ask Ollama what it has as soon as this screen opens.
  useEffect(() => {
    void loadLocalModels();
  }, [loadLocalModels]);

  if (!settings || !rates) return null;

  const perUsd = (currency: Currency) =>
    currency === "USD" ? 1 : rates.rates.find((r) => r.currency === currency)?.per_usd ?? 0;

  const setRate = (currency: Currency, value: number) => {
    const others = rates.rates.filter((r) => r.currency !== currency);
    updateRates({
      rates: [...others, { currency, per_usd: value }],
      updated_at: new Date().toISOString().slice(0, 10),
      source: "Edited manually",
    });
  };

  return (
    <Page title="Settings">
      <div className="space-y-6">
        <Card
          title="Currency"
          description="Used across the whole app: projects, the pricing calculator and every chart. Each cost and plan keeps its own currency as input and is converted to this one."
        >
          <Field label="Show all results in" className="max-w-sm">
            <Select
              value={settings.currency}
              label="Show all results in"
              options={CURRENCIES.map((c) => ({ value: c, label: `${c} · ${CURRENCY_LABELS[c]}` }))}
              onChange={(currency) => updateSettings({ currency })}
            />
          </Field>
        </Card>

        <Card
          title="AI suggestion"
          description="Who answers step 5. A model on this machine costs nothing and needs no key; Claude is sharper but bills your Anthropic account."
        >
          <div className="space-y-4">
            <Field label="Provider" className="max-w-sm">
              <Select
                value={settings.ai_provider}
                label="Provider"
                options={[
                  { value: "local" as AiProvider, label: "Local model (Ollama)" },
                  { value: "claude" as AiProvider, label: "Claude API" },
                  { value: "none" as AiProvider, label: "None" },
                ]}
                onChange={(ai_provider) => updateSettings({ ai_provider })}
              />
            </Field>

            {settings.ai_provider === "none" ? null : settings.ai_provider === "local" ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field
                  label="Model"
                  hint={
                    localModels.length > 0
                      ? `${localModels.length} installed · a 7B model or bigger reasons about pricing far better than a 3B`
                      : "Ollama isn't answering. Start it with `ollama serve`."
                  }
                >
                  <Select
                    value={settings.local_model}
                    label="Model"
                    options={[
                      { value: "", label: "First one available" },
                      ...localModels.map((model) => ({ value: model, label: model })),
                    ]}
                    onChange={(local_model) => updateSettings({ local_model })}
                  />
                </Field>
                <Field label="Ollama address">
                  <div className="flex items-center gap-2">
                    <TextInput
                      value={settings.local_url}
                      placeholder="http://localhost:11434"
                      onChange={(e) => updateSettings({ local_url: e.target.value })}
                    />
                    <Button onClick={() => void loadLocalModels()}>
                      <RefreshCw /> Check
                    </Button>
                  </div>
                </Field>
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Anthropic API key" className="min-w-64 flex-1">
                    <TextInput
                      type="password"
                      value={apiKey}
                      placeholder={apiKeySet ? "A key is saved — type a new one to replace it" : "sk-ant-…"}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </Field>
                  <Button
                    variant="primary"
                    onClick={() => {
                      void saveApiKey(apiKey);
                      setApiKey("");
                    }}
                  >
                    {apiKey.trim() ? "Save key" : "Remove key"}
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted">
                  {apiKeySet ? "A key is saved in the keychain." : "No key saved yet."} It is kept in the macOS
                  keychain, never in the database.
                </p>
              </div>
            )}
          </div>
        </Card>

        <Card title="Appearance" description="Dark mode follows your Mac when set to System.">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Theme">
            {THEMES.map((theme) => {
              const selected = settings.theme === theme.value;
              return (
                <button
                  key={theme.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => updateSettings({ theme: theme.value })}
                  className={clsx(
                    "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors [&_svg]:size-4",
                    selected
                      ? "border-accent bg-accent/10 font-medium text-ink"
                      : "border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {theme.icon}
                  {theme.label}
                </button>
              );
            })}
          </div>
        </Card>

        <Card
          title="Exchange rates"
          description="Base 1 USD. Used to convert each cost and price to the currency above."
          actions={
            <Button onClick={() => void refreshRates()} disabled={ratesBusy}>
              <RefreshCw className={ratesBusy ? "animate-spin" : undefined} />
              {ratesBusy ? "Updating…" : "Update from the internet"}
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full max-w-2xl text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-4 font-medium">Currency</th>
                  <th className="py-2 pr-4 text-right font-medium">1 USD =</th>
                  <th className="py-2 text-right font-medium">1 unit = USD</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {CURRENCIES.filter((c) => c !== "USD").map((currency) => {
                  const rate = perUsd(currency);
                  return (
                    <tr key={currency} className="border-b border-line last:border-0">
                      <td className="py-2 pr-4 text-ink">
                        <span className="font-medium">{currency}</span>{" "}
                        <span className="text-ink-2">· {CURRENCY_LABELS[currency]}</span>
                      </td>
                      <td className="w-48 py-2 pr-4">
                        <NumberField value={rate} min={0} suffix={currency} onChange={(v) => setRate(currency, v)} />
                      </td>
                      <td className="py-2 text-right text-ink-2">{rate > 0 ? (1 / rate).toPrecision(4) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-muted">
            Last updated: {rates.updated_at ?? "never"} · Source: {rates.source}
          </p>
        </Card>
      </div>
    </Page>
  );
}
