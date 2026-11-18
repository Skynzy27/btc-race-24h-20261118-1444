[![make.fun](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Skynzy27/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Skynzy27/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)

# btc-race-24h-20261118-1444

A momentum breakout bot for the [BTC 24h race on make.fun](https://make.fun/bounty/btc-race-24h-20261118-1444). It trades cbBTC/USDC on 1-minute bars with a paper $1,000 start, long only.

## Strategy

This bot never buys a dip. It buys strength: a close that breaks the 60-bar high while the price sits above its 240-bar average — the market has based, then broken out with the intermediate trend behind it. It rides the move with a scale-out and a trailing stop, and stays flat in chop and in downtrends, where breakouts fail. One clean trend trade a day is the whole edge; every other bar is patience.

- **Entry:** close breaks the 90-bar high AND close is above the 240-bar average of closes AND the 240-bar return is above −50 bps (no buying breakouts in a falling 4-hour trend). Full cash, one position at a time.
- **Participation floor:** if the bot has never traded, from bar 1080 the average and return tests are dropped (at most one floor trade), so a quiet day still produces the ≥1 trade the race guardrails require.
- **Exits:** sell half at +150 bps from the fill price; sell the rest on a trailing stop 300 bps below the highest close since entry; hard stop at −150 bps; time stop after 720 bars. 240-bar cooldown after a full exit.
- **Deterministic:** all integer (bigint) math, no floats, no clock, no randomness — two runs reproduce byte for byte.

## Dev result

Graded locally on the frozen dev window (`grade-local`, process driver):

| | |
|---|---|
| Net PnL | **+$10.67** on $1,000 start |
| Trades | 3 fills (1 round trip, win rate 100%) |
| Max drawdown | 0.80% |
| Net PnL at 2× fees | +$9.87 |

For comparison, on the same dev window the previous dip-buy entry scored +$1.02 — this breakout design beats it by an order of magnitude, with a completely different signal (it buys new highs, never dips).

## Run

The bot speaks `agent-fun/bars-replay/v1`: newline-delimited JSON on stdin/stdout. The kit's `vendor/makefun-bars.ts` is a byte-identical copy of the kit SDK shim. Run it with Node 22:

```
node main.ts
```
