import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { PasswordCriteriaList, usePasswordCriteria } from "../components/PasswordCriteria";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { useAuth } from "../context/AuthContext";

type Tab = "login" | "register";

export function LoginRegister() {
  const { user, isLoading, login, register } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  const { checks: passwordChecks, meetsAll: passwordMeetsCriteria } = usePasswordCriteria(password);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  if (!isLoading && user) {
    return <Navigate to="/" replace />;
  }

  function switchTab(t: Tab) {
    setTab(t);
    setError(null);
    setNotice(null);
    setConfirmPassword("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // Validated on submit (with a clear message) rather than by silently disabling the button —
    // a disabled button with no visible reason reads as broken.
    if (tab === "register") {
      if (!passwordMeetsCriteria) {
        setError("Password does not meet the requirements above.");
        return;
      }
      if (!passwordsMatch) {
        setError("Passwords do not match.");
        return;
      }
      if (!turnstileToken) {
        setError("Please complete the verification check.");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (tab === "login") {
        await login(email, password);
        navigate("/", { replace: true });
      } else {
        // Deploro Auth requires confirming the emailed link before this account can log in —
        // there's no immediate session to switch to yet.
        const message = await register(email, password, turnstileToken!);
        switchTab("login");
        setPassword("");
        setNotice(message);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
      if (tab === "register") {
        // Turnstile tokens are single-use (siteverify consumes it whether or not the rest of
        // the request succeeds) — force a fresh challenge for the next attempt either way.
        setTurnstileToken(null);
        setTurnstileResetKey((k) => k + 1);
      }
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-xl dark:bg-zinc-900/60 dark:border-zinc-800">
        <div className="mb-6 flex items-center justify-between border-b pb-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-accent font-mono text-sm font-bold text-white">
              T
            </div>
            <div>
              <span className="font-mono text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                talonr
              </span>
              <p className="font-mono text-[10px] uppercase text-zinc-400">Operator Console</p>
            </div>
          </div>
          <span className="rounded border bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-500 uppercase dark:bg-zinc-800 dark:text-zinc-400">
            Auth
          </span>
        </div>

        <div className="mb-6 flex rounded-lg border bg-zinc-50 p-1 dark:bg-zinc-950 dark:border-zinc-800">
          {(["login", "register"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => switchTab(t)}
              className={`flex-1 rounded-md py-1.5 font-mono text-xs font-semibold transition-colors ${
                tab === t
                  ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t === "login" ? "Log In" : "Register"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@domain.com"
              className="w-full rounded-md border bg-transparent px-3 py-2 text-xs text-zinc-900 outline-none focus:border-amber-600 dark:text-zinc-100 dark:border-zinc-800"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="password" className="block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Password
              </label>
              {tab === "login" && (
                <Link to="/forgot-password" className="font-mono text-[11px] text-amber-700 hover:underline dark:text-amber-400">
                  Forgot password?
                </Link>
              )}
            </div>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={tab === "login" ? undefined : 8}
              autoComplete={tab === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border bg-transparent px-3 py-2 text-xs text-zinc-900 outline-none focus:border-amber-600 dark:text-zinc-100 dark:border-zinc-800"
            />
            {tab === "register" ? <PasswordCriteriaList checks={passwordChecks} /> : null}
          </div>

          {tab === "register" ? (
            <div>
              <label htmlFor="confirm-password" className="mb-1 block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Confirm Password
              </label>
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-md border bg-transparent px-3 py-2 text-xs text-zinc-900 outline-none focus:border-amber-600 dark:text-zinc-100 dark:border-zinc-800"
              />
              {confirmPassword.length > 0 && !passwordsMatch ? (
                <p className="mt-1 font-mono text-[11px] text-red-500">Passwords do not match.</p>
              ) : null}
            </div>
          ) : null}

          {tab === "register" ? (
            <TurnstileWidget onToken={setTurnstileToken} resetKey={turnstileResetKey} />
          ) : null}

          {notice && <p className="rounded border border-emerald-500/20 bg-emerald-500/10 p-2 font-mono text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}
          {error && <p className="rounded border border-red-500/20 bg-red-500/10 p-2 font-mono text-xs text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-accent py-2.5 font-mono text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Processing Request…" : tab === "login" ? "Log In to Console" : "Create Operator Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
