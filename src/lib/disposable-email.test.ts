import { describe, expect, it } from "vitest";
import { isDisposableEmail } from "./disposable-email.js";

describe("isDisposableEmail", () => {
  it("blocks well-known disposable domains", () => {
    expect(isDisposableEmail("someone@mailinator.com")).toBe(true);
    expect(isDisposableEmail("someone@10minutemail.com")).toBe(true);
    expect(isDisposableEmail("someone@yopmail.com")).toBe(true);
  });

  it("blocks subdomains of wildcard-listed disposable domains", () => {
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
});
