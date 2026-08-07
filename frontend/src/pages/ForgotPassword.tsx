import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import * as authApi from "../api/auth";
import { ApiError } from "../api/client";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { message } = await authApi.requestPasswordReset(email);
      setNotice(message);
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
        <h1 className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">Reset your password</h1>
        <p className="mb-6 text-xs text-zinc-500">
          Enter your account email and we'll send you a link to set a new password.
        </p>

        {notice ? (
          <p className="text-sm text-status-success">{notice}</p>
        ) : (
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

            {error && <p className="text-sm text-status-danger">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-accent py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Please wait…" : "Send reset link"}
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
