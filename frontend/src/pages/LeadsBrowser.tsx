import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError } from "../api/client";
import { createLeadList } from "../api/leadLists";
import { bulkDeleteLeads, deleteLead, listLeads } from "../api/leads";
import type { Lead, SourceType } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { LeadDetailDrawer } from "../components/LeadDetailDrawer";
import { LeadsTable } from "../components/LeadsTable";
import { Modal } from "../components/Modal";
import { SkeletonRows } from "../components/Skeleton";
import { formatNumber } from "../lib/format";

const PAGE_SIZE = 50;
// "likers" is deliberately not offered. The Studio DB's legacy enum stores "engagers" rows *as*
// "likers" (see src/db/source-type-compat.ts), and the API normalises them back to "engagers" on
// read — so a "likers" option queried the identical rows as "engagers" and could only ever render
// them labelled "engagers". Pre-2024 likers leads are reachable under "engagers".
const SOURCE_TYPES: SourceType[] = ["search", "followers", "engagers"];

interface FollowerRangeFilters {
  minFollowers?: number;
  maxFollowers?: number;
  location?: string;
}

export function LeadsBrowser() {
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState("");
  const [sourceType, setSourceType] = useState<SourceType | "">("");
  const [minFollowers, setMinFollowers] = useState("");
  const [maxFollowers, setMaxFollowers] = useState("");
  const [location, setLocation] = useState("");
  // Applied separately from the inputs so typing "1000" doesn't refetch at 1, 10, and 100.
  const [appliedRange, setAppliedRange] = useState<FollowerRangeFilters>({});
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState<Lead | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showCreateList, setShowCreateList] = useState(false);
  const [listName, setListName] = useState("");
  const idPrefix = useId();

  const query = useQuery({
    queryKey: ["leads", { handle, sourceType, appliedRange, page }],
    queryFn: () =>
      listLeads({
        handle: handle || undefined,
        sourceType: sourceType || undefined,
        ...appliedRange,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const leads = query.data?.leads ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(handle || sourceType || Object.keys(appliedRange).length > 0);
  const noLeadsAtAll = !query.isLoading && total === 0 && page === 1 && !hasFilters;

  // Deleting enough leads (or tightening a filter) can strand the user past the last page, which
  // renders as a misleading "no leads match these filters".
  useEffect(() => {
    if (!query.isSuccess) return;
    if (page > totalPages) setPage(totalPages);
  }, [page, query.isSuccess, totalPages]);

  function applyRangeFilters(event: FormEvent) {
    event.preventDefault();
    setRangeError(null);

    const min = minFollowers === "" ? undefined : Number(minFollowers);
    const max = maxFollowers === "" ? undefined : Number(maxFollowers);
    if (min !== undefined && (!Number.isSafeInteger(min) || min < 0)) {
      setRangeError("Minimum followers must be a non-negative whole number.");
      return;
    }
    if (max !== undefined && (!Number.isSafeInteger(max) || max < 0)) {
      setRangeError("Maximum followers must be a non-negative whole number.");
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      setRangeError("Maximum followers must be greater than or equal to minimum followers.");
      return;
    }

    const trimmedLocation = location.trim();
    setAppliedRange({
      ...(min !== undefined ? { minFollowers: min } : {}),
      ...(max !== undefined ? { maxFollowers: max } : {}),
      ...(trimmedLocation ? { location: trimmedLocation } : {}),
    });
    setPage(1);
  }

  function clearRangeFilters() {
    setMinFollowers("");
    setMaxFollowers("");
    setLocation("");
    setRangeError(null);
    setAppliedRange({});
    setPage(1);
  }

  const deleteMutation = useMutation({
    mutationFn: deleteLead,
    onSuccess: (_data, deletedLeadId) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
      queryClient.invalidateQueries({ queryKey: ["leadLists"] });
      setSelectedLeadIds((current) => {
        const next = new Set(current);
        next.delete(deletedLeadId);
        return next;
      });
      setSelected(null);
      setDeleting(null);
      if (leads.length === 1 && page > 1) setPage((current) => current - 1);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => bulkDeleteLeads([...selectedLeadIds]),
    onSuccess: () => {
      const selectedVisibleCount = leads.filter((lead) => selectedLeadIds.has(lead.id)).length;
      setSelectedLeadIds(new Set());
      setConfirmBulkDelete(false);
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["scrapes"] });
      queryClient.invalidateQueries({ queryKey: ["leadLists"] });
      if (selectedVisibleCount === leads.length && page > 1) setPage((current) => current - 1);
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

  function setLeadSelected(leadId: string, isSelected: boolean) {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      if (isSelected) next.add(leadId);
      else next.delete(leadId);
      return next;
    });
  }

  function selectAllVisible(isSelected: boolean) {
    setSelectedLeadIds((current) => {
      const next = new Set(current);
      for (const lead of leads) {
        if (isSelected) next.add(lead.id);
        else next.delete(lead.id);
      }
      return next;
    });
  }

  function submitCreateList(event: FormEvent) {
    event.preventDefault();
    if (listName.trim()) createListMutation.mutate();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Leads</h1>

      <div className="flex flex-wrap gap-3">
        <input
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            setPage(1);
          }}
          placeholder="Search by handle…"
          className="w-64 rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select
          value={sourceType}
          onChange={(e) => {
            setSourceType(e.target.value as SourceType | "");
            setPage(1);
          }}
          className="rounded-md border bg-transparent px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-accent dark:text-zinc-100"
        >
          <option value="" className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
            All sources
          </option>
          {SOURCE_TYPES.map((s) => (
            <option key={s} value={s} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              {s}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={applyRangeFilters} className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Follower range and location</h2>
            <p className="text-xs text-zinc-500">
              Leads with no follower count on file are excluded once a follower bound is set.
            </p>
          </div>
          {Object.keys(appliedRange).length > 0 && (
            <button
              type="button"
              onClick={clearRangeFilters}
              className="shrink-0 text-xs font-medium text-accent-text hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label
              htmlFor={`${idPrefix}-min-followers`}
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
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
            <label
              htmlFor={`${idPrefix}-max-followers`}
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
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
            <label
              htmlFor={`${idPrefix}-location`}
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
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
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-accent px-4 py-2 text-xs font-medium text-white hover:opacity-90"
            >
              Apply
            </button>
          </div>
        </div>
        {rangeError && <p className="mt-2 text-xs text-status-danger">{rangeError}</p>}
      </form>

      {query.isLoading ? (
        <SkeletonRows rows={8} cols={7} />
      ) : noLeadsAtAll ? (
        <EmptyState
          title="No leads yet"
          description="Trigger a scrape to start collecting leads."
          action={
            <Link
              to="/scrapes/new"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Trigger Scrape
            </Link>
          }
        />
      ) : leads.length === 0 ? (
        <EmptyState title="No leads match these filters" />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
            <span className="text-sm text-zinc-500">
              {selectedLeadIds.size > 0
                ? `${selectedLeadIds.size} selected`
                : `${formatNumber(total)} matching lead${total === 1 ? "" : "s"} — select across pages to act on them`}
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
            onRowClick={setSelected}
            onDelete={setDeleting}
            selectedLeadIds={selectedLeadIds}
            onSelectionChange={setLeadSelected}
            onSelectAll={selectAllVisible}
          />
          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-40 dark:hover:bg-zinc-800"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selected && <LeadDetailDrawer lead={selected} onClose={() => setSelected(null)} onDelete={setDeleting} />}

      {showCreateList && (
        <Modal title="Create lead list" onClose={() => setShowCreateList(false)}>
          <form onSubmit={submitCreateList} className="space-y-4">
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
                placeholder="e.g. Qualified leads"
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
                {createListMutation.isPending ? "Creating..." : "Create list"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          title={`Delete ${selectedLeadIds.size} selected leads?`}
          message="This permanently deletes the selected leads from your saved leads, scrape results, and lead lists. A future scrape may collect them again."
          confirmLabel={bulkDeleteMutation.isPending ? "Deleting..." : "Delete selected"}
          onConfirm={() => bulkDeleteMutation.mutate()}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}

      {bulkDeleteMutation.error instanceof Error && (
        <p className="text-sm text-status-danger">{bulkDeleteMutation.error.message}</p>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete lead?"
          message={`This permanently removes @${deleting.handle} from your saved leads and lead lists. A future scrape may collect this account again.`}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
