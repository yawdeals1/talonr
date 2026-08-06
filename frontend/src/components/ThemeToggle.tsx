import type { ReactNode } from "react";
import { useTheme, type ThemeSetting } from "../context/ThemeContext";

const OPTIONS: { value: ThemeSetting; label: string; icon: ReactNode }[] = [
  {
    value: "light",
    label: "Light theme",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
        <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.4" />
        <path
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11 3.05 3.05"
        />
      </svg>
    ),
  },
  {
    value: "system",
    label: "Match system",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
        <rect x="1.5" y="2.5" width="13" height="8.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
        <path stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" d="M5.5 14h5M8 11v3" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark theme",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
        <path
          fill="currentColor"
          d="M13.5 9.53A6 6 0 0 1 6.47 2.5a6 6 0 1 0 7.03 7.03Z"
        />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex rounded-md border p-0.5" role="group" aria-label="Theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.label}
          aria-label={opt.label}
          aria-pressed={theme === opt.value}
          onClick={() => setTheme(opt.value)}
          className={`flex h-11 w-11 items-center justify-center rounded-[5px] transition-colors ${
            theme === opt.value
              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
