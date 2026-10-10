import { tr, useLocale, LanguageSwitch } from "./locale.js";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { PackageIntent } from "@sprink/core";
import { api, ApiError, session, type Summary } from "./api.js";
import { dateTime } from "./format.js";
import { Badge, Button, Callout, Field, Icon, Spinner } from "./ui.js";
import { Workbench } from "./Workbench.js";
import { SprinkLogo } from "./logo.js";
import { Inspections } from "./inspections/Inspections.js";
import "./workbench.css";
import { AskPanel } from "./ask/AskPanel.js";

const PROJECT_KEY = "sprink.project";
const readProject = () => { try { return localStorage.getItem(PROJECT_KEY) || "sprink-demo"; } catch { return "sprink-demo"; } };

function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(() => {
    if (location.pathname === "/legacy" || location.pathname.startsWith("/legacy/")) {
      history.replaceState(null, "", "/inspections");
    }
    return location.pathname;
  });
  useEffect(() => { const on = () => setPath(location.pathname); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);
  return [path, (to: string) => { history.pushState(null, "", to); setPath(to); scrollTo(0, 0); }];
}

function TopBar({ right, crumbs, onHome, onInspections, onRules, rules = false, inspections = false }: { right?: ReactNode; crumbs?: ReactNode; onHome: () => void; onInspections: () => void; onRules: () => void; rules?: boolean; inspections?: boolean }) {
  return <header className="fa-top">
    <button type="button" className="fa-brand" onClick={onHome} aria-label={tr("Sprink home")}><SprinkLogo /></button>
    <nav className="fa-navigation" aria-label={tr("Workflows")}>
      <Button variant="quiet" aria-current={!inspections && !rules ? "page" : undefined} onClick={onHome}>{tr("Work packages")}</Button>
      <Button variant="quiet" aria-current={inspections ? "page" : undefined} onClick={onInspections}>{tr("Field inspections")}</Button>
      <Button variant="quiet" aria-current={rules ? "page" : undefined} onClick={onRules}>{tr("Rule search")}</Button>
    </nav>
    {crumbs && <nav className="fa-crumbs" aria-label={tr("Breadcrumb")}>{crumbs}</nav>}
    <div className="fa-top-right"><LanguageSwitch />{right}</div>
  </header>;
}

export function WorkbenchApp() {
  const locale = useLocale();
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const [token, setToken] = useState(session.token);
  const [path, go] = usePath();
  const signOut = useCallback(() => { session.clear(); setToken(""); }, []);
  const home = () => go("/");
  const inspections = () => go("/inspections");
  const rules = () => go("/codes");
  if (!token) return <Connect onConnect={t => { session.setToken(t); setToken(t); }} />;
  if (path === "/codes") return <div className="fa-app"><TopBar onHome={home} onInspections={inspections} onRules={rules} rules right={<Button variant="quiet" onClick={signOut}>{tr("Disconnect")}</Button>} /><main className="wf-codes fa-rules-page"><AskPanel embedded onClose={home} onAuthFailure={signOut} /></main></div>;
  if (path === "/inspections") return <div className="fa-app"><TopBar onHome={home} onInspections={inspections} onRules={rules} inspections right={<Button variant="quiet" onClick={signOut}>{tr("Disconnect")}</Button>} />
    <Inspections token={token} onAuthFailure={signOut} />
  </div>;
  const match = /^\/p\/([^/]+)/.exec(path);
  if (match) return <div className="fa-app"><Workbench key={match[1]} id={decodeURIComponent(match[1])} onHome={home} onAuthFailure={signOut}
    onOpen={id => go(`/p/${encodeURIComponent(id)}`)} /></div>;
  return <div className="fa-app"><TopBar onHome={home} onInspections={inspections} onRules={rules} right={<Button variant="quiet" onClick={signOut}>{tr("Disconnect")}</Button>} /><Home open={id => go(`/p/${encodeURIComponent(id)}`)} onAuthFailure={signOut} /></div>;
}

function Connect({ onConnect }: { onConnect: (token: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError("");
    session.setToken(value.trim());
    try { await api.list(readProject()); onConnect(value.trim()); }
    catch (e) { session.clear(); setError(e instanceof ApiError && e.status === 401 ? "That access token was not accepted." : e instanceof Error ? e.message : "Could not reach the server."); }
    finally { setBusy(false); }
  };
  return <div className="fa-app fa-connect">
    <form className="fa-connect-card" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <LanguageSwitch /><span className="fa-connect-logo"><SprinkLogo height={40} /></span>
      <h1 className="sr-only">{tr("Sprink")}</h1>
      <p className="fa-muted">{tr("Materials, cuts and site changes for sprinkler fitters, from one source-linked work package.")}</p>
      <Field label={tr("Server access token")} hint={tr("Kept in this browser tab only. Ask whoever runs the server; it is in .data/access-token.")}>
        <input type="password" autoComplete="off" autoFocus value={value} onChange={e => setValue(e.target.value)} required />
      </Field>
      {error && <Callout tone="red" title={error} />}
      <Button variant="primary" type="submit" busy={busy} disabled={!value.trim()}>{tr("Connect")}</Button>
    </form>
  </div>;
}

function Home({ open, onAuthFailure }: { open: (id: string) => void; onAuthFailure: () => void }) {
  const [project, setProject] = useState(readProject);
  const [items, setItems] = useState<Summary[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<PackageIntent | "">("");
  const [titles, setTitles] = useState<Record<PackageIntent, string>>({ prepare_from_drawing: "", adapt_to_site: "" });

  // Only the newest request may update the list, so a slow answer for an earlier project cannot replace it.
  const serial = useRef(0);
  const load = useCallback(async () => {
    const n = ++serial.current;
    setError("");
    try { const list = await api.list(project); if (n === serial.current) setItems(list); }
    catch (e) { if (n !== serial.current) return; if (e instanceof ApiError && e.status === 401) onAuthFailure(); setError(e instanceof Error ? e.message : "Could not load packages"); setItems([]); }
  }, [project, onAuthFailure]);
  useEffect(() => { try { localStorage.setItem(PROJECT_KEY, project); } catch { /* ignore */ } const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [project, load]);

  const create = async (intent: PackageIntent) => {
    setBusy(intent); setError("");
    try {
      const title = titles[intent].trim() || (intent === "adapt_to_site" ? "Site change" : "Drawing preparation");
      const s = await api.create(project, intent, title);
      open(s.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the package"); } finally { setBusy(""); }
  };
  const validProject = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(project);

  return <main className="fa-home">
    <div className="fa-home-head">
      <div><h1>{tr("Work packages")}</h1><p className="fa-muted">{tr("Each package keeps the drawing, your confirmed inputs, the generated results and what you selected, per revision.")}</p></div>
      <Field label={tr("Project")}><input className="mono" value={project} onChange={e => setProject(e.target.value.trim())} aria-invalid={!validProject} /></Field>
    </div>
    <div className="fa-entry">
      {([["prepare_from_drawing", "Prepare from a drawing", "Upload the sheet, confirm scale and dimensions, and get materials, cut list and assembly steps. No site change needed.", "drawing"],
        ["adapt_to_site", "Adapt to site conditions", "Record what blocks the run on site, measure it, compare generated routes, choose one, and get the revised package with its change.", "alert"]] as const).map(([intent, title, text, icon]) =>
        <form key={intent} className="fa-entry-card" onSubmit={e => { e.preventDefault(); void create(intent); }}>
          <span className="fa-entry-icon"><Icon name={icon} size={22} /></span>
          <h2>{tr(title)}</h2><p>{tr(text)}</p>
          <div className="fa-fact-edit"><input placeholder={tr("Name, e.g. Branch L-2")} value={titles[intent]} onChange={e => setTitles({ ...titles, [intent]: e.target.value })} aria-label={`${title} name`} maxLength={120} />
            <Button variant="primary" type="submit" busy={busy === intent} disabled={!!busy || !validProject}>{tr("Start")}</Button></div>
        </form>)}
    </div>
    {error && <Callout tone="red" title={error} />}
    <h2 className="fa-h2">{tr("Recent in")}{" "}<span className="mono">{project}</span></h2>
    {items === null ? <Spinner label={tr("Loading…")} /> : items.length === 0 ? <p className="fa-muted">{tr("No work packages in this project yet.")}</p> :
      <ul className="fa-pkglist">{[...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(p => <li key={p.id}>
        <button type="button" onClick={() => open(p.id)}>
          <span className="fa-entry-icon small"><Icon name={p.intent === "adapt_to_site" ? "alert" : "drawing"} size={16} /></span>
          <span><strong>{p.title}</strong><small>{p.intent === "adapt_to_site" ? tr("Adapt to site") : tr("Prepare from drawing")}{" "}{tr("· rev")}{" "}{p.inputRevision} · {dateTime(p.updatedAt)}</small></span>
          {p.run && <Badge tone={p.run.status === "completed" ? "green" : p.run.status === "running" ? "blue" : p.run.status === "waiting_input" ? "amber" : "neutral"}>{p.run.status.replace("_", " ")}</Badge>}
        </button>
      </li>)}</ul>}
  </main>;
}
