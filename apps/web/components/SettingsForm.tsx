"use client";

import { useEffect, useState } from "react";

interface LlmStatus {
  provider: "claude-cli" | "ollama";
  usable: boolean;
  path: string | null;
  version: string | null;
  /** Always false — there is deliberately no pay-per-token option. */
  metered: boolean;
  message: string;
  missingFlags?: string[];
}

interface StoredSettings {
  llmProvider: "claude-cli" | "ollama";
  claudeCliPath: string;
  ollamaUrl: string;
  ollamaModel: string;
  engineUrl: string;
  voiceLocales: string[];
  defaultVoice: string;
  defaultFont: string;
  videoSource: "pixabay" | "pexels" | "local";
  /** The keys themselves are never sent to the browser — only whether they exist. */
  pixabayApiKeySet: boolean;
  pexelsApiKeySet: boolean;
}

type Status = { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string };

export function SettingsForm() {
  const [settings, setSettings] = useState<StoredSettings | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Keys are write-only: we never receive the stored value, so an empty box
  // means "leave it alone", not "clear it".
  const [pixabayKey, setPixabayKey] = useState("");
  const [pexelsKey, setPexelsKey] = useState("");
  const [llm, setLlm] = useState<LlmStatus | null>(null);

  const refreshLlm = () =>
    fetch("/api/llm/status")
      .then((r) => r.json())
      .then(setLlm)
      .catch(() => setLlm(null));

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => setStatus({ kind: "error", message: "Could not load settings." }));
    void refreshLlm();
  }, []);

  async function save(patch: Record<string, unknown>) {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) {
        const detail = body.issues?.[0]
          ? `${body.issues[0].field}: ${body.issues[0].problem}`
          : (body.error ?? "Could not save.");
        setStatus({ kind: "error", message: detail });
        return;
      }
      setSettings(body);
      setPixabayKey("");
      setPexelsKey("");
      void refreshLlm();
      setStatus({ kind: "saved" });
      setTimeout(() => setStatus({ kind: "idle" }), 2500);
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server." });
    }
  }

  if (!settings) {
    return <p className="text-sm text-stone-500">Loading…</p>;
  }

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        save({
          llmProvider: settings.llmProvider,
          claudeCliPath: settings.claudeCliPath,
          ollamaUrl: settings.ollamaUrl,
          ollamaModel: settings.ollamaModel,
          engineUrl: settings.engineUrl,
          videoSource: settings.videoSource,
          defaultVoice: settings.defaultVoice,
          ...(pixabayKey.trim() ? { pixabayApiKey: pixabayKey.trim() } : {}),
          ...(pexelsKey.trim() ? { pexelsApiKey: pexelsKey.trim() } : {}),
        });
      }}
    >
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Script writing</h2>
        <p className="-mt-2 text-xs leading-relaxed text-stone-500">
          Used only when you give a topic instead of writing the script yourself. Both
          options run without a paid API key.
        </p>

        <Field label="Provider">
          <select
            value={settings.llmProvider}
            onChange={(e) =>
              setSettings({
                ...settings,
                llmProvider: e.target.value as StoredSettings["llmProvider"],
              })
            }
            className={inputClass}
          >
            <option value="claude-cli">Claude CLI — your subscription</option>
            <option value="ollama">Ollama — a model on this machine</option>
          </select>
        </Field>

        {settings.llmProvider === "claude-cli" ? (
          <Field
            label="Claude CLI path"
            hint="Leave blank to search the usual locations."
          >
            <input
              value={settings.claudeCliPath}
              onChange={(e) => setSettings({ ...settings, claudeCliPath: e.target.value })}
            {...noAutofill}
              placeholder={llm?.path ?? "/usr/local/bin/claude"}
              className={`${inputClass} font-mono text-xs`}
            />
          </Field>
        ) : (
          <>
            <Field label="Ollama URL">
              <input
                value={settings.ollamaUrl}
                onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
                {...noAutofill}
            {...noAutofill}
                className={`${inputClass} font-mono text-xs`}
              />
            </Field>
            <Field label="Model">
              <input
                value={settings.ollamaModel}
                onChange={(e) => setSettings({ ...settings, ollamaModel: e.target.value })}
                {...noAutofill}
            {...noAutofill}
                className={inputClass}
              />
            </Field>
          </>
        )}

        <LlmStatusPanel status={llm} onRecheck={refreshLlm} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Footage</h2>

        <Field label="Source" hint="Where stock clips come from.">
          <select
            value={settings.videoSource}
            onChange={(e) =>
              setSettings({ ...settings, videoSource: e.target.value as StoredSettings["videoSource"] })
            }
            className={inputClass}
          >
            <option value="pixabay">Pixabay — free, key required</option>
            <option value="pexels">Pexels — free, key required</option>
            <option value="local">Local files</option>
          </select>
        </Field>

        <KeyField
          label="Pixabay API key"
          configured={settings.pixabayApiKeySet}
          value={pixabayKey}
          onChange={setPixabayKey}
          href="https://pixabay.com/api/docs/"
          note="Free and instant — no card. Needed to search footage and to check search terms."
        />

        <KeyField
          label="Pexels API key"
          configured={settings.pexelsApiKeySet}
          value={pexelsKey}
          onChange={setPexelsKey}
          href="https://www.pexels.com/api/"
          note="Optional. Only needed if you switch the source to Pexels."
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Defaults</h2>
        <Field label="Voice" hint="Used when a style preset does not specify one.">
          <input
            value={settings.defaultVoice}
            onChange={(e) => setSettings({ ...settings, defaultVoice: e.target.value })}
            {...noAutofill}
            className={inputClass}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Rendering</h2>
        <Field
          label="Engine URL"
          hint="Rendering is delegated over HTTP until the built-in renderer lands. Any service implementing the contract works."
        >
          <input
            value={settings.engineUrl}
            onChange={(e) => setSettings({ ...settings, engineUrl: e.target.value })}
            {...noAutofill}
            className={`${inputClass} font-mono text-xs`}
          />
        </Field>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status.kind === "saving"}
          className="rounded-md bg-stone-900 px-5 py-2.5 text-sm font-medium text-stone-50 transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
        >
          {status.kind === "saving" ? "Saving…" : "Save settings"}
        </button>
        {status.kind === "saved" && (
          <span className="text-sm text-emerald-700 dark:text-emerald-400">Saved</span>
        )}
        {status.kind === "error" && (
          <span className="text-sm text-red-700 dark:text-red-400">{status.message}</span>
        )}
      </div>
    </form>
  );
}

/**
 * States plainly what is in use and whether it works.
 *
 * The cost line is deliberate rather than decorative: the reasonable assumption
 * about anything calling a model is that it is billing someone, and here it is
 * not. Showing the resolved path and version makes that checkable instead of a
 * claim.
 */
function LlmStatusPanel({
  status,
  onRecheck,
}: {
  status: LlmStatus | null;
  onRecheck: () => void;
}) {
  if (!status) {
    return <p className="text-xs text-stone-500">Checking…</p>;
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-md border p-3 text-xs ${
        status.usable
          ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30"
          : "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={
            status.usable
              ? "font-medium text-emerald-900 dark:text-emerald-200"
              : "font-medium text-amber-900 dark:text-amber-200"
          }
        >
          {status.usable ? "Ready" : "Not usable yet"}
        </span>
        <button
          type="button"
          onClick={onRecheck}
          className="shrink-0 underline underline-offset-2 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
        >
          Re-check
        </button>
      </div>

      <p className="text-stone-700 dark:text-stone-300">{status.message}</p>

      {status.path && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px] text-stone-500">
          <dt>path</dt>
          <dd className="break-all">{status.path}</dd>
          {status.version && (
            <>
              <dt>version</dt>
              <dd>{status.version}</dd>
            </>
          )}
          <dt>cost</dt>
          <dd>{status.metered ? "metered" : "none — not billed per use"}</dd>
        </dl>
      )}
    </div>
  );
}

/**
 * Stops browsers and password managers filling these in.
 *
 * Chrome ignores autocomplete="off" on fields it has decided look like a login,
 * and it decided a filesystem path box was an email box — filling it with an
 * address, which would have silently broken the configuration. A non-standard
 * autocomplete token is honoured where "off" is not, and the data- attributes
 * cover 1Password and LastPass.
 */
const noAutofill = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-form-type": "other",
} as const;

const inputClass =
  "w-full rounded-md border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-stone-400 focus:border-stone-900 dark:border-stone-700 dark:focus:border-stone-300";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs leading-relaxed text-stone-500">{hint}</span>}
    </label>
  );
}

/** Write-only: a stored key is never displayed, only acknowledged. */
function KeyField({
  label,
  configured,
  value,
  onChange,
  href,
  note,
}: {
  label: string;
  configured: boolean;
  value: string;
  onChange: (v: string) => void;
  href: string;
  note: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm font-medium">
        {label}
        {configured && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-normal text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            configured
          </span>
        )}
      </span>
      <input
        type="password"
        {...noAutofill}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={configured ? "Leave blank to keep the current key" : "Paste your key"}
        className={inputClass}
      />
      <span className="text-xs leading-relaxed text-stone-500">
        {note}{" "}
        <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          Get a key
        </a>
      </span>
    </label>
  );
}
