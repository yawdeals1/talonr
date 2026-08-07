import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import * as authApi from "../api/auth";
import { ApiError } from "../api/client";
import { PasswordCriteriaList, usePasswordCriteria } from "../components/PasswordCriteria";

export function ResetPassword() {
  const navigate = useNavigate();
  // Deploro's reset-link redirect lands here with ?reset_token=<token>, not ?token=.
  const [searchParams] = useSearchParams();
  const token = searchParams.get("reset_token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { checks, meetsAll } = usePasswordCriteria(password);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, password);
      // Deploro revoked every existing session as part of the reset and didn't issue a new one —
      // there's no session to switch into, so send them to log in with the new password.
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-lg border bg-white p-6 dark:bg-zinc-900/40">
        <p className="mb-6 font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">talonr</p>
        <h1 className="mb-6 text-sm font-medium text-zinc-900 dark:text-zinc-50">Set a new password</h1>

        {!token ? (
          <p className="text-sm text-status-danger">
            This reset link is missing its token. Request a new one from the{" "}
            <Link to="/forgot-password" className="text-accent-text hover:underline">
              forgot password
            </Link>{" "}
            page.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                New password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <PasswordCriteriaList checks={checks} />
            </div>

            <div>
              <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
              />
              {confirmPassword.length > 0 && !passwordsMatch ? (
                <p className="mt-1 text-xs text-status-danger">Passwords do not match.</p>
              ) : null}
            </div>

            {error && <p className="text-sm text-status-danger">{error}</p>}

            <button
              type="submit"
              disabled={submitting || !meetsAll || !passwordsMatch}
              className="w-full rounded-md bg-accent py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Please wait…" : "Set new password"}
            </button>
          </form>
        )}

        <Link to="/login" className="mt-4 inline-block text-xs text-accent-text hover:underline">
          Back to log in
        </Link>
      </div>
    </div>
  );
}
