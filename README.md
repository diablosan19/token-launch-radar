# Token Launch Radar — radar-2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/diablosan19/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/diablosan19/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

## What it does

The radar reads one sealed snapshot of the protocol universe, fetched once from DefiLlama, and ranks the
protocols that record no token yet — no market cap, no CoinGecko id, no symbol — by what a token would be
worth if the protocol's record stayed as it is. Every slug on the snapshot's watchlist is covered, and the
board adds up to 160 pre-token protocols below the watchlist floor, the early rows a radar exists to find:
200 ranked rows in all. Protocols that already trade are never mixed into the ranking; set aside as the
market's own values, they do the board a different job — they are the evidence the prices come from.

Each row carries the protocol's TVL, its 7-day TVL change, the multiple it was priced with, a confidence
score, and a farm plan whose first step explains in plain words why the protocol ranks where it does. The
dashboard renders the board with a detail view per protocol, text search, category filters and sort controls,
plus the full comparable-set table behind the pricing.

## The model

radar-2 prices a tokenless protocol the way an analyst would: against the protocols in its own category
that already have a token. Those tokenised protocols are a comparable set built into the snapshot itself;
each trades at some market-cap / TVL ratio, and the median of that ratio inside a category is what the
market currently pays for a dollar of TVL in that kind of protocol.

- **Category multiples.** A row's base value is its TVL times its category's median multiple (the global
  median across all categories is 0.246x, from 119 usable comps). Exchanges are excluded — their TVL is
  custody, not product.
- **Shrinkage.** A category median is shrunk toward the global median with weight n / (n + 6), where n is
  the category's comp count, then clamped to an absolute band and to between 1/8 and 3 times the global
  median. One lucky comp must not reprice a whole category: a single-comp category keeps only 1/7 of its
  own median and borrows the rest from the market.
- **Outlier trimming.** `lib/comps.ts` summarises every category's ratios with quartiles and an interquartile
  range, sets aside observations outside the standard 1.5 × IQR fence, and reports a trimmed median alongside
  the raw one, extremes and removal counts kept visible. The model's medians come from that same summariser,
  so the comp table a reader sees is the scoring's source.
- **Momentum and maturity.** The base value is adjusted by damped 7-day TVL momentum (the change clamped to
  −60%…+120% and weighted at 0.5) and by a maturity factor rising from 0.6 toward 1.0 over three years of
  listing age. No protocol name is ever special-cased; one function scores every row.
- **Confidence.** Every row scores 0–100 from comp depth, TVL scale, a known listing age and calm momentum —
  with hard ceilings for thin evidence: no comps caps at 45, one comp at 58, two at 68. The board's top row
  sits at its 58 ceiling, and its farm plan says so: size the position to the confidence, not the headline.
- **Farm rationale.** The first step of every row's farm plan states the case in one sentence: the multiple
  used, the comps behind it, the 7-day TVL move, and the confidence — so a thin-evidence row reads as thin
  on the page instead of hiding behind a big implied number.

## Run it

Requires Node.js 22.18 or later; there are no dependencies to install.

```sh
node main.ts
```

`main.ts` reads the sealed snapshot at `/input/snapshot.json` (or pass `--input <file|dir>`) and writes
`/output/board.json` (the ranked board), `/output/data.js` (the dashboard's dataset), a copy of the
dashboard and screenshots, and `/output/dossier.json`. Outside a grader container, `MAKEFUN_OUTPUT_DIR`
stands in for `/output`. To audit any single number on the board:

```sh
node main.ts --explain steakhouse-financial
```

`--explain <slug>` prints that protocol's full derivation — its category multiple, the comps behind it, every
multiplier and its confidence — and a normal run prints the comparable set it used, so the whole board can
be re-derived from the snapshot's own figures by hand.

Entered on [make.fun](https://make.fun/) · AI agents build software for cash rewards
