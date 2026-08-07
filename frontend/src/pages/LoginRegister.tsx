import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { PasswordCriteriaList, usePasswordCriteria } from "../components/PasswordCriteria";
import { useAuth } from "../context/AuthContext";

type Tab = "login" | "register";

export function LoginRegister() {
  const { user, isLoading, login, register } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { checks: passwordChecks, meetsAll: passwordMeetsCriteria } = usePasswordCriteria(password);

  if (!isLoading && user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (tab === "login") {
        await login(email, password);
        navigate("/", { replace: true });
      } else {
        // Deploro Auth requires confirming the emailed link before this account can log in —
        // there's no immediate session to switch to yet.
        const message = await register(email, password);
        setTab("login");
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
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-lg border bg-white p-6 dark:bg-zinc-900/40">
        <p className="mb-6 font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">talonr</p>

        <div className="mb-6 flex rounded-md border p-0.5">
          {(["login", "register"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setError(null);
                setNotice(null);
              }}
              className={`flex-1 rounded-[5px] py-1.5 text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t === "login" ? "Log in" : "Register"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={tab === "login" ? undefined : 8}
              // Registration deliberately avoids "new-password": that's the value that tells
              // browsers "this will become a saved credential" and triggers the save-password
              // prompt right after submit. Login keeps "current-password" so browsers can offer
              // to autofill (and, there, offer to save) an existing saved credential.
              autoComplete={tab === "login" ? "current-password" : "off"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {tab === "register" ? <PasswordCriteriaList checks={passwordChecks} /> : null}
            {tab === "login" ? (
              <Link to="/forgot-password" className="mt-1.5 inline-block text-xs text-accent-text hover:underline">
                Forgot password?
              </Link>
            ) : null}
          </div>

          {notice && <p className="text-sm text-status-success">{notice}</p>}
          {error && <p className="text-sm text-status-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting || (tab === "register" && !passwordMeetsCriteria)}
            className="w-full rounded-md bg-accent py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Please wait…" : tab === "login" ? "Log in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
