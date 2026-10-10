import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Cloudflare Turnstile ("Verify you are human"). The site key comes from the API at runtime
 * (GET /site/config), so no rebuild is needed to switch it on; when the server has no key the
 * widget renders nothing and forms work as before. Tokens are single-use: call reset() after
 * every submit attempt.
 */
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoad: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoad ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile unavailable")));
    s.onerror = () => {
      scriptLoad = null;
      reject(new Error("Turnstile script failed to load"));
    };
    document.head.appendChild(s);
  });
  return scriptLoad;
}

export function useTurnstileSiteKey() {
  const q = useQuery({
    queryKey: ["site-config"],
    queryFn: () => api.public<{ turnstileSiteKey: string | null }>("GET", "/site/config"),
    staleTime: Infinity,
    retry: 1,
  });
  return { siteKey: q.data?.turnstileSiteKey ?? null, loading: q.isLoading };
}

export type TurnstileHandle = { reset: () => void };

export const Turnstile = forwardRef<TurnstileHandle, { action: string; onToken: (token: string | null) => void; className?: string }>(function Turnstile(
  { action, onToken, className },
  ref,
) {
  const { siteKey } = useTurnstileSiteKey();
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenCb = useRef(onToken);
  tokenCb.current = onToken;
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    reset: () => {
      tokenCb.current(null);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !container.current) return;
        widgetId.current = ts.render(container.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          callback: (token: string) => tokenCb.current(token),
          "expired-callback": () => tokenCb.current(null),
          "error-callback": () => tokenCb.current(null),
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  if (!siteKey) return null;
  return (
    <div className={className}>
      <div ref={container} className="flex min-h-[65px] justify-center" />
      {failed && <p className="mt-1 text-center text-xs text-bad-600">The security check couldn't load. Disable content blockers for this site and reload.</p>}
    </div>
  );
});
