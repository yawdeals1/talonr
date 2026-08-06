export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-8 flex-1 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900"
              style={{ animationDelay: `${r * 40}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-lg border bg-zinc-50 dark:bg-zinc-900/60"
          style={{ animationDelay: `${i * 40}ms` }}
        />
      ))}
    </div>
  );
}
