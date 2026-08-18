import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiError } from "../api/client";
import { createLeadList, getLeadList, updateLeadList } from "../api/leadLists";
import type { FilterDefinition } from "../api/types";
import { TagInput } from "../components/TagInput";

export function LeadListForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const existingQuery = useQuery({
    queryKey: ["leadLists", id],
    queryFn: () => getLeadList(id!),
    enabled: isEdit,
  });

  const [name, setName] = useState("");
  const [bioKeywords, setBioKeywords] = useState<string[]>([]);
  const [minFollowers, setMinFollowers] = useState("");
  const [maxFollowers, setMaxFollowers] = useState("");
  const [location, setLocation] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [maxLeads, setMaxLeads] = useState("");
  const idPrefix = useId();

  useEffect(() => {
    const list = existingQuery.data?.leadList;
    if (!list) return;
    setName(list.name);
    setBioKeywords(list.filterDefinition.bioKeywords ?? []);
    setMinFollowers(list.filterDefinition.minFollowers?.toString() ?? "");
    setMaxFollowers(list.filterDefinition.maxFollowers?.toString() ?? "");
    setLocation(list.filterDefinition.location ?? "");
    setVerifiedOnly(list.filterDefinition.verifiedOnly ?? false);
    setMaxLeads(list.filterDefinition.maxLeads?.toString() ?? "");
  }, [existingQuery.data]);

  const mutation = useMutation({
    mutationFn: (filterDefinition: FilterDefinition) =>
      isEdit ? updateLeadList(id!, { name, filterDefinition }) : createLeadList(name, filterDefinition),
    onSuccess: ({ leadList }) => {
      queryClient.invalidateQueries({ queryKey: ["leadLists"] });
      navigate(`/lead-lists/${leadList.id}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const filterDefinition: FilterDefinition = {
      bioKeywords: bioKeywords.length > 0 ? bioKeywords : undefined,
      minFollowers: minFollowers ? Number(minFollowers) : undefined,
      maxFollowers: maxFollowers ? Number(maxFollowers) : undefined,
      location: location.trim() || undefined,
      verifiedOnly: verifiedOnly || undefined,
      maxLeads: maxLeads ? Number(maxLeads) : undefined,
    };
    mutation.mutate(filterDefinition);
  }

  if (isEdit && existingQuery.isLoading) {
    return <div className="text-sm text-zinc-500">Loading…</div>;
  }

  const error = mutation.error instanceof ApiError ? mutation.error.message : null;

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {isEdit ? "Edit Lead List" : "Create Lead List"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor={`${idPrefix}-name`} className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Name
          </label>
          <input
            id={`${idPrefix}-name`}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Warm SaaS founders"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label
            htmlFor={`${idPrefix}-bio-keywords`}
            className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Bio keywords <span className="text-zinc-400">(matches any)</span>
          </label>
          <TagInput id={`${idPrefix}-bio-keywords`} tags={bioKeywords} onChange={setBioKeywords} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={`${idPrefix}-min-followers`}
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Min followers
            </label>
            <input
              id={`${idPrefix}-min-followers`}
              type="number"
              min={0}
              value={minFollowers}
              onChange={(e) => setMinFollowers(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-max-followers`}
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Max followers
            </label>
            <input
              id={`${idPrefix}-max-followers`}
              type="number"
              min={0}
              value={maxFollowers}
              onChange={(e) => setMaxFollowers(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
        <p className="-mt-3 text-xs text-zinc-500">
          Leads with no follower count on file are excluded from follower-range filters.
        </p>

        <div>
          <label
            htmlFor={`${idPrefix}-location`}
            className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Location
          </label>
          <input
            id={`${idPrefix}-location`}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Substring match, e.g. London"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Location is captured from each public profile during the scrape. Accounts that do not
            publish a location will remain unmatched.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 accent-accent"
          />
          Verified only
        </label>

        <div>
          <label
            htmlFor={`${idPrefix}-max-leads`}
            className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Max leads <span className="text-zinc-400">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-max-leads`}
            type="number"
            min={1}
            value={maxLeads}
            onChange={(e) => setMaxLeads(e.target.value)}
            placeholder="No limit"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        {error && <p className="text-sm text-status-danger">{error}</p>}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-md bg-accent py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {mutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Create Lead List"}
        </button>
      </form>
    </div>
  );
}
