import { useEffect, useRef } from "react";
import { TURNSTILE_SITE_KEY } from "../lib/config";

// index.html loads the Turnstile script async/defer, so it may not be ready yet when this
// component first mounts — window.turnstile appears once it finishes.
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  onToken: (token: string | null) => void;
  /** Bump this to force the widget to reset (e.g. after a failed submit — tokens are single-use). */
  resetKey: number;
}

export function TurnstileWidget({ onToken, resetKey }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | undefined;

    function render() {
      if (cancelled || !container || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        action: "turnstile-spin-v2",
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    }

    if (window.turnstile) {
      render();
    } else {
      pollId = setInterval(() => {
        if (window.turnstile) {
          clearInterval(pollId);
          render();
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onToken is a stable setter, not a dep
  }, []);

  useEffect(() => {
    if (resetKey > 0 && widgetIdRef.current) {
      onToken(null);
      window.turnstile?.reset(widgetIdRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to resetKey changing
  }, [resetKey]);

  return <div ref={containerRef} className="cf-turnstile" data-action="turnstile-spin-v2" />;
}
