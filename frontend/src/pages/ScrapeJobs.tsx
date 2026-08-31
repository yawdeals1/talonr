import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { listAccounts } from "../api/accounts";
import {
  bulkDeleteScrapes,
  cancelScrape,
  continueScrape,
  deleteScrape,
  listScrapes,
  pauseScrape,
  resumeScrape,
} from "../api/scrapes";
import type { ScrapeJob, ScrapeJobStatus } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRows } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { formatNumber, formatRelative } from "../lib/format";
import {
  isCancellableScrape,
  isContinuableScrape,
  isPausableScrape,
  isResumableScrape,
  scrapeDisplayStatus,
} from "../lib/scrape-status";

const STATUS_OPTIONS: ScrapeJobStatus[] = ["queued", "running", "completed", "failed", "paused"];

export function ScrapeJobs() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ScrapeJobStatus | "">("");
  const [xAccountId, setXAccountId] = useState("");
  const [deleting, setDeleting] = useState<ScrapeJob | null>(null);
  const [cancelling, setCancelling] = useState<ScrapeJob | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(() => new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });
  const scrapesQuery = useQuery({
    queryKey: ["scrapes", { status, xAccountId }],
    queryFn: () => listScrapes({ status: status || undefined, xAccountId: xAccountId || undefined }),
    refetchInterval: (query) => {
      const jobs = query.state.data?.scrapeJobs ?? [];
      // "paused" is included because a rate-limited job does not stay put: resuming it parks it on
      // the queue and it starts itself when X's limit lifts, which the list should show without a
      // manual refresh.
      return jobs.some((j) => j.status === "queued" || j.status === "running" || j.status === "paused")
        ? 5000
        : false;
    },
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const jobs = scrapesQuery.data?.scrapeJobs ?? [];
  const hasFilters = status || xAccountId;

  const deleteMutation = useMutation({
    mutationFn: deleteScrape,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
      setDeleting(null);
    },
  });

  // One mutation per action rather than a shared one, so a row's own button can show its own
  // pending state without every other row's greying out with it.
  const pauseMutation = useMutation({
    mutationFn: pauseScrape,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scrapes"] }),
  });

  const resumeMutation = useMutation({
    mutationFn: resumeScrape,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scrapes"] }),
  });

  const continueMutation = useMutation({
    mutationFn: continueScrape,
    // A continue produces a new run; go and watch it rather than leaving the user on a list where
    // the new row is one of many.
    onSuccess: ({ scrapeJob }) => {
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
      navigate(`/scrapes/${scrapeJob.id}`);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelScrape,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
      setCancelling(null);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => bulkDeleteScrapes([...selectedJobIds]),
    onSuccess: () => {
      setSelectedJobIds(new Set());
      setConfirmBulkDelete(false);
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
    },
  });

  const selectableJobs = jobs.filter((job) => job.status !== "running");
  const allSelectableJobsSelected =
    selectableJobs.length > 0 && selectableJobs.every((job) => selectedJobIds.has(job.id));

  function setJobSelected(jobId: string, selected: boolean) {
    setSelectedJobIds((current) => {
      const next = new Set(current);
      if (selected) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  }

  function selectAllJobs(selected: boolean) {
    setSelectedJobIds((current) => {
      const next = new Set(current);
      for (const job of selectableJobs) {
        if (selected) next.add(job.id);
        else next.delete(job.id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Scrapes</h1>
        <Link
          to="/scrapes/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Trigger Scrape
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ScrapeJobStatus | "")}
          className="rounded-md border bg-transparent px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-accent dark:text-zinc-100"
        >
          <option value="" className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
            All statuses
          </option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              {s}
            </option>
          ))}
        </select>
        <select
          value={xAccountId}
          onChange={(e) => setXAccountId(e.target.value)}
          className="rounded-md border bg-transparent px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-accent dark:text-zinc-100"
        >
          <option value="" className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
            All accounts
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              @{a.handle}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => scrapesQuery.refetch()}
          className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          Refresh
        </button>
      </div>

      {selectedJobIds.size > 0 && (
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="text-sm text-zinc-500">{selectedJobIds.size} scrapes selected</span>
          <button
            type="button"
            onClick={() => setConfirmBulkDelete(true)}
            className="rounded-md border border-status-danger-bg px-3 py-1.5 text-xs font-medium text-status-danger hover:bg-status-danger-bg"
          >
            Delete selected
          </button>
        </div>
      )}

      {scrapesQuery.isLoading ? (
        <SkeletonRows rows={6} cols={6} />
      ) : jobs.length === 0 ? (
        hasFilters ? (
          <EmptyState title="No scrapes match these filters" />
        ) : (
          <EmptyState
            title="No scrapes yet"
            description="Trigger your first scrape to start collecting leads."
            action={
              <Link
                to="/scrapes/new"
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Trigger Scrape
              </Link>
            }
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900/40">
              <tr>
                <th className="w-10 px-3 py-2 font-medium">
                  <input
                    type="checkbox"
                    aria-label="Select all deletable scrapes"
                    checked={allSelectableJobsSelected}
                    onChange={(event) => selectAllJobs(event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 accent-accent"
                  />
                </th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Leads</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Finished</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                  onClick={() => navigate(`/scrapes/${job.id}`)}
                >
                  <td className="w-10 px-3 py-2" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select scrape ${job.sourceRef}`}
                      checked={selectedJobIds.has(job.id)}
                      disabled={job.status === "running"}
                      onChange={(event) => setJobSelected(job.id, event.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300 accent-accent disabled:opacity-40"
                    />
                  </td>
                  <td className="px-3 py-2 capitalize">{job.sourceType}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 font-mono text-xs" title={job.sourceRef}>
                    {job.sourceRef}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {accountById.get(job.xAccountId)?.handle ? `@${accountById.get(job.xAccountId)!.handle}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={scrapeDisplayStatus(job)} />
                  </td>
                  <td className="px-3 py-2 font-mono">{formatNumber(job.leadsFound)}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {job.startedAt ? formatRelative(job.startedAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {job.finishedAt ? formatRelative(job.finishedAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                    {isPausableScrape(job) && (
                      <button
                        type="button"
                        onClick={() => pauseMutation.mutate(job.id)}
                        disabled={pauseMutation.isPending}
                        title="Stop this run but keep it resumable"
                        className="mr-2 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
                      >
                        Pause
                      </button>
                    )}
                    {isResumableScrape(job) && (
                      <button
                        type="button"
                        onClick={() => resumeMutation.mutate(job.id)}
                        disabled={resumeMutation.isPending}
                        title="Carry on from where this stopped, skipping what it already collected"
                        className="mr-2 rounded-md border px-2.5 py-1 text-xs font-medium text-accent-text hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
                      >
                        Resume
                      </button>
                    )}
                    {isContinuableScrape(job) && (
                      <button
                        type="button"
                        onClick={() => continueMutation.mutate(job.id)}
                        disabled={continueMutation.isPending}
                        title="Run this target again for more leads, skipping every account already collected"
                        className="mr-2 rounded-md border px-2.5 py-1 text-xs font-medium text-accent-text hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
                      >
                        Continue
                      </button>
                    )}
                    {isCancellableScrape(job) && (
                      <button
                        type="button"
                        onClick={() => setCancelling(job)}
                        title={job.status === "running" ? "Stop this run" : "Take this scrape off the queue"}
                        className="mr-2 rounded-md border px-2.5 py-1 text-xs font-medium text-status-danger hover:bg-status-danger-bg"
                      >
                        {job.status === "running" ? "Stop" : "Cancel"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleting(job)}
                      disabled={job.status === "running"}
                      title={job.status === "running" ? "A running scrape cannot be deleted" : "Delete scrape"}
                      className="rounded-md border px-2.5 py-1 text-xs font-medium text-status-danger hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cancelling && (
        <ConfirmDialog
          title={cancelling.status === "running" ? "Stop this scrape?" : "Cancel this scrape?"}
          message={
            cancelling.status === "running"
              ? "The run stops at its next checkpoint, within about ten seconds, and keeps every lead it has already collected."
              : "This scrape hasn't started yet, so it will be taken off the queue."
          }
          confirmLabel={
            cancelMutation.isPending ? "Stopping…" : cancelling.status === "running" ? "Stop scrape" : "Cancel scrape"
          }
          onConfirm={() => cancelMutation.mutate(cancelling.id)}
          onCancel={() => setCancelling(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete scrape?"
          message="This permanently removes the scrape record. Leads already collected by it will remain saved."
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          title={`Delete ${selectedJobIds.size} scrapes?`}
          message="This permanently removes the selected scrape records. Their collected leads remain saved."
          confirmLabel={bulkDeleteMutation.isPending ? "Deleting…" : "Delete selected"}
          onConfirm={() => bulkDeleteMutation.mutate()}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}

      {bulkDeleteMutation.error instanceof Error && (
        <p className="text-sm text-status-danger">{bulkDeleteMutation.error.message}</p>
      )}
    </div>
  );
}
