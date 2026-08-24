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

  function exportLeadsToCsv(leadsToExport: Lead[]) {
    const headers = ["Handle", "Name", "Bio", "Followers", "Location", "Verified", "SourceType", "SourceRef", "LastSeenAt"];
    const rows = leadsToExport.map((l) => [
      `"${l.handle}"`,
      `"${(l.displayName || "").replace(/"/g, '""')}"`,
      `"${(l.bio || "").replace(/"/g, '""')}"`,
      l.followers ?? "",
      `"${(l.location || "").replace(/"/g, '""')}"`,
      l.verified ? "true" : "false",
      l.sourceType,
      `"${(l.sourceRef || "").replace(/"/g, '""')}"`,
      l.lastSeenAt,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `talonr_leads_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Leads Database
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Search, filter, export, and triage scraped X profiles across all jobs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={leads.length === 0}
            onClick={() => exportLeadsToCsv(leads)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 font-mono text-xs font-semibold text-zinc-700 shadow-xs hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span>Export Page CSV</span>
          </button>
        </div>
      </div>

      {/* Quick Search & Source Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              setPage(1);
            }}
            placeholder="Search by handle (e.g. founder)…"
            className="w-full rounded-md border bg-white pl-9 pr-3 py-2 font-mono text-xs text-zinc-900 outline-none focus:border-amber-600 dark:bg-zinc-950 dark:text-zinc-100 dark:border-zinc-800"
          />
        </div>
        <select
          value={sourceType}
          onChange={(e) => {
            setSourceType(e.target.value as SourceType | "");
            setPage(1);
          }}
          className="rounded-md border bg-white px-3 py-2 font-mono text-xs text-zinc-900 outline-none focus:border-amber-600 dark:bg-zinc-950 dark:text-zinc-100 dark:border-zinc-800"
        >
          <option value="" className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
            All Sources
          </option>
          {SOURCE_TYPES.map((s) => (
            <option key={s} value={s} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              {s.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* Filter Parameters Form */}
      <form onSubmit={applyRangeFilters} className="rounded-lg border bg-zinc-50/50 p-4 space-y-3 dark:bg-zinc-900/40 dark:border-zinc-800">
        <div className="flex items-center justify-between border-b pb-2 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Profile Criteria Filters
            </h2>
            {Object.keys(appliedRange).length > 0 && (
              <span className="rounded bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                ACTIVE
              </span>
            )}
          </div>
          {Object.keys(appliedRange).length > 0 && (
            <button
              type="button"
              onClick={clearRangeFilters}
              className="font-mono text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label
              htmlFor={`${idPrefix}-min-followers`}
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Min Followers
            </label>
            <input
              id={`${idPrefix}-min-followers`}
              type="number"
              min={0}
              step={1}
              value={minFollowers}
              onChange={(event) => setMinFollowers(event.target.value)}
              placeholder="0"
              className="w-full rounded-md border bg-white px-3 py-1.5 font-mono text-xs outline-none focus:border-amber-600 dark:bg-zinc-950 dark:border-zinc-800"
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-max-followers`}
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Max Followers
            </label>
            <input
              id={`${idPrefix}-max-followers`}
              type="number"
              min={0}
              step={1}
              value={maxFollowers}
              onChange={(event) => setMaxFollowers(event.target.value)}
              placeholder="No maximum"
              className="w-full rounded-md border bg-white px-3 py-1.5 font-mono text-xs outline-none focus:border-amber-600 dark:bg-zinc-950 dark:border-zinc-800"
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-location`}
              className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Location Match
            </label>
            <input
              id={`${idPrefix}-location`}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              maxLength={200}
              placeholder="e.g. California"
              className="w-full rounded-md border bg-white px-3 py-1.5 text-xs outline-none focus:border-amber-600 dark:bg-zinc-950 dark:border-zinc-800"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              Apply Filter Query
            </button>
          </div>
        </div>
        {rangeError && <p className="text-xs text-red-500">{rangeError}</p>}
      </form>

      {/* Selected Action Floating Bar */}
      {selectedLeadIds.size > 0 && (
        <div className="sticky top-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-600/30 bg-zinc-900 p-3.5 text-white shadow-xl dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 font-mono text-xs font-bold text-zinc-950">
              {selectedLeadIds.size}
            </span>
            <span className="font-mono text-xs font-semibold">
              {selectedLeadIds.size} lead{selectedLeadIds.size === 1 ? "" : "s"} selected
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const selectedLeads = leads.filter((l) => selectedLeadIds.has(l.id));
                exportLeadsToCsv(selectedLeads);
              }}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 font-mono text-xs font-medium text-zinc-200 hover:bg-zinc-700"
            >
              Export Selected CSV
            </button>
            <button
              type="button"
              onClick={() => setShowCreateList(true)}
              className="rounded bg-accent px-3 py-1.5 font-mono text-xs font-semibold text-white hover:opacity-90"
            >
              Save to Lead List
            </button>
            <button
              type="button"
              onClick={() => setConfirmBulkDelete(true)}
              className="rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 font-mono text-xs font-medium text-red-400 hover:bg-red-500/20"
            >
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {query.isLoading ? (
        <SkeletonRows rows={8} cols={7} />
      ) : noLeadsAtAll ? (
        <EmptyState
          title="No leads stored yet"
          description="Trigger a scrape to start collecting leads."
          action={
            <Link
              to="/scrapes/new"
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Trigger Scrape
            </Link>
          }
        />
      ) : leads.length === 0 ? (
        <EmptyState title="No leads match these filters" />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span className="font-mono">
              Showing {leads.length} of {formatNumber(total)} total matching leads
            </span>
          </div>

          <LeadsTable
            leads={leads}
            onRowClick={setSelected}
            onDelete={setDeleting}
            selectedLeadIds={selectedLeadIds}
            onSelectionChange={setLeadSelected}
            onSelectAll={selectAllVisible}
          />

          <div className="flex items-center justify-between font-mono text-xs text-zinc-500">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-zinc-200 bg-white px-3 py-1 font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              >
                ← Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-zinc-200 bg-white px-3 py-1 font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && <LeadDetailDrawer lead={selected} onClose={() => setSelected(null)} onDelete={setDeleting} />}

      {showCreateList && (
        <Modal title="Create lead list" onClose={() => setShowCreateList(false)}>
          <form onSubmit={submitCreateList} className="space-y-4">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Create a static list from the {selectedLeadIds.size} selected lead{selectedLeadIds.size === 1 ? "" : "s"}.
            </p>
            <div>
              <label htmlFor={`${idPrefix}-list-name`} className="mb-1 block text-xs font-semibold uppercase text-zinc-700 dark:text-zinc-300">
                List name
              </label>
              <input
                id={`${idPrefix}-list-name`}
                autoFocus
                required
                maxLength={100}
                value={listName}
                onChange={(event) => setListName(event.target.value)}
                placeholder="e.g. High Priority SaaS Leads"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-xs outline-none focus:border-amber-600 dark:border-zinc-800"
              />
            </div>
            {createListMutation.error instanceof ApiError && (
              <p className="text-xs text-red-500">{createListMutation.error.message}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateList(false)}
                className="rounded-md border px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!listName.trim() || createListMutation.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
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
        <p className="text-xs text-red-500">{bulkDeleteMutation.error.message}</p>
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
