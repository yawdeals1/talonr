import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { listAccounts } from "../api/accounts";
import { ApiError } from "../api/client";
import { createScrape } from "../api/scrapes";
import type { SourceType } from "../api/types";
import { SkeletonRows } from "../components/Skeleton";

const SOURCE_TYPES: { value: SourceType; label: string; description: string; fieldLabel: string; placeholder: string }[] = [
  {
    value: "search",
    label: "Search",
    description: "Search X for tweets/profiles matching a keyword.",
    fieldLabel: "Search keyword",
    placeholder: "e.g. saas founder",
  },
  {
    value: "followers",
    label: "Followers",
    description: "Scrape the followers list of a target account.",
    fieldLabel: "Target handle (without @)",
    placeholder: "elonmusk",
  },
  {
    value: "likers",
    label: "Likers",
    description: "Scrape the likers of a specific tweet.",
    fieldLabel: "Tweet URL",
    placeholder: "https://x.com/user/status/12345",
  },
];

export function TriggerScrape() {
  const navigate = useNavigate();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });

  const [xAccountId, setXAccountId] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("search");
  const [sourceRef, setSourceRef] = useState("");
  const [capLeads, setCapLeads] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const idPrefix = useId();

  const mutation = useMutation({
    mutationFn: createScrape,
    onSuccess: ({ scrapeJob }) => navigate(`/scrapes/${scrapeJob.id}`),
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const activeAccounts = accounts.filter((a) => a.status === "active");
  const sourceMeta = SOURCE_TYPES.find((s) => s.value === sourceType)!;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!xAccountId) {
      setFormError("Select an X account to scrape with.");
      return;
    }
    if (!sourceRef.trim()) {
      setFormError(`${sourceMeta.fieldLabel} is required.`);
      return;
    }
    const cap = capLeads ? Number(capLeads) : undefined;
    if (cap !== undefined && (cap < 1 || cap > 1000)) {
      setFormError("Lead cap must be between 1 and 1000.");
      return;
    }

    mutation.mutate({ xAccountId, sourceType, sourceRef: sourceRef.trim(), capLeads: cap });
  }

  if (accountsQuery.isLoading) {
    return <SkeletonRows rows={4} cols={1} />;
  }

  const apiError = mutation.error instanceof ApiError ? mutation.error.message : null;

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Trigger Scrape</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor={`${idPrefix}-account`}
            className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            X account
          </label>
          {accounts.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No X accounts connected. Connect one on the X Accounts screen first.
            </p>
          ) : (
            <select
              id={`${idPrefix}-account`}
              value={xAccountId}
              onChange={(e) => setXAccountId(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="">Select an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} disabled={a.status !== "active"}>
                  @{a.handle} {a.status !== "active" ? `(${a.status})` : ""}
                </option>
              ))}
            </select>
          )}
          {activeAccounts.length === 0 && accounts.length > 0 && (
            <p className="mt-1 text-xs text-status-warning">No active accounts available to scrape with.</p>
          )}
        </div>

        <div>
          <label id={`${idPrefix}-source-type-label`} className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Source type
          </label>
          <div className="flex rounded-md border p-0.5" role="group" aria-labelledby={`${idPrefix}-source-type-label`}>
            {SOURCE_TYPES.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={sourceType === s.value}
                onClick={() => setSourceType(s.value)}
                className={`flex-1 rounded-[5px] py-1.5 text-sm font-medium transition-colors ${
                  sourceType === s.value
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500">{sourceMeta.description}</p>
        </div>

        <div>
          <label
            htmlFor={`${idPrefix}-source-ref`}
            className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            {sourceMeta.fieldLabel}
          </label>
          <input
            id={`${idPrefix}-source-ref`}
            value={sourceRef}
            onChange={(e) => setSourceRef(e.target.value)}
            placeholder={sourceMeta.placeholder}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label
            htmlFor={`${idPrefix}-cap-leads`}
            className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Cap on leads <span className="text-zinc-400">(optional, max 1000)</span>
          </label>
          <input
            id={`${idPrefix}-cap-leads`}
            type="number"
            min={1}
            max={1000}
            placeholder="System default"
            value={capLeads}
            onChange={(e) => setCapLeads(e.target.value)}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        {(formError || apiError) && <p className="text-sm text-status-danger">{formError ?? apiError}</p>}

        <button
          type="submit"
          disabled={mutation.isPending || accounts.length === 0}
          className="w-full rounded-md bg-accent py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {mutation.isPending ? "Starting…" : "Start scrape"}
        </button>
      </form>
    </div>
  );
}
