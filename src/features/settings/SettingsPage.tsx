import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import clsx from "clsx";
import { Download, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AiProvider } from "../../bindings/AiProvider";
import type { Currency } from "../../bindings/Currency";
import type { Theme } from "../../bindings/Theme";
import { Button, Card, Field, NumberField, Page, Select, TextInput } from "../../components/ui";
import { errorMessage } from "../../lib/api";
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

        <Updates />
      </div>
    </Page>
  );
}

/**
 * Updates the app in place: it downloads the new version, installs it over this
 * one and restarts. Nothing is downloaded by hand and no installer is opened.
 */
function Updates() {
  const [version, setVersion] = useState("");
  const [state, setState] = useState<{
    step: "idle" | "checking" | "none" | "found" | "downloading" | "error";
    version?: string;
    percent?: number;
    message?: string;
  }>({ step: "idle" });
  const pending = useRef<Update | null>(null);

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  const look = async () => {
    setState({ step: "checking" });
    try {
      const update = await check();
      pending.current = update;
      setState(update ? { step: "found", version: update.version } : { step: "none" });
    } catch (e) {
      setState({ step: "error", message: errorMessage(e) });
    }
  };

  const install = async () => {
    const update = pending.current;
    if (!update) return;
    setState({ step: "downloading", percent: 0 });
    let total = 0;
    let done = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          done += event.data.chunkLength;
          setState({ step: "downloading", percent: total ? Math.round((done / total) * 100) : undefined });
        } else if (event.event === "Finished") setState({ step: "downloading", percent: 100 });
      });
      // The new version is in place; the app comes back on it.
      await relaunch();
    } catch (e) {
      setState({ step: "error", message: errorMessage(e) });
    }
  };

  const busy = state.step === "checking" || state.step === "downloading";

  return (
    <Card
      title="Updates"
      description="A new version is installed over this one and the app restarts. There is no installer to download."
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-2">Version {version || "—"}</span>
        {state.step === "found" ? (
          <Button variant="primary" onClick={() => void install()}>
            <Download /> Install {state.version} and restart
          </Button>
        ) : (
          <Button onClick={() => void look()} disabled={busy}>
            <RefreshCw className={clsx(busy && "animate-spin")} />
            {state.step === "checking" ? "Checking…" : "Check for updates"}
          </Button>
        )}
      </div>

      {state.step === "none" && <p className="mt-3 text-xs text-muted">This is the latest version.</p>}
      {state.step === "downloading" && (
        <p className="mt-3 text-xs text-muted">
          {state.percent === undefined ? "Downloading…" : `Downloading ${state.percent}%`} · the app restarts on its
          own when it finishes.
        </p>
      )}
      {state.step === "error" && <p className="mt-3 text-xs text-bad">{state.message}</p>}
    </Card>
  );
}
