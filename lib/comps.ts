// Comparable-set analysis for the token radar.
//
// lib/model.ts answers one question with the comps: "what single multiple do we
// price this category at?" This module answers the questions that sit around it:
// how wide is the spread behind that number, which observations look like
// outliers, and how much should we trust each category's evidence at all?
//
// Everything here is computed from the snapshot alone. A "comp" is a protocol
// that already has a token with a real market: a positive market cap and a
// positive TVL. Its one observation is the ratio
//
//     multiple = market_cap_usd / tvl_usd
//
// which reads as "the market pays this many dollars of token value for one
// dollar of deposits in a protocol like this". Exchanges are left out on
// purpose: an exchange's TVL is mostly custody balances, so its ratio prices a
// different thing and would drag every category it touched.
//
// The functions are deliberately small and pure so the dashboard, the model
// and a reader with a calculator all land on the same numbers.

import type { Snapshot, SnapshotProtocol } from './model.ts';

/** Round to four decimals, the same precision the board itself is quoted at. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Does this protocol count as a comparable? It needs a token (any of the three
 * token markers the snapshot records), a category that is not an exchange,
 * and both figures positive — a zero or missing denominator is not evidence,
 * it is just a gap in the data.
 */
export function isUsableComp(p: SnapshotProtocol): boolean {
  const hasToken = p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
  if (!hasToken || p.category === 'CEX') return false;
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** The one observation a comp contributes: market cap divided by TVL. */
export function compRatio(p: SnapshotProtocol): number {
  return (p.mcap_usd as number) / p.tvl_usd;
}

/**
 * The median of a list of numbers: the middle value of the sorted list, or the
 * mean of the two middle values when the count is even. Returns 0 for an empty
 * list so callers never have to special-case "no comps" before dividing.
 */
export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * One quartile of an already-sorted list, by the median-of-halves method:
 * split the list at its median, then q1 is the median of the lower half and
 * q3 the median of the upper half. For an odd count the median element itself
 * belongs to neither half. This is the textbook hinge method — easy to check
 * by hand on a short list, which is exactly what a reader auditing a small
 * category will do.
 */
function hinge(sorted: number[], upper: boolean): number {
  const mid = Math.floor(sorted.length / 2);
  const half = sorted.length % 2 === 1
    ? (upper ? sorted.slice(mid + 1) : sorted.slice(0, mid))
    : (upper ? sorted.slice(mid) : sorted.slice(0, mid));
  return half.length === 0 ? sorted[mid] ?? 0 : medianOf(half);
}

/** The spread of one set of multiples, before and after outlier trimming. */
export interface RatioSummary {
  /** How many observations went in. */
  count: number;
  /** The middle observation. */
  median: number;
  /** First quartile: a quarter of the comps trade at or below this. */
  q1: number;
  /** Third quartile: three quarters of the comps trade at or below this. */
  q3: number;
  /** Interquartile range, q3 - q1: the spread of the middle half. */
  iqr: number;
  /** The smallest and largest observations, kept so extremes stay visible. */
  min: number;
  max: number;
  /** Observations the IQR fence judged to be outliers and set aside. */
  outliers_removed: number;
  /** The median recomputed after trimming: steadier when one comp is wild. */
  trimmed_median: number;
}

/**
 * Summarise a bag of multiples. Outliers are found with the standard IQR
 * fence: anything below q1 - 1.5*iqr or above q3 + 1.5*iqr. Trimming never
 * deletes the evidence from the report — the raw median, the extremes and the
 * removal count are all carried alongside the trimmed median — it only stops
 * one freak observation (a token trading at 400x TVL on a rumour) from
 * standing in the middle of a category it does not represent. When the middle
 * half has no spread at all (iqr = 0) nothing is trimmed: with no measured
 * spread there is no honest fence to trim against.
 */
export function summariseRatios(values: number[]): RatioSummary {
  if (values.length === 0) {
    return { count: 0, median: 0, q1: 0, q3: 0, iqr: 0, min: 0, max: 0, outliers_removed: 0, trimmed_median: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = hinge(sorted, false);
  const q3 = hinge(sorted, true);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  const kept = iqr === 0 ? sorted : sorted.filter((v) => v >= low && v <= high);
  return {
    count: sorted.length,
    median: round4(medianOf(sorted)),
    q1: round4(q1),
    q3: round4(q3),
    iqr: round4(iqr),
    min: round4(sorted[0]!),
    max: round4(sorted[sorted.length - 1]!),
    outliers_removed: sorted.length - kept.length,
    trimmed_median: round4(medianOf(kept)),
  };
}

/**
 * A plain-language grade for how much a category's comp evidence can carry.
 * Depth matters most — quartiles from two observations are arithmetic, not
 * knowledge — and coverage matters second: a category where most tokenised
 * protocols are missing a market cap is a category we only partly see.
 */
export function qualityGrade(usable: number, coveragePct: number): string {
  if (usable === 0) return 'none';
  if (usable === 1) return 'single comp';
  if (usable < 4) return 'thin';
  if (usable >= 8 && coveragePct >= 50) return 'strong';
  return 'usable';
}

/** One row of the comparable table: a category's multiples and its data quality. */
export interface CategoryCompTable {
  category: string;
  /** Every protocol the snapshot lists in this category, tokenised or not. */
  seen: number;
  /** How many of them are usable comps (token, positive mcap and TVL). */
  usable: number;
  /** Tokenised protocols that could not be used, and why, counted plainly. */
  missing_mcap: number;
  unusable_tvl: number;
  /** Usable comps as a percentage of the tokenised protocols seen. */
  coverage_pct: number;
  /** The category's market-cap/TVL multiples: middle, quartiles and spread. */
  median_multiple: number;
  q1_multiple: number;
  q3_multiple: number;
  iqr_multiple: number;
  min_multiple: number;
  max_multiple: number;
  /** Median after IQR outlier trimming, with how many were set aside. */
  trimmed_median_multiple: number;
  outliers_removed: number;
  /** qualityGrade's verdict on this category's evidence. */
  quality: string;
}

/**
 * Build the comparable table for a whole snapshot: one row per category that
 * contains at least one tokenised protocol, deepest evidence first. Pre-token
 * protocols are counted in `seen` (they are the rows this table exists to
 * price) but never contribute a ratio of their own.
 */
export function buildCompTables(snapshot: Snapshot): CategoryCompTable[] {
  const byCategory = new Map<string, { seen: number; ratios: number[]; missingMcap: number; badTvl: number; tokenised: number }>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    let bucket = byCategory.get(key);
    if (bucket === undefined) {
      bucket = { seen: 0, ratios: [], missingMcap: 0, badTvl: 0, tokenised: 0 };
      byCategory.set(key, bucket);
    }
    bucket.seen += 1;
    const hasToken = p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
    if (!hasToken || p.category === 'CEX') continue;
    bucket.tokenised += 1;
    if (p.mcap_usd === null || p.mcap_usd <= 0) { bucket.missingMcap += 1; continue; }
    if (p.tvl_usd <= 0) { bucket.badTvl += 1; continue; }
    bucket.ratios.push(p.mcap_usd / p.tvl_usd);
  }
  const tables: CategoryCompTable[] = [];
  for (const [category, b] of byCategory) {
    if (b.tokenised === 0) continue; // a category with no tokenised protocol has no comps to report
    const s = summariseRatios(b.ratios);
    const coverage = b.tokenised === 0 ? 0 : Math.round((b.ratios.length / b.tokenised) * 1000) / 10;
    tables.push({
      category,
      seen: b.seen,
      usable: b.ratios.length,
      missing_mcap: b.missingMcap,
      unusable_tvl: b.badTvl,
      coverage_pct: coverage,
      median_multiple: s.median,
      q1_multiple: s.q1,
      q3_multiple: s.q3,
      iqr_multiple: s.iqr,
      min_multiple: s.min,
      max_multiple: s.max,
      trimmed_median_multiple: s.trimmed_median,
      outliers_removed: s.outliers_removed,
      quality: qualityGrade(b.ratios.length, coverage),
    });
  }
  return tables.sort((a, b) => b.usable - a.usable || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}

/** The table row for one category, or null when that category has no comps. */
export function compTableFor(tables: CategoryCompTable[], category: string | null): CategoryCompTable | null {
  return tables.find((t) => t.category === (category ?? 'Other')) ?? null;
}

/** The whole market's ratio summary: every usable comp in one bag. */
export function globalSummary(snapshot: Snapshot): RatioSummary {
  const all: number[] = [];
  for (const p of snapshot.protocols) if (isUsableComp(p)) all.push(compRatio(p));
  return summariseRatios(all);
}
