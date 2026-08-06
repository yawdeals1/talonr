import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { getAccount } from "../api/accounts";
import { ApiError } from "../api/client";
import { cancelScrape, getScrape } from "../api/scrapes";
import { StatusPill } from "../components/StatusPill";
import { formatDateTime, formatNumber } from "../lib/format";

export function ScrapeJobDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ["scrapes", id],
    queryFn: () => getScrape(id!),
    refetchInterval: (query) => {
      const status = query.state.data?.scrapeJob.status;
      return status === "queued" || status === "running" ? 5000 : false;
    },
  });

  const job = jobQuery.data?.scrapeJob;

  const accountQuery = useQuery({
    queryKey: ["accounts", job?.xAccountId],
    queryFn: () => getAccount(job!.xAccountId),
    enabled: !!job,
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelScrape(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
    },
  });

  if (jobQuery.isLoading) {
    return <div className="text-sm text-zinc-500">Loading…</div>;
  }

  if (!job) {
    return <div className="text-sm text-zinc-500">Scrape job not found.</div>;
  }

  const account = accountQuery.data?.account;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link to="/scrapes" className="text-xs font-medium text-accent-text hover:underline">
          ← All scrapes
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-lg font-semibold break-all text-zinc-900 dark:text-zinc-100">
            {job.sourceRef}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            <span className="capitalize">{job.sourceType}</span> ·{" "}
            {account ? `@${account.handle}` : "…"}
          </p>
        </div>
        <StatusPill status={job.status} />
      </div>

      {(job.status === "failed" || job.status === "paused") && job.errorMessage && (
        <div className="rounded-md border border-status-danger-bg bg-status-danger-bg p-3 text-sm text-status-danger">
          {job.errorMessage}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500">Leads found</dt>
          <dd className="font-mono text-base">{formatNumber(job.leadsFound)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Created</dt>
          <dd className="font-mono text-xs">{formatDateTime(job.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Started</dt>
          <dd className="font-mono text-xs">{job.startedAt ? formatDateTime(job.startedAt) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Finished</dt>
          <dd className="font-mono text-xs">{job.finishedAt ? formatDateTime(job.finishedAt) : "—"}</dd>
        </div>
      </dl>

      {job.status === "queued" && (
        <div>
          <button
            type="button"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="rounded-md border border-status-danger-bg px-4 py-2 text-sm font-medium text-status-danger hover:bg-status-danger-bg disabled:opacity-50"
          >
            {cancelMutation.isPending ? "Cancelling…" : "Cancel scrape"}
          </button>
          {cancelMutation.error instanceof ApiError && (
            <p className="mt-2 text-sm text-status-danger">{cancelMutation.error.message}</p>
          )}
        </div>
      )}

      {job.status === "running" && (
        <p className="text-xs text-zinc-500">
          This job is already running and can't be hard-cancelled — it will finish or fail on its own.
        </p>
      )}
    </div>
  );
}
