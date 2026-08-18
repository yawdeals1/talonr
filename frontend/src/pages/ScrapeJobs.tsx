import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { listAccounts } from "../api/accounts";
import { deleteScrape, listScrapes } from "../api/scrapes";
import type { ScrapeJob, ScrapeJobStatus } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRows } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { formatNumber, formatRelative } from "../lib/format";

const STATUS_OPTIONS: ScrapeJobStatus[] = ["queued", "running", "completed", "failed", "paused"];

export function ScrapeJobs() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ScrapeJobStatus | "">("");
  const [xAccountId, setXAccountId] = useState("");
  const [deleting, setDeleting] = useState<ScrapeJob | null>(null);

  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });
  const scrapesQuery = useQuery({
    queryKey: ["scrapes", { status, xAccountId }],
    queryFn: () => listScrapes({ status: status || undefined, xAccountId: xAccountId || undefined }),
    refetchInterval: (query) => {
      const jobs = query.state.data?.scrapeJobs ?? [];
      return jobs.some((j) => j.status === "queued" || j.status === "running") ? 5000 : false;
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
                  <td className="px-3 py-2 capitalize">{job.sourceType}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 font-mono text-xs" title={job.sourceRef}>
                    {job.sourceRef}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {accountById.get(job.xAccountId)?.handle ? `@${accountById.get(job.xAccountId)!.handle}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={job.status} />
                  </td>
                  <td className="px-3 py-2 font-mono">{formatNumber(job.leadsFound)}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {job.startedAt ? formatRelative(job.startedAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {job.finishedAt ? formatRelative(job.finishedAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}>
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

      {deleting && (
        <ConfirmDialog
          title="Delete scrape?"
          message="This permanently removes the scrape record. Leads already collected by it will remain saved."
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
