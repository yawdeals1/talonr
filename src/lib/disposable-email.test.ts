import { describe, expect, it } from "vitest";
import { isDisposableEmail, mergeBlocklistText } from "./disposable-email.js";

describe("isDisposableEmail", () => {
  it("blocks well-known disposable domains", () => {
    expect(isDisposableEmail("someone@mailinator.com")).toBe(true);
    expect(isDisposableEmail("someone@10minutemail.com")).toBe(true);
    expect(isDisposableEmail("someone@yopmail.com")).toBe(true);
  });

  it("blocks subdomains of a listed disposable domain", () => {
    expect(isDisposableEmail("someone@sub.mailinator.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isDisposableEmail("Someone@MAILINATOR.COM")).toBe(true);
  });

  it("allows real email providers", () => {
    expect(isDisposableEmail("someone@gmail.com")).toBe(false);
    expect(isDisposableEmail("someone@outlook.com")).toBe(false);
    expect(isDisposableEmail("someone@company.co")).toBe(false);
  });

  it("blocks a domain added by a blocklist refresh — the 10minutemail.net rotating-domain case", () => {
    // 10minutemail.net hands out addresses on freshly-registered front-end domains (e.g.
    // laoia.com) that the bundled npm package doesn't ship — this is exactly what
    // refreshDisposableEmailBlocklist()/mergeBlocklistText() close at runtime.
    expect(isDisposableEmail("someone@not-yet-a-real-domain-xyz123.test")).toBe(false);
    mergeBlocklistText("# comment line\nnot-yet-a-real-domain-xyz123.test\n");
    expect(isDisposableEmail("someone@not-yet-a-real-domain-xyz123.test")).toBe(true);
  });

  it("ignores blank lines and comments when merging blocklist text", () => {
    mergeBlocklistText("\n  \n#skip-me.test\nreal-merge-target.test\n");
    expect(isDisposableEmail("someone@real-merge-target.test")).toBe(true);
    expect(isDisposableEmail("someone@skip-me.test")).toBe(false);
  });
});
