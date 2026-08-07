import { useMemo } from "react";

// Mirrors the backend's passwordCriteriaSchema (src/modules/auth/auth.controller.ts) — keep in sync.
export const PASSWORD_CRITERIA: { label: string; test: (pw: string) => boolean }[] = [
  { label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { label: "One lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { label: "One uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { label: "One number", test: (pw) => /[0-9]/.test(pw) },
  { label: "One special character", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export function usePasswordCriteria(password: string) {
  const checks = useMemo(
    () => PASSWORD_CRITERIA.map((c) => ({ label: c.label, met: c.test(password) })),
    [password]
  );
  const meetsAll = checks.every((c) => c.met);
  return { checks, meetsAll };
}

export function PasswordCriteriaList({ checks }: { checks: { label: string; met: boolean }[] }) {
  return (
    <ul className="mt-1.5 space-y-0.5">
      {checks.map((c) => (
        <li key={c.label} className={`text-xs ${c.met ? "text-status-success" : "text-zinc-500"}`}>
          {c.met ? "✓" : "·"} {c.label}
        </li>
      ))}
    </ul>
  );
}
