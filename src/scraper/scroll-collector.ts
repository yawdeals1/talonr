import { checkHealth } from "./detectors.js";
import type { RawLead, ScrapeSource, ScrapeSourceContext } from "./types.js";

const MAX_STAGNANT_ROUNDS = 4;

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Scrapes X's virtualized list views: read what's currently rendered, scroll, wait a random
 * interval, repeat — until the lead cap is hit or several consecutive scrolls surface nothing new.
 */
export async function scrollAndCollect(source: ScrapeSource, ctx: ScrapeSourceContext): Promise<RawLead[]> {
  const seen = new Map<string, RawLead>();

  await ctx.page.goto(source.buildUrl(ctx.sourceRef), { waitUntil: "domcontentloaded" });
  await checkHealth(ctx.page);
  await source.waitForReady(ctx.page);

  let stagnantRounds = 0;

  while (seen.size < ctx.capLeads && stagnantRounds < MAX_STAGNANT_ROUNDS) {
    await checkHealth(ctx.page);

    const items = await source.extractVisibleItems(ctx.page);
    const before = seen.size;
    for (const item of items) {
      const key = item.handle.toLowerCase();
      if (!seen.has(key)) seen.set(key, item);
    }
    stagnantRounds = seen.size === before ? stagnantRounds + 1 : 0;

    if (seen.size >= ctx.capLeads) break;

    await ctx.page.mouse.wheel(0, 2200 + Math.random() * 800);
    await randomDelay(ctx.minScrollDelayMs, ctx.maxScrollDelayMs);
  }

  return Array.from(seen.values()).slice(0, ctx.capLeads);
}
