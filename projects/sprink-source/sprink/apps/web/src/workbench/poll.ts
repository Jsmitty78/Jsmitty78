/** Wait after each response, so slow reads never overlap or invalidate one another. */
export function pollAfterSettled(load: () => Promise<unknown>, delay: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try { await load(); }
    finally { if (!stopped) timer = setTimeout(poll, delay); }
  };
  timer = setTimeout(poll, delay);
  return () => { stopped = true; clearTimeout(timer); };
}
