import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { deleteLeadList, evaluateLeadList, listLeadLists } from "../api/leadLists";
import type { LeadList } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { SkeletonCards } from "../components/Skeleton";
import { summarizeFilter } from "../lib/format";

const COUNT_PAGE_SIZE = 200;

export function LeadLists() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<LeadList | null>(null);

  const listsQuery = useQuery({ queryKey: ["leadLists"], queryFn: listLeadLists });
  const leadLists = listsQuery.data?.leadLists ?? [];

  const countQueries = useQueries({
    queries: leadLists.map((list) => ({
      queryKey: ["leadLists", list.id, "count"],
      queryFn: () => evaluateLeadList(list.id, 1, COUNT_PAGE_SIZE),
      enabled: leadLists.length > 0,
    })),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLeadList,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leadLists"] });
      setDeleting(null);
    },
  });

  if (listsQuery.isLoading) {
    return <SkeletonCards count={3} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Lead Lists</h1>
        <Link
          to="/lead-lists/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Create Lead List
        </Link>
      </div>

      {leadLists.length === 0 ? (
        <EmptyState
          title="No saved filters yet"
          description="Create a lead list to save a reusable filter over your scraped leads."
          action={
            <Link
              to="/lead-lists/new"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Create Lead List
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {leadLists.map((list, i) => {
            const countResult = countQueries[i];
            const count = countResult?.data?.leads.length;
            const countLabel =
              count === undefined ? "…" : count >= COUNT_PAGE_SIZE ? `${count}+` : String(count);

            return (
              <div
                key={list.id}
                onClick={() => navigate(`/lead-lists/${list.id}`)}
                className="flex cursor-pointer flex-col gap-3 rounded-lg border p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              >
                <div className="flex items-start justify-between">
                  <h2 className="text-sm font-semibold">{list.name}</h2>
                  <span className="font-mono text-xs text-zinc-500">{countLabel} leads</span>
                </div>
                <p className="text-xs text-zinc-500">{summarizeFilter(list.filterDefinition)}</p>
                <div className="mt-auto flex gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
                  <Link
                    to={`/lead-lists/${list.id}/edit`}
                    className="flex-1 rounded-md border px-2 py-1.5 text-center text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDeleting(list)}
                    className="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium text-status-danger hover:bg-status-danger-bg"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete lead list?"
          message={`This permanently deletes "${deleting.name}". Leads themselves aren't affected.`}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
