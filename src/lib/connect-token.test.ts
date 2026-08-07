import { describe, expect, it, vi } from "vitest";
import { issueConnectToken, verifyConnectToken } from "./connect-token.js";

describe("connect-token", () => {
  it("round-trips the userId/accountId it was issued for", () => {
    const { token } = issueConnectToken("user-1", "account-1");
    expect(verifyConnectToken(token)).toEqual({ userId: "user-1", accountId: "account-1" });
  });

  it("rejects a token with a tampered payload", () => {
    const { token } = issueConnectToken("user-1", "account-1");
    const [version, , signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ userId: "attacker", accountId: "account-1", exp: Date.now() + 10_000 })).toString(
      "base64url"
    );
    expect(verifyConnectToken(`${version}.${forgedPayload}.${signature}`)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifyConnectToken("not-a-token")).toBeNull();
    expect(verifyConnectToken("")).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    try {
      const { token } = issueConnectToken("user-1", "account-1");
      vi.advanceTimersByTime(16 * 60 * 1000);
      expect(verifyConnectToken(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
