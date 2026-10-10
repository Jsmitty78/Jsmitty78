import { tr } from "./locale.js";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { lengthText, type Quantity } from "./format.js";

const PATHS: Record<string, ReactNode> = {
  building: <><path d="M4 21V5l8-3 8 3v16" /><path d="M9 21v-5h6v5M8 8h2M14 8h2M8 12h2M14 12h2" /></>,
  select: <path d="M5 3l14 8-6 2-2 6z" />,
  pan: <><path d="M12 3v18M3 12h18" /><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  drawing: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  home: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
  download: <><path d="M12 4v11M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 20h14" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v6H4V6h6" /></>,
  ask: <><circle cx="11" cy="11" r="7" /><path d="M20.5 20.5l-4.5-4.5" /><path d="M9.2 9.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4" /><path d="M11 14.6v.2" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  attach: <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1L13 4.3a3.4 3.4 0 0 1 4.8 4.8l-7.9 7.9a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3" />,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>,
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return <svg className="fa-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>;
}

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "sample";
export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`fa-badge-pill tone-${tone}`} title={title}>{children}</span>;
}

export function Button({ variant = "default", busy, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "quiet" | "danger"; busy?: boolean }) {
  return <button type="button" {...rest} disabled={rest.disabled || busy} aria-busy={busy || undefined} className={`fa-btn fa-btn-${variant} ${className}`}>
    {busy && <span className="fa-spinner" aria-hidden="true" />}{children}
  </button>;
}

export function Spinner({ label }: { label: string }) {
  return <div className="fa-loading" role="status"><span className="fa-spinner" aria-hidden="true" />{label}</div>;
}

export function Callout({ tone = "amber", title, children, action }: { tone?: "amber" | "red" | "blue" | "neutral"; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <div className={`fa-callout-box tone-${tone}`} role={tone === "red" ? "alert" : undefined}>
    <Icon name={tone === "blue" ? "check" : "alert"} size={16} />
    <div><strong>{title}</strong>{children && <div className="fa-callout-body">{children}</div>}</div>
    {action && <div className="fa-callout-action">{action}</div>}
  </div>;
}

export function Section({ title, count, children, defaultOpen = true, aside }: { title: ReactNode; count?: ReactNode; children: ReactNode; defaultOpen?: boolean; aside?: ReactNode }) {
  return <details className="fa-section" open={defaultOpen}>
    <summary><span className="fa-section-title">{title}{count !== undefined && <span className="fa-count">{count}</span>}</span>{aside}<Icon name="chevron" size={16} /></summary>
    <div className="fa-section-body">{children}</div>
  </details>;
}

/** A server length: ft-in with mm under it, or "Unknown" with the server's reason. Never 0 for unknown. */
export function Length({ q, signed }: { q: Quantity | null | undefined; signed?: boolean }) {
  const t = lengthText(q, signed);
  return t.known
    ? <span className="fa-len"><span className="mono">{t.primary}</span><small>{t.secondary}</small></span>
    : <span className="fa-len is-unknown" title={t.reason}><span>{tr("Unknown")}</span><small>{t.reason}</small></span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <label className="fa-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
