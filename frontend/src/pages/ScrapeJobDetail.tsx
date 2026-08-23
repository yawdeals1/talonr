import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { getAccount } from "../api/accounts";
import { ApiError } from "../api/client";
import { createLeadList } from "../api/leadLists";
import { bulkDeleteLeads } from "../api/leads";
import {
  cancelScrape,
  deleteScrape,
  finishScrape,
  getScrape,
  listScrapeLeads,
  updateScrapeResultFilter,
} from "../api/scrapes";
import type { Lead, ScrapeResultFilter } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { LeadDetailDrawer } from "../components/LeadDetailDrawer";
import { LeadsTable } from "../components/LeadsTable";
import { Modal } from "../components/Modal";
import { ScrapeProgressPanel } from "../components/ScrapeProgressPanel";
import { SkeletonRows } from "../components/Skeleton";
import { StatusPill } from "../components/StatusPill";
import { formatDateTime, formatNumber } from "../lib/format";
import { isCancellableScrape, isCancelledScrape, scrapeDisplayStatus } from "../lib/scrape-status";

const LEADS_PAGE_SIZE = 50;

export function ScrapeJobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [leadsPage, setLeadsPage] = useState(1);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showCreateList, setShowCreateList] = useState(false);
  const [listName, setListName] = useState("");
  const [minFollowers, setMinFollowers] = useState("");
  const [maxFollowers, setMaxFollowers] = useState("");
  const [location, setLocation] = useState("");
  const [initializedFilterJobId, setInitializedFilterJobId] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const idPrefix = useId();

  const jobQuery = useQuery({
    queryKey: ["scrapes", id],
    queryFn: () => getScrape(id!),
    refetchInterval: (query) => {
      const status = query.state.data?.scrapeJob.status;
      return status === "queued" || status === "running" ? 3000 : false;
    },
  });

  const job = jobQuery.data?.scrapeJob;

  useEffect(() => {
    if (!job || initializedFilterJobId === job.id) return;
    setMinFollowers(job.resultFilterDefinition.minFollowers?.toString() ?? "");
    setMaxFollowers(job.resultFilterDefinition.maxFollowers?.toString() ?? "");
    setLocation(job.resultFilterDefinition.location ?? "");
    setInitializedFilterJobId(job.id);
  }, [initializedFilterJobId, job]);

  const accountQuery = useQuery({
    queryKey: ["accounts", job?.xAccountId],
    queryFn: () => getAccount(job!.xAccountId),
    enabled: !!job,
  });

  const leadsQuery = useQuery({
    queryKey: ["scrapes", id, "leads", job?.status, job?.resultFilterDefinition, leadsPage],
    queryFn: () => listScrapeLeads(id!, leadsPage, LEADS_PAGE_SIZE),
    enabled: !!job,
    refetchInterval: job?.status === "queued" || job?.status === "running" ? 5000 : false,
    // Keep the rows already on screen while the next poll is in flight, so a live-updating list
    // doesn't flash empty every few seconds.
    placeholderData: (previous) => previous,
  });
  const leads = leadsQuery.data?.leads ?? [];
  const hasLeadFilters = Object.keys(job?.resultFilterDefinition ?? {}).length > 0;
  const exactMembershipAvailable = leadsQuery.data?.exactMembershipAvailable ?? job?.tracksExactLeads ?? false;
  const matchedLeadCount = leadsQuery.data?.total ?? 0;

  const filterMutation = useMutation({
    mutationFn: (filter: ScrapeResultFilter) => updateScrapeResultFilter(id!, filter),
    onSuccess: ({ scrapeJob }) => {
      queryClient.setQueryData(["scrapes", id], { scrapeJob });
      queryClient.invalidateQueries({ queryKey: ["scrapes", id, "leads"] });
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
      setLeadsPage(1);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => bulkDeleteLeads([...selectedLeadIds]),
    onSuccess: () => {
      setSelectedLeadIds(new Set());
      setConfirmBulkDelete(false);
      setSelectedLead(null);
      queryClient.invalidateQueries({ queryKey: ["scrapes", id, "leads"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["leadLists"] });
    },
  });

  const createListMutation = useMutation({
    mutationFn: () => createLeadList(listName.trim(), { leadIds: [...selectedLeadIds] }),
    onSuccess: () => {
      setShowCreateList(false);
      setListName("");
      setSelectedLeadIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["leadLists"] });
    },
  });

  function applyLeadFilters(event: FormEvent) {
    event.preventDefault();
    setFilterError(null);

    const min = minFollowers === "" ? undefined : Number(minFollowers);
    const max = maxFollowers === "" ? undefined : Number(maxFollowers);
    if (min !== undefined && (!Number.isSafeInteger(min) || min < 0)) {
      setFilterError("Minimum followers must be a non-negative whole number.");
      return;
    }
    if (max !== undefined && (!Number.isSafeInteger(max) || max < 0)) {
      setFilterError("Maximum followers must be a non-negative whole number.");
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      setFilterError("Maximum followers must be greater than or equal to minimum followers.");
      return;
    }

    const locationFilter = location.trim();
    const nextFilters: ScrapeResultFilter = {
      ...(min !== undefined ? { minFollowers: min } : {}),
      ...(max !== undefined ? { maxFollowers: max } : {}),
      ...(locationFilter ? { location: locationFilter } : {}),
    };
    filterMutation.mutate(nextFilters);
  }

  function clearLeadFilters() {
    setMinFollowers("");
    setMaxFollowers("");
    setLocation("");
    setFilterError(null);
    filterMutation.mutate({});
  }

  function setLeadSelected(leadId: string, selected: boolean) {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      if (selected) next.add(leadId);
      else next.delete(leadId);
      return next;
    });
  }

  function selectAllVisible(selected: boolean) {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      for (const lead of leads) {
        if (selected) next.add(lead.id);
        else next.delete(lead.id);
      }
      return next;
    });
  }

  const cancelMutation = useMutation({
    mutationFn: () => cancelScrape(id!),
    onSuccess: ({ scrapeJob }) => {
      setConfirmCancel(false);
      queryClient.setQueryData(["scrapes", id], { scrapeJob });
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
    },
  });

  const finishMutation = useMutation({
    mutationFn: () => finishScrape(id!),
    onSuccess: ({ scrapeJob }) => {
      queryClient.setQueryData(["scrapes", id], { scrapeJob });
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
        <StatusPill status={scrapeDisplayStatus(job)} />
      </div>

      {(job.status === "failed" || job.status === "paused") && job.errorMessage && !isCancelledScrape(job) && (
        <div className="rounded-md border border-status-danger-bg bg-status-danger-bg p-3 text-sm text-status-danger">
          {job.errorMessage}
        </div>
      )}

      {/* A completed job carrying a message stopped short of what it was asked for — it ran out of
          its time budget rather than out of accounts. That is not a failure, so it reads as a note
          rather than an error. */}
      {job.status === "completed" && job.errorMessage && (
        <div className="rounded-md border border-status-warning-bg bg-status-warning-bg p-3 text-sm text-status-warning">
          {job.errorMessage}
        </div>
      )}

      <ScrapeProgressPanel job={job} />

      <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm sm:grid-cols-4">
        <div>
          {/* A filtered run checks more profiles than it needs so it can find a full cap of
              matching accounts, and saves every one it checked — so "found" and "matching" are
              two different numbers whenever a filter is set. */}
          <dt className="text-xs text-zinc-500">{hasLeadFilters ? "Matching / checked" : "Leads found"}</dt>
          <dd className="font-mono text-base">
            {hasLeadFilters
              ? `${formatNumber(matchedLeadCount)} / ${formatNumber(job.leadsFound)}`
              : formatNumber(job.leadsFound)}
          </dd>
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

      {isCancellableScrape(job) && (
        <div>
          <button
            type="button"
            onClick={() => (job.status === "running" ? setConfirmCancel(true) : cancelMutation.mutate())}
            disabled={cancelMutation.isPending}
            className="rounded-md border border-status-danger-bg px-4 py-2 text-sm font-medium text-status-danger hover:bg-status-danger-bg disabled:opacity-50"
          >
            {cancelMutation.isPending ? "Stopping…" : job.status === "running" ? "Stop scrape" : "Cancel scrape"}
          </button>
          {job.status === "running" && (
            <button
              type="button"
              onClick={() => finishMutation.mutate()}
              disabled={finishMutation.isPending || finishMutation.isSuccess}
              className="ml-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800"
            >
              {finishMutation.isSuccess ? "Finishing…" : finishMutation.isPending ? "Asking…" : "Finish now"}
            </button>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            {job.status === "running"
              ? "Stopping ends the run at its next checkpoint — within about ten seconds — and keeps every lead it has already collected. Finishing does the same but lets the scrape complete normally instead of being marked cancelled."
              : "This scrape hasn't started yet, so it will be taken off the queue."}
          </p>
          {finishMutation.isSuccess && (
            <p className="mt-2 text-xs text-zinc-500">
              Asked to wrap up — the run stops looking at its next checkpoint and completes with what it found.
            </p>
          )}
          {[cancelMutation.error, finishMutation.error].map((error, index) =>
            error instanceof ApiError ? (
              <p key={index} className="mt-2 text-sm text-status-danger">
                {error.message}
              </p>
            ) : null
          )}
        </div>
      )}

      {isCancelledScrape(job) && (
        <p className="text-xs text-zinc-500">
          Cancelled. Any leads collected before it stopped were saved and are listed below.
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
            Only leads collected by this exact scrape are shown here. Re-running the same target creates separate membership.
          </p>
        </div>

        {!exactMembershipAvailable && (
          <div className="rounded-md border border-status-warning-bg bg-status-warning-bg p-3 text-sm text-status-warning">
            This scrape predates exact lead tracking. Run a new scrape to get an exact, selectable result set.
          </div>
        )}

        <form onSubmit={applyLeadFilters} className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Filter collected leads</h3>
              <p className="text-xs text-zinc-500">All fields are optional. Filters do not remove saved leads.</p>
            </div>
            {hasLeadFilters && (
              <button
                type="button"
                onClick={clearLeadFilters}
                disabled={job.status === "queued" || job.status === "running"}
                className="text-xs font-medium text-accent-text hover:underline disabled:opacity-40"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`${idPrefix}-min-followers`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Min followers
              </label>
              <input
                id={`${idPrefix}-min-followers`}
                type="number"
                min={0}
                step={1}
                value={minFollowers}
                onChange={(event) => setMinFollowers(event.target.value)}
                placeholder="No minimum"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-max-followers`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Max followers
              </label>
              <input
                id={`${idPrefix}-max-followers`}
                type="number"
                min={0}
                step={1}
                value={maxFollowers}
                onChange={(event) => setMaxFollowers(event.target.value)}
                placeholder="No maximum"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-location`} className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Country or location
              </label>
              <input
                id={`${idPrefix}-location`}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                maxLength={200}
                placeholder="e.g. Ghana or Accra"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              Leads with unknown follower counts are excluded when a follower bound is set.
            </p>
            <button
              type="submit"
              disabled={
                filterMutation.isPending ||
                !exactMembershipAvailable ||
                job.status === "queued" ||
                job.status === "running"
              }
              className="shrink-0 rounded-md bg-accent px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {filterMutation.isPending ? "Applying…" : "Apply filters"}
            </button>
          </div>
          {filterError && <p className="mt-2 text-xs text-status-danger">{filterError}</p>}
          {filterMutation.error instanceof ApiError && (
            <p className="mt-2 text-xs text-status-danger">{filterMutation.error.message}</p>
          )}
        </form>

        {leadsQuery.isLoading ? (
          <SkeletonRows rows={5} cols={7} />
        ) : !exactMembershipAvailable ? (
          <></>
        ) : leads.length === 0 ? (
          <EmptyState title={hasLeadFilters ? "No leads from this scrape match these filters" : "No leads collected by this scrape yet"} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
              <span className="text-sm text-zinc-500">
                {selectedLeadIds.size > 0
                  ? `${selectedLeadIds.size} selected`
                  : `${formatNumber(matchedLeadCount)} matching lead${matchedLeadCount === 1 ? "" : "s"}`}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={selectedLeadIds.size === 0}
                  onClick={() => setShowCreateList(true)}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
                >
                  Create lead list
                </button>
                <button
                  type="button"
                  disabled={selectedLeadIds.size === 0}
                  onClick={() => setConfirmBulkDelete(true)}
                  className="rounded-md border border-status-danger-bg px-3 py-1.5 text-xs font-medium text-status-danger hover:bg-status-danger-bg disabled:opacity-40"
                >
                  Delete selected
                </button>
              </div>
            </div>
            <LeadsTable
              leads={leads}
              onRowClick={setSelectedLead}
              selectedLeadIds={selectedLeadIds}
              onSelectionChange={setLeadSelected}
              onSelectAll={selectAllVisible}
            />
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
                  disabled={leadsPage * LEADS_PAGE_SIZE >= matchedLeadCount}
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

      {showCreateList && (
        <Modal title="Create lead list" onClose={() => setShowCreateList(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (listName.trim()) createListMutation.mutate();
            }}
            className="space-y-4"
          >
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Create a static list from the {selectedLeadIds.size} selected lead{selectedLeadIds.size === 1 ? "" : "s"}.
            </p>
            <div>
              <label htmlFor={`${idPrefix}-list-name`} className="mb-1 block text-sm font-medium">
                List name
              </label>
              <input
                id={`${idPrefix}-list-name`}
                autoFocus
                required
                maxLength={100}
                value={listName}
                onChange={(event) => setListName(event.target.value)}
                placeholder="e.g. Qualified Ghana leads"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            {createListMutation.error instanceof ApiError && (
              <p className="text-sm text-status-danger">{createListMutation.error.message}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateList(false)}
                className="rounded-md border px-3 py-1.5 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!listName.trim() || createListMutation.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {createListMutation.isPending ? "Creating…" : "Create list"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          title={`Delete ${selectedLeadIds.size} selected leads?`}
          message="This permanently deletes the selected leads from your saved leads, every scrape result, and every lead list."
          confirmLabel={bulkDeleteMutation.isPending ? "Deleting…" : "Delete selected"}
          onConfirm={() => bulkDeleteMutation.mutate()}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Stop this scrape?"
          message="The run stops at its next checkpoint, within about ten seconds, and keeps every lead it has already collected. It won't resume — trigger a new scrape to pick up where this one left off."
          confirmLabel={cancelMutation.isPending ? "Stopping…" : "Stop scrape"}
          onConfirm={() => cancelMutation.mutate()}
          onCancel={() => setConfirmCancel(false)}
        />
      )}

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
