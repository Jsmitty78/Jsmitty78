import { useEffect, useState } from "react";
import { authedBlobUrl } from "./askApi.js";

/** Loads an authenticated image; revokes the object URL when it changes or unmounts. */
export function useAuthedUrl(href: string | null | undefined): { url: string | null; error: boolean } {
  const [state, setState] = useState<{ url: string | null; error: boolean }>({ url: null, error: false });
  useEffect(() => {
    if (!href) { setState({ url: null, error: false }); return; }
    let live = true, made: string | null = null;
    authedBlobUrl(href).then(u => { made = u; if (live) setState({ url: u, error: false }); else URL.revokeObjectURL(u); }).catch(() => live && setState({ url: null, error: true }));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [href]);
  return state;
}
