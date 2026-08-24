import type { ScrapeJobStatus, XAccountStatus } from "../api/types";

// "cancelled" is a display-only status: the API reports a stopped run as `failed` with a known
// message (see lib/scrape-status.ts), because the database enum can't be extended from the app.
export type PillStatus = ScrapeJobStatus | XAccountStatus | "cancelled";

const STYLES: Record<PillStatus, string> = {
  active: "bg-status-success-bg text-status-success",
  completed: "bg-status-success-bg text-status-success",
  running: "bg-status-info-bg text-status-info",
  queued: "bg-status-neutral-bg text-status-neutral",
  cancelled: "bg-status-neutral-bg text-status-neutral",
  paused: "bg-status-warning-bg text-status-warning",
  checkpointed: "bg-status-warning-bg text-status-warning",
  failed: "bg-status-danger-bg text-status-danger",
  banned: "bg-status-danger-bg text-status-danger",
};

const DOT_STYLES: Record<PillStatus, string> = {
  active: "bg-emerald-500",
  completed: "bg-emerald-500",
  running: "bg-blue-500 animate-pulse-dot",
  queued: "bg-zinc-400",
  cancelled: "bg-zinc-400",
  paused: "bg-amber-500",
  checkpointed: "bg-amber-500",
  failed: "bg-red-500",
  banned: "bg-red-500",
};

export function StatusPill({ status }: { status: PillStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tracking-wider uppercase border border-current/10 ${STYLES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_STYLES[status] || "bg-current"}`} />
      <span>{status}</span>
    </span>
  );
}
