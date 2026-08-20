import type { ScrapeJob } from "../api/types";
import { formatNumber, formatRelative } from "../lib/format";

/**
 * What a run is doing right now.
 *
 * A scrape takes minutes and used to show nothing at all until it ended — no counts, no leads, no
 * way to tell a working run from a stuck one. The worker republishes these counters every few
 * seconds and saves each lead as it reads it, so this panel and the leads table below it both fill
 * in while the scrape is still going.
 */
export function ScrapeProgressPanel({ job }: { job: ScrapeJob }) {
  const progress = job.progress;
  const running = job.status === "running";

  if (!running && !progress) return null;

  if (!progress) {
    return (
      <div className="rounded-lg border border-status-info-bg bg-status-info-bg/40 p-4 text-sm">
        <p className="font-medium text-status-info">Starting…</p>
        <p className="mt-1 text-xs text-zinc-500">Opening the list page. Counts appear as soon as it starts reading.</p>
      </div>
    );
  }

  const { phase, collected, checked, saved, target, updatedAt } = progress;
  const pct = target && target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : null;

  return (
    <div className="rounded-lg border border-status-info-bg bg-status-info-bg/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-status-info">
          {running
            ? phase === "collecting"
              ? "Reading the list…"
              : "Checking profiles…"
            : "Last reported progress"}
        </p>
        <p className="font-mono text-xs text-zinc-500">updated {formatRelative(updatedAt)}</p>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
        <div>
          <dt className="text-xs text-zinc-500">Found on list</dt>
          <dd className="font-mono text-base">{formatNumber(collected)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Profiles checked</dt>
          <dd className="font-mono text-base">{formatNumber(checked)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">{target === null ? "Saved" : "Matching saved"}</dt>
          <dd className="font-mono text-base">
            {formatNumber(saved)}
            {target !== null && <span className="text-zinc-400"> / {formatNumber(target)}</span>}
          </dd>
        </div>
      </dl>

      {pct !== null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
