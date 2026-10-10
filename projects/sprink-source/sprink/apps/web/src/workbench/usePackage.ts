import { useCallback, useEffect, useRef, useState } from "react";
import { pollAfterSettled } from "./poll.js";
import { api, ApiError, type Detail, type Snapshot } from "./api.js";

export interface PackageState {
  snapshot: Snapshot | null;
  detail: Detail | null;
  loading: boolean;
  /** Label of the action in flight, for the button that started it. */
  busy: string;
  error: string;
  notice: string;
  reload: () => Promise<void>;
  /** Run a server action; the snapshot it returns (or a fresh read) replaces the local copy. */
  act: (label: string, fn: (s: Snapshot) => Promise<unknown>) => Promise<boolean>;
  setNotice: (text: string) => void;
  clearError: () => void;
}

/** Loads one work package, polls while a run is in progress, and keeps the fabrication detail in step. */
export function usePackage(id: string, onAuthFailure: () => void): PackageState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const latest = useRef<Snapshot | null>(null);
  const serial = useRef(0);

  const fail = useCallback((e: unknown) => {
    if (e instanceof DOMException && e.name === "AbortError") return;
    if (e instanceof ApiError && e.status === 401) onAuthFailure();
    setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
  }, [onAuthFailure]);

  const load = useCallback(async () => {
    const n = ++serial.current;
    const s = await api.get(id);
    if (n !== serial.current) return;
    latest.current = s; setSnapshot(s);
    const d = await api.detail(id).catch(() => null);
    if (n === serial.current) setDetail(d);
  }, [id]);

  const reload = useCallback(async () => {
    try { await load(); setError(""); } catch (e) { fail(e); } finally { setLoading(false); }
  }, [load, fail]);

  useEffect(() => { setLoading(true); setSnapshot(null); setDetail(null); void reload(); }, [reload]);

  const running = snapshot?.run?.status === "running";
  useEffect(() => {
    if (!running) return;
    return pollAfterSettled(() => load().catch(fail), 900);
  }, [running, load, fail]);

  const act = useCallback(async (label: string, fn: (s: Snapshot) => Promise<unknown>) => {
    const s = latest.current;
    if (!s) return false;
    setBusy(label); setError(""); setNotice("");
    try {
      await fn(s);
      await load();
      return true;
    } catch (e) {
      fail(e);
      if (e instanceof ApiError && e.status === 409) await load().catch(() => undefined);
      return false;
    } finally { setBusy(""); }
  }, [load, fail]);

  return { snapshot, detail, loading, busy, error, notice, reload, act, setNotice, clearError: () => setError("") };
}
