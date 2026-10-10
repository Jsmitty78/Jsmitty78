export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function checkedFetch(token: string, path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!response.ok) {
    let message = `通信に失敗しました（${response.status}）`;
    try {
      const body = await response.json();
      message = typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : message;
    } catch { /* The status remains useful when a proxy returns a non-JSON response. */ }
    throw new ApiError(response.status, response.status === 401 ? "アクセストークンを確認してください。" : message);
  }
  return response;
}

export async function read<T>(token: string, path: string, signal?: AbortSignal): Promise<T> {
  return (await checkedFetch(token, path, { signal })).json();
}

export async function write<T = unknown>(token: string, path: string, body: unknown = {}): Promise<T> {
  return (await checkedFetch(token, path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  })).json();
}

export async function readImage(token: string, taskId: string, assetId: string, signal?: AbortSignal): Promise<Blob> {
  return (await checkedFetch(token, `/tasks/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(assetId)}`, { signal })).blob();
}

export async function uploadObservation(token: string, taskId: string, targetId: string, file: File): Promise<unknown> {
  if (file.size > 20 * 1024 * 1024) throw new Error("画像は20MB以下にしてください。");
  const body = new FormData();
  body.set("metadata", JSON.stringify({ id: crypto.randomUUID(), targetId, capturedAt: new Date().toISOString(), source: "file", synthetic: false }));
  body.set("image", file);
  return (await checkedFetch(token, taskPath(taskId, "/observations"), {
    method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body,
  })).json();
}

export function taskPath(taskId: string, route = ""): string {
  return `/tasks/${encodeURIComponent(taskId)}${route}`;
}
