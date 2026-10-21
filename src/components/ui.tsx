import React, { useEffect, useId, useRef, useState } from "react";
import { fmt, parseNumeric } from "../lib/units";
import type { Severity } from "../types";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = "",
  dense,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  dense?: boolean;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-header">
          <div className="min-w-0">
            {title && <h2 className="panel-title truncate">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={`${dense ? "" : "p-3"} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
  className = "",
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={`block ${className}`}>
      <span className="field-label flex items-center justify-between gap-2">
        <span>{label}</span>
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[10.5px] leading-relaxed text-slate-500">{hint}</span>}
    </label>
  );
}

export function NumberField({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  precision = 3,
  suffix,
  disabled,
  className = "",
  id,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  suffix?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(() => fmt(value, precision));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(fmt(value, precision));
  }, [value, precision, editing]);

  const commit = (raw: string) => {
    const parsed = parseNumeric(raw);
    if (parsed === null) {
      setText(fmt(value, precision));
      return;
    }
    const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed));
    onChange(clamped);
    setText(fmt(clamped, precision));
  };

  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        aria-label={ariaLabel}
        className={`input mono ${suffix ? "pr-9" : ""}`}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        step={step}
        onChange={(event) => {
          setEditing(true);
          setText(event.target.value);
          const parsed = parseNumeric(event.target.value);
          if (parsed !== null) {
            const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed));
            onChange(clamped);
          }
        }}
        onFocus={() => setEditing(true)}
        onBlur={(event) => {
          setEditing(false);
          commit(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const delta = (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? step * 10 : step);
            const next = Math.min(
              max ?? Number.POSITIVE_INFINITY,
              Math.max(min ?? Number.NEGATIVE_INFINITY, (parseNumeric(text) ?? value) + delta),
            );
            onChange(next);
            setText(fmt(next, precision));
          }
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-500">{suffix}</span>
      )}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
  mono,
  id,
  className = "",
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  id?: string;
  className?: string;
  maxLength?: number;
}) {
  return (
    <input
      id={id}
      className={`input ${mono ? "mono" : ""} ${className}`}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
  disabled,
  id,
  className = "",
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  disabled?: boolean;
  id?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        id={id}
        aria-label={ariaLabel}
        className="input appearance-none pr-7"
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const found = options.find((option) => String(option.value) === event.target.value);
          if (found) onChange(found.value);
        }}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)} disabled={option.disabled} className="bg-ink-900">
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden
      >
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  title,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "md" | "xs";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
}) {
  const variantClass =
    variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : variant === "danger" ? "btn-danger" : "";
  return (
    <button
      type={type}
      className={`btn ${variantClass} ${size === "xs" ? "btn-xs" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-[12px] text-slate-300">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[10.5px] leading-relaxed text-slate-500">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-4 w-8 shrink-0 rounded-full border transition ${
          checked ? "border-cyan-400/50 bg-cyan-500/40" : "border-white/10 bg-ink-700"
        } ${disabled ? "opacity-40" : ""}`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${
            checked ? "left-[18px] bg-cyan-200" : "left-0.5 bg-slate-400"
          }`}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className = "",
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: React.ReactNode; title?: string }>;
  className?: string;
  size?: "md" | "sm";
}) {
  return (
    <div className={`inline-flex rounded-md border border-white/10 bg-ink-950/60 p-0.5 ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`rounded px-2 ${size === "sm" ? "py-0.5 text-[10.5px]" : "py-1 text-[11.5px]"} font-medium transition ${
            value === option.value ? "bg-cyan-500/20 text-cyan-200" : "text-slate-500 hover:text-slate-300"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const SEVERITY_STYLES: Record<Severity, string> = {
  error: "border-signal-red/40 bg-signal-red/10 text-signal-red",
  warning: "border-signal-amber/40 bg-signal-amber/10 text-signal-amber",
  info: "border-signal-blue/30 bg-signal-blue/10 text-signal-blue",
};

export function SeverityBadge({ severity, count }: { severity: Severity; count?: number }) {
  const icon = severity === "error" ? "!" : severity === "warning" ? "△" : "i";
  return (
    <span className={`chip ${SEVERITY_STYLES[severity]}`}>
      <span className="text-[9px]">{icon}</span>
      {count !== undefined ? count : severity}
    </span>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "error" | "idle" }) {
  const color =
    tone === "ok" ? "bg-signal-green" : tone === "warn" ? "bg-signal-amber" : tone === "error" ? "bg-signal-red" : "bg-slate-600";
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}

export function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-white/[0.05] bg-ink-950/40 px-2 py-1.5 text-[10.5px] leading-relaxed text-slate-500">
      {children}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-white/10 px-3 py-6 text-center">
      <p className="text-[12px] font-medium text-slate-400">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-[260px] text-[11px] leading-relaxed text-slate-500">{children}</p>}
    </div>
  );
}

export function CopyButton({
  text,
  label = "Copy",
  disabled,
  onCopied,
}: {
  text: string;
  label?: string;
  disabled?: boolean;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API may be blocked in sandboxed frames — fall back to a hidden textarea.
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    onCopied?.();
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Button size="xs" onClick={copy} disabled={disabled || !text} title={`Copy ${label.toLowerCase()}`}>
      <svg viewBox="0 0 14 14" className="h-3 w-3" fill="none" aria-hidden>
        <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M9.5 4.5V3.2A1.2 1.2 0 0 0 8.3 2H3.2A1.2 1.2 0 0 0 2 3.2v5.1a1.2 1.2 0 0 0 1.2 1.2h1.3" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      {copied ? "Copied" : label}
    </Button>
  );
}

export function Splitter({
  direction,
  onDelta,
  onCommit,
}: {
  direction: "horizontal" | "vertical";
  onDelta: (deltaPx: number) => void;
  onCommit?: () => void;
}) {
  const dragging = useRef(false);
  const last = useRef(0);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      const current = direction === "horizontal" ? event.clientX : event.clientY;
      onDelta(current - last.current);
      last.current = current;
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      onCommit?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [direction, onDelta, onCommit]);

  return (
    <div
      role="separator"
      aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
      onPointerDown={(event) => {
        dragging.current = true;
        last.current = direction === "horizontal" ? event.clientX : event.clientY;
        document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      }}
      className={`group relative shrink-0 ${
        direction === "horizontal" ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"
      }`}
    >
      <div
        className={`absolute bg-white/[0.04] transition group-hover:bg-cyan-400/40 ${
          direction === "horizontal" ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2"
        }`}
      />
    </div>
  );
}
