import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { getAccount } from "../api/accounts";
import { ApiError } from "../api/client";
import { listLeads } from "../api/leads";
import { cancelScrape, deleteScrape, getScrape } from "../api/scrapes";
import type { Lead } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { LeadDetailDrawer } from "../components/LeadDetailDrawer";
import { LeadsTable } from "../components/LeadsTable";
import { SkeletonRows } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { formatDateTime, formatNumber } from "../lib/format";

const LEADS_PAGE_SIZE = 50;

export function ScrapeJobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [leadsPage, setLeadsPage] = useState(1);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  // Leads aren't stored per-job (upsertLeads keys rows by handle and overwrites source_type/
  // source_ref on every re-scrape), so this shows leads currently on file matching this job's
  // target rather than only the ones this exact run produced — the closest available
  // approximation without a scrape_job_id column on `leads`.
  const leadsQuery = useQuery({
    queryKey: ["leads", "byJob", job?.sourceType, job?.sourceRef, leadsPage],
    queryFn: () =>
      listLeads({ sourceType: job!.sourceType, sourceRef: job!.sourceRef, page: leadsPage, pageSize: LEADS_PAGE_SIZE }),
    enabled: !!job,
  });
  const leads = leadsQuery.data?.leads ?? [];

  const cancelMutation = useMutation({
    mutationFn: () => cancelScrape(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteScrape(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
      navigate("/scrapes");
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
    <div className="max-w-4xl space-y-6">
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

      {job.status !== "running" && (
        <div>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="rounded-md border px-4 py-2 text-sm font-medium text-status-danger hover:bg-status-danger-bg"
          >
            Delete scrape
          </button>
          {deleteMutation.error instanceof ApiError && (
            <p className="mt-2 text-sm text-status-danger">{deleteMutation.error.message}</p>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Leads</h2>
          <p className="text-xs text-zinc-500">
            Leads currently on file for this {job.sourceType === "followers" ? "account" : "target"} — if it's been
            scraped again since this job ran, that later data shows here too.
          </p>
        </div>

        {leadsQuery.isLoading ? (
          <SkeletonRows rows={5} cols={7} />
        ) : leads.length === 0 ? (
          <EmptyState title="No leads on file for this target yet" />
        ) : (
          <>
            <LeadsTable leads={leads} onRowClick={setSelectedLead} />
            <div className="flex items-center justify-between text-sm text-zinc-500">
              <span>Page {leadsPage}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={leadsPage === 1}
                  onClick={() => setLeadsPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={leads.length < LEADS_PAGE_SIZE}
                  onClick={() => setLeadsPage((p) => p + 1)}
                  className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {selectedLead && <LeadDetailDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete scrape?"
          message="This permanently removes the scrape record. Leads already collected by it will remain saved."
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
