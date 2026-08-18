import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { listAccounts } from "../api/accounts";
import { ApiError } from "../api/client";
import { createScrape } from "../api/scrapes";
import type { EngagementType, ScrapeResultFilter, SourceType } from "../api/types";
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
    value: "engagers",
    label: "Engagers",
    // X made "who liked a post" private platform-wide in June 2024 with no workaround, so
    // engagement scraping is built on what's still public: replies and retweets.
    description: "Scrape the people who replied to and/or retweeted a specific tweet.",
    fieldLabel: "Tweet URL",
    placeholder: "https://x.com/user/status/12345",
  },
];

const ENGAGEMENT_TYPES: { value: EngagementType; label: string }[] = [
  { value: "repliers", label: "Repliers (comments)" },
  { value: "retweeters", label: "Retweeters (reposts)" },
];

export function TriggerScrape() {
  const navigate = useNavigate();
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });

  const [xAccountId, setXAccountId] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("search");
  const [sourceRef, setSourceRef] = useState("");
  const [engagementTypes, setEngagementTypes] = useState<EngagementType[]>(["repliers", "retweeters"]);
  const [capLeads, setCapLeads] = useState("");
  const [minFollowers, setMinFollowers] = useState("");
  const [maxFollowers, setMaxFollowers] = useState("");
  const [location, setLocation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const idPrefix = useId();

  const mutation = useMutation({
    mutationFn: createScrape,
    onSuccess: ({ scrapeJob }) => navigate(`/scrapes/${scrapeJob.id}`),
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const activeAccounts = accounts.filter((a) => a.status === "active");
  const sourceMeta = SOURCE_TYPES.find((s) => s.value === sourceType)!;

  function toggleEngagementType(type: EngagementType) {
    setEngagementTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

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
    if (sourceType === "engagers" && engagementTypes.length === 0) {
      setFormError("Select at least one engagement type (repliers, retweeters).");
      return;
    }
    const cap = capLeads ? Number(capLeads) : undefined;
    if (cap !== undefined && (cap < 1 || cap > 1000)) {
      setFormError("Lead cap must be between 1 and 1000.");
      return;
    }

    const min = minFollowers === "" ? undefined : Number(minFollowers);
    const max = maxFollowers === "" ? undefined : Number(maxFollowers);
    if (min !== undefined && (!Number.isSafeInteger(min) || min < 0)) {
      setFormError("Minimum followers must be a non-negative whole number.");
      return;
    }
    if (max !== undefined && (!Number.isSafeInteger(max) || max < 0)) {
      setFormError("Maximum followers must be a non-negative whole number.");
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      setFormError("Maximum followers must be greater than or equal to minimum followers.");
      return;
    }

    const locationFilter = location.trim();

    const resultFilterDefinition: ScrapeResultFilter = {
        ...(min !== undefined ? { minFollowers: min } : {}),
        ...(max !== undefined ? { maxFollowers: max } : {}),
        ...(locationFilter ? { location: locationFilter } : {}),
    };
    mutation.mutate({
      xAccountId,
      sourceType,
      sourceRef: sourceRef.trim(),
      engagementTypes: sourceType === "engagers" ? engagementTypes : undefined,
      capLeads: cap,
      resultFilterDefinition,
    });
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
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none focus:border-accent dark:text-zinc-100"
            >
              <option value="" className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
                Select an account…
              </option>
              {accounts.map((a) => (
                <option
                  key={a.id}
                  value={a.id}
                  disabled={a.status !== "active"}
                  className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                >
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

        {sourceType === "engagers" && (
          <div>
            <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Engagement types</span>
            <div className="space-y-2">
              {ENGAGEMENT_TYPES.map((t) => (
                <label key={t.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={engagementTypes.includes(t.value)}
                    onChange={() => toggleEngagementType(t.value)}
                    className="h-4 w-4 rounded border-zinc-300 accent-accent"
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </div>
        )}

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

        <fieldset className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Result filters <span className="font-normal text-zinc-400">(optional)</span>
          </legend>
          <p className="text-xs text-zinc-500">
            Talonr still saves every collected lead. These filters control which leads are shown when the scrape opens.
          </p>

          <div className="grid grid-cols-2 gap-3">
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

          <p className="text-xs text-zinc-500">
            Accounts with unknown follower counts are excluded when a follower bound is set.
          </p>
        </fieldset>

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
