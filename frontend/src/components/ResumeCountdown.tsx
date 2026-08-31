import { useEffect, useState } from "react";

/**
 * A live countdown to the moment a rate-limited scrape can run again.
 *
 * What this replaces: an ISO timestamp printed into the job's error message —
 * "rests until 2026-08-31T14:23:11.000Z" — which is unreadable at a glance, in the wrong timezone,
 * and stale the moment it is written. The moment itself now travels as data on the job
 * (`resumeAt`), and this ticks down to it and says when it has passed, so "when can I carry on?"
 * has an answer that stays true while you are looking at it.
 */
export function ResumeCountdown({ until, className = "" }: { until: string; className?: string }) {
  const target = new Date(until).getTime();
  const [remainingMs, setRemainingMs] = useState(() => target - Date.now());

  useEffect(() => {
    // Re-read the clock rather than decrementing a counter: a tab that was backgrounded, or a
    // machine that slept, would otherwise come back showing a countdown minutes behind reality.
    const tick = () => setRemainingMs(new Date(until).getTime() - Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [until]);

  if (!Number.isFinite(target)) return null;

  if (remainingMs <= 0) {
    return (
      <span className={`font-mono ${className}`}>
        ready now
      </span>
    );
  }

  return (
    <span className={`font-mono tabular-nums ${className}`} title={new Date(until).toLocaleString()}>
      {formatRemaining(remainingMs)}
    </span>
  );
}

/** Whether a resume time is still in the future — the only case one means anything. */
export function isFuture(iso: string | null | undefined): iso is string {
  return !!iso && new Date(iso).getTime() > Date.now();
}

/**
 * Seconds are shown only under an hour, where they are the difference between "nearly there" and
 * "go and do something else"; above that they are noise on a number that is an estimate anyway.
 */
function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
