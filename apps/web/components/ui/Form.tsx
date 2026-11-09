"use client";

import { useId, useState } from "react";

/**
 * Form primitives shared by the creation sections.
 *
 * Extracted because four panels now need them, and because consistent spacing
 * and label treatment is what keeps forty controls from reading as a wall.
 */

export const inputClass =
  "w-full rounded-md border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-stone-400 focus:border-stone-900 dark:border-stone-700 dark:focus:border-stone-300";

export function Field({
  label,
  hint,
  labelAside,
  warning,
  children,
}: {
  label: string;
  hint?: string;
  /** Sits opposite the label — a link, or chips describing the current choice. */
  labelAside?: React.ReactNode;
  /** Shown beneath in amber. For choices that are valid but will disappoint. */
  warning?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-3 text-sm font-medium">
        {label}
        {labelAside}
      </span>
      {children}
      {hint && <span className="text-xs leading-relaxed text-stone-500">{hint}</span>}
      {warning && (
        <span className="text-xs leading-relaxed text-amber-700 dark:text-amber-500">
          {warning}
        </span>
      )}
    </label>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  ...rest
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={inputClass}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A slider with its value shown.
 *
 * A bare range input makes people guess what they picked, which matters for
 * things like volume where the difference between 0.1 and 0.3 is audible.
 */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  format = String,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <span className="flex items-center gap-3">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-stone-200 accent-stone-900 dark:bg-stone-800 dark:accent-stone-100"
      />
      <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-stone-500">
        {format(value)}
      </span>
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer rounded border-stone-300 accent-stone-900 dark:border-stone-700 dark:accent-stone-100"
      />
      {label}
    </label>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase text-stone-500">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded border border-stone-300 bg-transparent p-0.5 dark:border-stone-700"
        />
      </span>
    </label>
  );
}

/**
 * A collapsible group.
 *
 * Most of these controls are adjusted rarely. Keeping them closed by default is
 * what stops the form becoming the thing it is replacing: the original's Video
 * panel shows forty controls at once, including eight API key boxes.
 */
export function Section({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** One line describing the current state, readable while collapsed. */
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <section className="border-b border-stone-200 pb-5 last:border-0 dark:border-stone-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-baseline justify-between gap-3 py-1 text-left"
      >
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex items-baseline gap-2">
          {summary && !open && (
            <span className="text-xs text-stone-500">{summary}</span>
          )}
          <span
            aria-hidden
            className={`text-xs text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
          >
            ›
          </span>
        </span>
      </button>
      {open && (
        <div id={id} className="flex flex-col gap-4 pt-4">
          {children}
        </div>
      )}
    </section>
  );
}
