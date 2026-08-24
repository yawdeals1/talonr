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
  const [verifiedOnly, setVerifiedOnly] = useState(false);
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
        // Sent only when checked: an unchecked box is no filter at all, and sending `false` would
        // put the run on the filtered path for a bound that excludes nobody.
        ...(verifiedOnly ? { verifiedOnly: true } : {}),
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
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Trigger New Scrape
        </h1>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Configure scrape target, X account session, engagement rules, and lead criteria filters.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Account Selection */}
          <div className="rounded-lg border bg-white p-4 dark:bg-zinc-950 dark:border-zinc-800">
            <label
              htmlFor={`${idPrefix}-account`}
              className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300"
            >
              1. Select X Account
            </label>
            {accounts.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No X accounts connected. Connect one on the X Accounts screen first.
              </p>
            ) : (
              <select
                id={`${idPrefix}-account`}
                value={xAccountId}
                onChange={(e) => setXAccountId(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs text-zinc-900 outline-none focus:border-amber-600 dark:text-zinc-100 dark:border-zinc-800"
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
              <p className="mt-1.5 text-xs text-amber-600 font-mono">No active accounts available to scrape with.</p>
            )}
          </div>

          {/* Source Type Selection Cards */}
          <div className="rounded-lg border bg-white p-4 dark:bg-zinc-950 dark:border-zinc-800 space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              2. Select Source Type
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SOURCE_TYPES.map((s) => {
                const isSelected = sourceType === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSourceType(s.value)}
                    className={`flex flex-col justify-between rounded-md border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-amber-600 bg-amber-500/10 dark:border-amber-500 dark:bg-amber-500/10"
                        : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold uppercase text-zinc-900 dark:text-zinc-100">
                        {s.label}
                      </span>
                      {isSelected && (
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                      )}
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500 leading-tight dark:text-zinc-400">
                      {s.description}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="pt-2">
              <label
                htmlFor={`${idPrefix}-source-ref`}
                className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                {sourceMeta.fieldLabel}
              </label>
              <input
                id={`${idPrefix}-source-ref`}
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
                placeholder={sourceMeta.placeholder}
                className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-amber-600 dark:border-zinc-800"
              />
            </div>

            {sourceType === "engagers" && (
              <div className="pt-2 space-y-2">
                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Engagement Strategy</span>
                <div className="flex gap-4">
                  {ENGAGEMENT_TYPES.map((t) => (
                    <label key={t.value} className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={engagementTypes.includes(t.value)}
                        onChange={() => toggleEngagementType(t.value)}
                        className="h-3.5 w-3.5 rounded border-zinc-300 accent-amber-600 dark:border-zinc-700"
                      />
                      <span>{t.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Lead Filters Section */}
          <div className="rounded-lg border bg-white p-4 dark:bg-zinc-950 dark:border-zinc-800 space-y-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              3. Target Criteria & Lead Limits
            </label>

            <div>
              <label
                htmlFor={`${idPrefix}-cap-leads`}
                className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                Cap on leads <span className="text-zinc-400 font-mono">(optional, max 1000)</span>
              </label>
              <input
                id={`${idPrefix}-cap-leads`}
                type="number"
                min={1}
                max={1000}
                placeholder="100"
                value={capLeads}
                onChange={(e) => setCapLeads(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-amber-600 dark:border-zinc-800"
              />
            </div>

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
                  placeholder="0"
                  className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-amber-600 dark:border-zinc-800"
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
                  placeholder="No limit"
                  className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-amber-600 dark:border-zinc-800"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor={`${idPrefix}-location`}
                className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                Country or location filter
              </label>
              <input
                id={`${idPrefix}-location`}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                maxLength={200}
                placeholder="e.g. San Francisco or London"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-xs outline-none focus:border-amber-600 dark:border-zinc-800"
              />
            </div>

            <label className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(event) => setVerifiedOnly(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber-600"
              />
              <span>
                Verified accounts only
                <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">
                  Filters unverified accounts immediately from list cells without sequential profile enrichment.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Live Config Summary Sidebar */}
        <div className="space-y-4">
          <div className="sticky top-6 rounded-lg border bg-zinc-50 p-4 space-y-4 dark:bg-zinc-900/50 dark:border-zinc-800">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 border-b pb-2 dark:border-zinc-800">
              Scrape Job Overview
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Account:</span>
                <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                  {xAccountId ? `@${accounts.find((a) => a.id === xAccountId)?.handle}` : "Not selected"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Type:</span>
                <span className="font-mono font-semibold uppercase">{sourceType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Target:</span>
                <span className="font-mono truncate max-w-[140px]">{sourceRef || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Lead Cap:</span>
                <span className="font-mono">{capLeads || "System default"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Min Followers:</span>
                <span className="font-mono">{minFollowers || "None"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Verified Only:</span>
                <span className="font-mono">{verifiedOnly ? "Yes" : "No"}</span>
              </div>
            </div>

            {(formError || apiError) && (
              <p className="rounded border border-red-500/20 bg-red-500/10 p-2 text-xs font-medium text-red-600 dark:text-red-400">
                {formError ?? apiError}
              </p>
            )}

            <button
              type="submit"
              disabled={mutation.isPending || accounts.length === 0}
              className="w-full rounded-md bg-accent py-2.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {mutation.isPending ? "Launching Worker Scrape…" : "Execute Scrape Job"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
