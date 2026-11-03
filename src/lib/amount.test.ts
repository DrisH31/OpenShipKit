import { describe, expect, it } from "vitest";
import { amountText, currencySymbol, parseAmount } from "./amount";

describe("amount", () => {
  it("shows stored minor units in the main unit", () => {
    expect(amountText(1950, "usd")).toBe("19.50");
    expect(amountText(19000, "usd")).toBe("190.00");
    expect(amountText(500, "jpy")).toBe("500");
    expect(amountText(undefined, "usd")).toBe("");
    expect(amountText(Number.NaN, "usd")).toBe("");
  });

  it("reads what a person types as minor units", () => {
    expect(parseAmount("19", "usd")).toBe(1900);
    expect(parseAmount("19.5", "usd")).toBe(1950);
    expect(parseAmount("19.", "usd")).toBe(1900);
    expect(parseAmount(".5", "usd")).toBe(50);
    expect(parseAmount("1,299.99", "usd")).toBe(129999);
    expect(parseAmount("0.07", "usd")).toBe(7);
    expect(parseAmount("500", "jpy")).toBe(500);
  });

  it("refuses what isn't an amount in the currency", () => {
    expect(parseAmount("", "usd")).toBeUndefined();
    expect(parseAmount(".", "usd")).toBeUndefined();
    expect(parseAmount("19.999", "usd")).toBeUndefined();
    expect(parseAmount("5.5", "jpy")).toBeUndefined();
    expect(parseAmount("-5", "usd")).toBeUndefined();
    expect(parseAmount("abc", "usd")).toBeUndefined();
  });

  it("names the currency by its symbol", () => {
    expect(currencySymbol("usd")).toBe("$");
    expect(currencySymbol("eur")).toBe("€");
    expect(currencySymbol("zzz")).toBe("ZZZ");
  });
});
