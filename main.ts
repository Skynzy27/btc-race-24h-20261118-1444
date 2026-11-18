// Base Breakout — a momentum / trend-following bot for the BTC 24h race
// (cbBTC/USDC, 1-minute bars, long only).
//
// This bot NEVER buys a dip. It buys strength: a close that breaks the
// 90-bar high while the price sits above its 240-bar average and the
// 4-hour return is not falling — the market has based, then broken out
// with the intermediate trend behind it. It
// rides the move with a scale-out and a trailing stop, and it stays flat
// in chop and in downtrends, where breakouts fail. One clean trend trade
// a day is the whole edge; every other bar is patience.
//
// Rules (all integer math on raw price units; no floats, no clock, no random):
//   Entry  : close breaks the 90-bar high AND close is above the 240-bar
//            simple average of closes AND the 240-bar return is above
//            -50 bps (no buying breakouts in a falling 4-hour trend).
//            Full cash, one position at a time.
//   Floor  : if the bot has never traded, from bar 1080 the average and
//            return tests are dropped (one floor trade at most). This
//            guarantees at least one trade on a quiet day, which the race
//            guardrails require, without changing anything on a day that
//            trends.
//   Exits  : sell half at +150 bps from the fill price; sell the rest on
//            a trailing stop 300 bps below the highest close since entry;
//            hard stop at -150 bps; time stop after 720 bars.
//   Cooldown: 240 bars after a position fully closes.
//   max_slippage_bps is 200 on every order.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10000n;

// Entry: the breakout lookback and the trend average, in bars.
const BREAKOUT_BARS = 90;
const TREND_BARS = 240;
// Regime filter: the 240-bar return must be above this (bps).
const RET240_MIN_BPS = -50n;
// Participation floor, only while the bot has never traded.
const FLOOR_BAR = 1080;
// Exits, in bps from the fill price (trail: bps below the peak close).
const TAKE_HALF_BPS = 150n;
const TRAIL_BPS = 300n;
const STOP_BPS = -150n;
const TIME_STOP_BARS = 720;
// Cooldown after a full exit, in bars.
const COOLDOWN_BARS = 240;
const MAX_SLIPPAGE_BPS = 200;

// Closes by batch seq (index = seq). A batch with no CBBTC bar leaves a hole.
const closes: (bigint | undefined)[] = [];

// Position state, learned from fills (the fill price is the true entry).
let entryPx = 0n;
let entrySeq = -1;
let peakPx = 0n;
let soldHalf = false;
let traded = false;
let floorUsed = false;
let cooldownUntil = -1;
let pendingFloorBuy = false;

function highOfLast(seq: number, bars: number): bigint {
  let high = closes[seq - bars] as bigint;
  for (let i = seq - bars + 1; i < seq; i += 1) {
    const c = closes[i];
    if (c !== undefined && c > high) high = c;
  }
  return high;
}

function sumOfLast(seq: number, bars: number): bigint {
  let sum = 0n;
  for (let i = seq - bars + 1; i <= seq; i += 1) {
    const c = closes[i];
    if (c !== undefined) sum += c;
  }
  return sum;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // Fills first: they arrive in exactly one batch (the one after the order),
    // and that batch may itself carry no CBBTC bar, so never skip them.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL) continue;
      if (fill.side === 'buy' && fill.status === 'filled') {
        entryPx = BigInt(fill.price);
        // fill.fill_bar is the bar's timestamp, not its index: the fill
        // is reported in this batch, so this batch's seq IS the fill bar.
        entrySeq = state.seq;
        peakPx = entryPx;
        soldHalf = false;
        traded = true;
        if (pendingFloorBuy) floorUsed = true;
        pendingFloorBuy = false;
      } else if (fill.side === 'buy' && fill.status === 'rejected') {
        pendingFloorBuy = false;
      }
    }

    // Warm-up batches (if any) cannot trade; a fresh CBBTC bar is required
    // to decide anything, since a batch without one carries stale data.
    if (state.warmingUp) return [];
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);
    closes[state.seq] = close;

    const pos = state.positions.get(SYMBOL);
    const qty = pos === undefined ? 0n : pos.qty;
    const seq = state.seq;

    // ---- exits (holding a position) ----
    if (qty > 0n && entryPx > 0n) {
      // Sell half at +150 bps.
      if (!soldHalf && close * BPS >= entryPx * (BPS + TAKE_HALF_BPS)) {
        const half = qty / 2n;
        if (half > 0n) {
          soldHalf = true;
          return [{ side: 'sell', symbol: SYMBOL, qty: half, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        // Degenerate tiny position: sell it all instead.
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      // Trailing stop: 150 bps below the highest close since entry.
      if (close * BPS <= peakPx * (BPS - TRAIL_BPS)) {
        cooldownUntil = seq + COOLDOWN_BARS;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      // Hard stop at -100 bps.
      if (close * BPS <= entryPx * (BPS + STOP_BPS)) {
        cooldownUntil = seq + COOLDOWN_BARS;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      // Time stop after 720 bars.
      if (seq - entrySeq >= TIME_STOP_BARS) {
        cooldownUntil = seq + COOLDOWN_BARS;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      // No exit: the peak is the highest close since entry, and the
      // current close only counts toward it after the exit checks above.
      if (close > peakPx) peakPx = close;
      return [];
    }

    // ---- entries (flat) ----
    if (seq < cooldownUntil) return [];
    if (seq < TREND_BARS) return [];
    const high60 = highOfLast(seq, BREAKOUT_BARS);
    if (close <= high60) return [];

    // Trend filters: close above the 240-bar average, and the 240-bar
    // return above -50 bps (no buying breakouts in a falling 4-hour
    // trend). A floor trade late in the window, while the bot has never
    // traded, skips both tests.
    const isFloor = !traded && seq >= FLOOR_BAR && !floorUsed;
    if (!isFloor) {
      const sum240 = sumOfLast(seq, TREND_BARS);
      if (close * BigInt(TREND_BARS) <= sum240) return [];
      const close240 = closes[seq - TREND_BARS];
      if (close240 !== undefined && close * BPS <= close240 * (BPS + RET240_MIN_BPS)) return [];
    }

    // Full cash, one position.
    if (state.cash <= 0n) return [];
    pendingFloorBuy = isFloor;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
