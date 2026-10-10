import { useSyncExternalStore } from "react";
import { messages } from "./messages.js";

export type Locale = "en" | "ja";
const STORAGE_KEY = "sprink.ui.locale";
const listeners = new Set<() => void>();
const catalog = new Map<string, readonly [string, string]>();
for (const pair of messages) {
  catalog.set(pair[0], pair);
  if (!catalog.has(pair[1])) catalog.set(pair[1], pair);
}
function readLocale(): Locale {
  try { return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "ja"; }
  catch { return "ja"; }
}
let locale: Locale = readLocale();
export const getLocale = () => locale;
export function setLocale(next: Locale) {
  locale = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep switching available when storage is blocked. */ }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLocale() { return useSyncExternalStore(subscribe, getLocale, () => "ja" as Locale); }
/** Only call at UI-copy boundaries, never on source documents or user-provided text. */
export function tr(text: string, params?: Record<string, string | number>): string {
  const translated = catalog.get(text)?.[locale === "en" ? 0 : 1] ?? text;
  return params ? translated.replace(/\{(\w+)\}/g, (match, key: string) => params[key] === undefined ? match : String(params[key])) : translated;
}
export function LanguageSwitch() {
  const current = useLocale();
  return <div className="wf-language" role="group" aria-label={tr("Language")}>
    <button type="button" lang="en" aria-label="English" aria-pressed={current === "en"} onClick={() => setLocale("en")}>EN</button>
    <button type="button" lang="ja" aria-label="日本語" aria-pressed={current === "ja"} onClick={() => setLocale("ja")}>JP</button>
  </div>;
}
