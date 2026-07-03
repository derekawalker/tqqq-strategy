# Strategy & App Improvement Roadmap

Product of a full-app strategy review (July 2026). Each item is self-contained:
what to build, why, where the existing building blocks are, and the math where
it matters. Items are ordered by impact. Check off / delete sections as they land.

Context for whoever picks this up: the app runs an 88-level TQQQ buy-the-dip
ladder (`src/lib/levels.ts` — buy every 1% down from anchor, sell each lot
+`sellPercentage`%, geometric lot sizing via `reductionFactor`), sells covered
calls at ladder sell-prices and cash-secured puts at ladder buy-levels
(`src/app/options/page.tsx`), and carries a QQQ deep-tail put hedge
(`src/lib/hedgeTranches.ts`: crash ~0.15Δ/180d + catastrophe ~0.07Δ/365d,
budgeted as a % of TQQQ value). Black-Scholes pricing + greeks live in
`src/lib/putHedge.ts` (`bsPut`, `bsPutGreeks`, `strikeForDelta`). Regime model
in `src/lib/sentiment.ts`. Backtest engine in `src/lib/ladderSim.ts`.

---

## 1. Cash double-commitment stress card (highest priority — risk)

**Problem.** In a fast crash, the ladder's unpurchased buy levels AND the short
puts' assignments draw from the same cash pool simultaneously. Nothing in the
app reconciles this. `useCSPCollateral` (`src/lib/hooks/useCSPCollateral.ts`)
sums put collateral (`strike × 100 × shortQty`) but ignores ladder demand.

**Build.** A dashboard card (and/or Options-page banner) that computes, for a
sweep of hypothetical TQQQ prices X (e.g., current price down to −60% in 5%
steps):

```
cashNeeded(X) = Σ levels[n].cost           for unpurchased levels with buyPrice ≥ X
              + Σ strike × 100 × shortQty  for open short puts with strike ≥ X
cashAvailable = cash balance (already in useBalances)
```

Display the worst headline: "If TQQQ drops to $X you need $Y, you have $Z"
— red when short. Levels come from `useLevels`, positions from `AppContext`
(`optionPositions`), owned state from the current-level logic in
`src/lib/levels.ts` (`computeCurrentLevel`).

**Why it matters.** This is the number that determines whether the strategy
survives the exact event it's designed to exploit. The 8-level put/call safety
buffers (`callSafetyLevels`/`putSafetyLevels` in AppContext) do NOT prevent
double-commitment; they only space the strikes.

## 2. IV rank + annualized-yield/delta columns on the Options page

**Problem.** Strike rows in `buildCallRows`/`buildPutRows`
(`src/app/options/page.tsx`) are pure grid geometry — they say where you
*could* sell, not what's *paying* today. The timing banner (30-day trendline,
"trending up — favor puts") is a direction heuristic; premium sellers get paid
for vol, not direction.

**Build, part A — per-row economics.** For each candidate strike row, using
`bsPutGreeks` (puts) / put-call parity or an added `bsCallGreeks` (calls) with
^VXN-derived IV (see `IV_SCALE` in hedgeTranches.ts — TQQQ options run ~3× the
index IV; apply the same linear skew `ivFor`):

- **Delta** — assignment-probability proxy.
- **Annualized return on collateral** (CSPs): `premium / (strike × 100) × 365/DTE`.
- **Annualized yield on shares** (calls): `premium / (spot × 100) × 365/DTE`.
- A "good sale" flag when annualized yield clears a configurable threshold
  (default 15–20%) at an acceptable delta.

**Build, part B — IV rank as the timing signal.** Compute ^VXN's percentile
over trailing 252 sessions (VXN history already flows through the hedge/quote
plumbing; extend the API route if only spot VXN is fetched today). Drive the
banner with it:

- IV rank > 50: premium is rich — sell, size up.
- IV rank 20–50: normal — sell selectively (use part-A yield flags).
- IV rank < 20: premium is thin — sell less or skip; bad week to force trades.

Keep the trendline only as the put-vs-call *tilt*; IV rank decides *how much*.
This is the single highest-leverage change for option income.

## 3. Crash stress-test table (Hedge page)

**Problem.** The hedge backtest panel answers "how would this have done
historically." Nothing answers "if 2020 happens Monday, where does *today's
actual book* land?" — and the deep-OTM legs' crash payoff is mostly **vega**,
so spot-only intuition badly underestimates it.

**Build.** A table on the Hedge page repricing the entire book under instant
shocks. Scenarios (columns): QQQ −10/−20/−30/−40%, paired with shocked IV of
roughly 35/50/70/90 (^VXN points). Rows:

1. **TQQQ position loss** — use compounded fast-move beta ~2.8–3.2×, not naive
   3× (a −30% QQQ gap ≈ −75–80% TQQQ; the header comment in hedgeTranches.ts
   already documents this mapping).
2. **Hedge payoff** — reprice each open QQQ put with `bsPutGreeks(shockedSpot,
   strike, remainingT, shockedIV)` minus current mark.
3. **Short-option book damage** — the TQQQ CSPs/covered calls get crushed in
   the same move; reprice them too. They MUST be in the table.
4. **Ladder cash demand** at the shocked price (reuse item 1's `cashNeeded`).
5. **Net portfolio drawdown** — the headline number per scenario.

All inputs exist: positions in AppContext, greeks in putHedge.ts, skew/IV
scaling in hedgeTranches.ts.

## 4. Unified daily action queue (dashboard)

**Problem.** Actions are scattered: PutHedgePanel builds a prioritized hedge
action list (`src/app/hedge/PutHedgePanel.tsx`, ~line 193), the Options page
has per-position advice, alerts live in `PageAlertBanner`. Daily use requires
visiting 4+ pages.

**Build.** One ordered checklist at the top of the dashboard aggregating:

- Hedge actions (reuse PutHedgePanel's `ActionItem` builder — extract it to a
  lib so both pages share it).
- Option-position management flags (see item 5's rules).
- Pending/near ladder buys and sells (working orders + levels near spot).
- Regime changes from sentiment.ts ("dropped to Neutral — review sizing").

Consistent execution over a year is worth more than any parameter tweak; this
is the feature that produces it.

## 5. Codified exit mechanics for short options

**Problem.** The "Profit vs Decay / Close Now / Hold to Exp" display
(`PositionAdvice` in options/page.tsx) informs but doesn't instruct. Near
expiry, remaining theta is pennies while gamma risk explodes.

**Build.** Badge per short position, mirroring the hedge side's `CloseRec`
pattern in PutHedgePanel:

- **Close at 50–65% of max profit** (`currentPnl / totalCredit ≥ 0.5`) →
  "≥50% captured — close & redeploy".
- **Manage at 21 DTE** regardless of profit → "21 DTE — roll or close".
- Whichever fires first wins.

Feed these into the action queue (item 4).

## 6. Regime model → live ladder guidance

**Problem.** `regimeAction()` in sentiment.ts says "Exit TQQQ. No dip-buying"
in Risk-Off while the ladder holds standing buy orders — a contradiction the
user must notice themselves. The sim already supports buy throttles
(`simulateLadder`'s `throttle` param, `src/lib/strategySignals.ts`).

**Build.** Surface the current regime on the dashboard and Working Orders page
as a throttle recommendation: Risk-On = full buys; Neutral = consider half
lots; Risk-Off = consider pausing buys below level N. Advisory only (the app
doesn't place orders) — the point is one stance, everywhere.

## 7. Hedge net-carry display

**Problem.** Tail hedges get abandoned after 18 quiet months because the cost
is visible and the offset isn't. The hedge budget spend is already tracked.

**Build.** One card: "Option income YTD $X − hedge spend YTD $Y = net carry
$Z". Income from filled-orders option premiums; spend from the existing hedge
budget tracking. When net is positive, the psychological pressure to skip
hedge buys disappears.

## 8. Smaller items

- **Event calendar** — TQQQ has no earnings, but its IV lives on FOMC/CPI (and
  NVDA-class earnings). A small static list of dates + a banner ("FOMC in 2
  days — elevated premium; don't be short gamma into the print"). Prevents
  opening 5-DTE positions across a Fed decision.
- ~~**Push notifications**~~ — done. `/api/push/check` computes hedge
  monetize (|Δ| ≥ 0.45), roll-due (21 DTE), ITM-near-expiry, and ^VXN band
  crossings, and sends Web Push via `src/lib/webpush.ts`. Polled every 15min
  around the clock (TQQQ/QQQ trade the extended 24x5 session) by a free
  GitHub Actions schedule
  (`.github/workflows/push-check.yml`), with the `vercel.json` Vercel cron
  (Hobby-plan cap: 1 run/day) as a fallback. Subscriptions live in the
  settings table (`src/lib/pushSubscriptions.ts`); opt-in toggle is in the
  settings modal. Requires `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/
  `VAPID_SUBJECT` and a `CRON_SECRET` set in `.env.local`, the Vercel
  project's env vars, and as a GitHub Actions repo secret.
- **Snap income strikes to the listed chain** — `buildCallRows`/`buildPutRows`
  assume a $0.50 strike grid; TQQQ lists $1 strikes in some price bands. Reuse
  the `ChainResolver` pattern from hedgeTranches.ts to snap to real contracts.
- **Core-and-ladder split (backtest first)** — a `corePct` slice bought at t0
  and never sold, remainder runs the ladder. Addresses bull-market cash drag;
  covered calls on the core add income. One new param in `LadderParams`.
- **Regime-dependent sell target (backtest first)** — 5% sell target in
  Risk-On, 3% in Neutral/Risk-Off for faster turnover before trend resumes.
  Cheap sweep in the existing sim.
- ~~**Put-spread financing for the catastrophe leg, high-vol only**~~ — done.
  `buildTranchePlan` (`src/lib/hedgeTranches.ts`) finances the catastrophe leg
  as a put spread once ^VXN > `PUT_SPREAD_VXN_THRESHOLD` (35), surfaced on the
  Hedge page with a "spread-financed" badge.

---

## Guidance for implementation sessions

- Strategy-math items (3, and the put-spread/beta assumptions anywhere) need
  careful quantitative review — a plausible-looking formula error here costs
  real money. Prefer a stronger model and add unit tests against hand-checked
  numbers.
- Items 1, 2A, 4, 5, 7 are well-specified engineering; the formulas above are
  the spec.
- Tests: Vitest, `npm test`, `*.test.ts` alongside source. Pure-math additions
  (stress repricing, yield calcs) should get tests like levels.test.ts.
- This repo's Next.js version has breaking changes vs. training data — read
  `node_modules/next/dist/docs/` before writing framework code (see AGENTS.md).
