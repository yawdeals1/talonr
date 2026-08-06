import type { ScrapeJobStatus, XAccountStatus } from "../api/types";

export type PillStatus = ScrapeJobStatus | XAccountStatus;

const STYLES: Record<PillStatus, string> = {
  active: "bg-status-success-bg text-status-success",
  completed: "bg-status-success-bg text-status-success",
  running: "bg-status-info-bg text-status-info",
  queued: "bg-status-neutral-bg text-status-neutral",
  paused: "bg-status-warning-bg text-status-warning",
  checkpointed: "bg-status-warning-bg text-status-warning",
  failed: "bg-status-danger-bg text-status-danger",
  banned: "bg-status-danger-bg text-status-danger",
};

export function StatusPill({ status }: { status: PillStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide uppercase ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
