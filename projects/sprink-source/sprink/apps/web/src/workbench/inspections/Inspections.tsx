import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Callout, Field, Icon, Spinner } from "../ui.js";
import { Empty } from "./ui.js";
import { ApiError, read, taskPath, write } from "./api.js";
import { TaskDetail } from "./TaskDetail.js";
import type { Action, TaskSnapshot, TaskSummary } from "./types.js";
import { dateTime, label } from "./ui.js";
import "./inspections.css";

export function Inspections({ token, onAuthFailure }: { token: string; onAuthFailure: () => void }) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState(false);
  const [notice, setNotice] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [planOrientation, setPlanOrientation] = useState("pendent");
  const [drawingPreset, setDrawingPreset] = useState("reference");
  const selected = useRef<string | null>(null);
  const currentToken = useRef(token);
  const requestSerial = useRef(0);
  const performing = useRef(false);
  const currentBusy = useRef(false);

  function selectTask(id: string) {
    selected.current = id; setSelectedId(id); setTask(null); setError("");
  }
  const refresh = useCallback(async () => {
    if (!token) return;
    const serial = ++requestSerial.current;
    const items = await read<TaskSummary[]>(token, "/tasks");
    if (currentToken.current !== token || serial !== requestSerial.current) return;
    setTasks(items); setAuthError(false);
    const target = selected.current ?? items[0]?.id;
    if (!target) { setTask(null); return; }
    if (!selected.current) { selected.current = target; setSelectedId(target); }
    const snapshot = await read<TaskSnapshot>(token, taskPath(target));
    if (currentToken.current !== token || serial !== requestSerial.current || selected.current !== target) return;
    setTask(snapshot);
  }, [token]);

  const showError = useCallback((failure: unknown) => {
    setError(failure instanceof Error ? failure.message : "操作に失敗しました。もう一度お試しください。");
    setAuthError(failure instanceof ApiError && failure.status === 401);
    if (failure instanceof ApiError && failure.status === 401) onAuthFailure();
  }, [onAuthFailure]);

  useEffect(() => {
    if (!token) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    const poll = async () => {
      try { if (!currentBusy.current) await refresh(); }
      catch (failure) { if (!closed) showError(failure); }
      finally {
        if (!closed) { setLoading(false); timer = setTimeout(() => void poll(), 3500); }
      }
    };
    void poll();
    return () => { closed = true; clearTimeout(timer); requestSerial.current++; };
  }, [token, selectedId, refresh, showError]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const action: Action = async (name, work, after) => {
    if (performing.current) return false;
    performing.current = true; currentBusy.current = true; setBusy(name); setError(""); setNotice("");
    requestSerial.current++;
    try {
      await work();
      await refresh();
      after?.();
      setNotice(`${name}：完了しました。`);
      return true;
    } catch (failure) { showError(failure); return false; }
    finally { performing.current = false; currentBusy.current = false; setBusy(""); }
  };

  async function createTask() {
    await action("仕事を作成", async () => {
      const created = await write<TaskSnapshot>(token, "/tasks", { ...(newTitle.trim() ? { title: newTitle.trim() } : {}), planOrientation, reference: drawingPreset === "reference" });
      selected.current = created.id; setSelectedId(created.id); setTask(created);
    }, () => { setNewTitle(""); setCreateOpen(false); });
  }

  return <main className="inspection-workspace">
    <aside className="inspection-list">
      <div className="inspection-list-heading"><h2>Field inspections</h2><Button aria-label="New inspection" onClick={() => setCreateOpen(v => !v)} disabled={!!busy}><Icon name="plus" /></Button></div>
      {createOpen && <div className="inspection-panel"><form onSubmit={event => { event.preventDefault(); void createTask(); }}>
        <Field label="仕事の名前"><input id="inspection-title" value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus /></Field>
        <Field label="元図"><select value={drawingPreset} onChange={e => setDrawingPreset(e.target.value)}><option value="reference">実図面 FS-01 中二階</option><option value="sample">操作練習用サンプル</option></select></Field>
        <Field label="サンプルの指定方向"><select id="inspection-orientation" value={planOrientation} onChange={e => setPlanOrientation(e.target.value)}>{["pendent", "upright", "sideways"].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></Field>
        <Button type="submit" variant="primary" busy={busy === "仕事を作成"} disabled={!!busy}>作成</Button>
      </form></div>}
      <nav aria-label="現場確認の仕事一覧">{tasks.map(item => <Button key={item.id} variant="quiet" className={item.id === selectedId ? "is-selected" : ""} aria-current={item.id === selectedId ? "page" : undefined} onClick={() => selectTask(item.id)} disabled={!!busy}>
        <strong>{item.title}</strong><small>{label(item.state)} · {dateTime(item.updatedAt)}</small>
      </Button>)}</nav>
    </aside>
    <div className="inspection-content">
      <div className="inspection-toolbar"><span>現場の観測・確認・資料</span><Button variant="quiet" busy={loading} disabled={!!busy} onClick={() => { setError(""); void refresh().catch(showError); }}>更新</Button></div>
      {error && <Callout tone="red" title="操作を確認してください">{error}{authError && <Button onClick={onAuthFailure}>接続し直す</Button>}</Callout>}
      {notice && <div role="status"><Callout tone="blue" title={notice} /></div>}
      {busy && <div className="inspection-progress" role="status"><span className="fa-spinner" aria-hidden="true" />{busy}</div>}
      {task ? <TaskDetail key={task.id} task={task} token={token} action={action} busy={busy} /> : loading || (selectedId && !error) ? <Spinner label="仕事を読み込み中" /> :
        <div className="inspection-welcome"><Empty title="現場確認を始める">写真・確認済みの観測・追加依頼をまとめ、図面比較と製品条件を確認します。</Empty><Button variant="primary" onClick={() => setCreateOpen(true)} disabled={!!busy}>新しい現場確認</Button></div>}
    </div>
  </main>;
}
