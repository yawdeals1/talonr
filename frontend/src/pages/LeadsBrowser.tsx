import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
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

const PAGE_SIZE = 50;
// "likers" stays filterable for leads scraped before X locked down likes visibility in June 2024.
const SOURCE_TYPES: SourceType[] = ["search", "followers", "likers", "engagers"];

export function LeadsBrowser() {
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState("");
  const [sourceType, setSourceType] = useState<SourceType | "">("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState<Lead | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(() => new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showCreateList, setShowCreateList] = useState(false);
  const [listName, setListName] = useState("");
  const idPrefix = useId();

  const query = useQuery({
    queryKey: ["leads", { handle, sourceType, page }],
    queryFn: () => listLeads({ handle: handle || undefined, sourceType: sourceType || undefined, page, pageSize: PAGE_SIZE }),
  });

  const leads = query.data?.leads ?? [];
  const hasFilters = handle || sourceType;
  const noLeadsAtAll = !query.isLoading && leads.length === 0 && page === 1 && !hasFilters;

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
                : "Select leads on this page or continue selecting across pages"}
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
            <span>Page {page}</span>
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
                disabled={leads.length < PAGE_SIZE}
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
