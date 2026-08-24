import type { ReactNode } from "react";

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col justify-between rounded-lg border bg-zinc-50/50 p-4 transition-colors hover:border-zinc-300 dark:bg-zinc-900/40 dark:hover:border-zinc-700">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
        <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{value}</p>
      </div>
      {sub && <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}
