export class ExecutionStop extends Error {}

/** Stops awaiting even if an injected service ignores abort. Such results are never committed. */
export async function bounded<T>(parent: AbortSignal, timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => { controller.abort(); reject(new ExecutionStop('cancelled')); };
    parent.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new ExecutionStop('request_timeout; outcome unknown, no automatic retry')); }, timeoutMs);
  });
  try {
    if (parent.aborted) throw new ExecutionStop('cancelled');
    return await Promise.race([Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    }), aborted]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onAbort);
  }
}
