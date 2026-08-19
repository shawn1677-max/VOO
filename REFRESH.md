# Refresh procedure

This is the exact sequence a scheduled session runs to update the dashboard with
fresh brokerage and market data, then republish it. It is written to be followed
top-to-bottom with no prior context.

**Account:** individual margin account `5QW21765` (self-directed).
**Artifact URL (update in place — do not create a new one):**
`https://claude.ai/code/artifact/7bbfa82e-1018-458f-9e40-a0079da95675`
**Branch:** `claude/voo-investment-dashboard-2nc0iv` (the repo's default branch, so a
fresh clone is already on it).

## 1. Re-fetch the source payloads

Call these Robinhood MCP tools and overwrite the matching file in `scripts/raw/`.
Keep the same JSON shape already in each file — only the values change. Pass the
account number `5QW21765` explicitly wherever a tool needs it.

| File | Tool | Arguments |
|---|---|---|
| `quotes.json` | `get_equity_quotes` | symbols `VOO SPY QQQ BND VTI` |
| `tax-lots.json` | `get_equity_tax_lots` | account `5QW21765`, symbol `VOO` (page through all lots) |
| `orders.json` | `get_equity_orders` | account `5QW21765`, symbol `VOO`, state `filled` |
| `fundamentals.json` | `get_equity_fundamentals` | symbols `VOO` |
| `positions.json` | `get_equity_positions` | account `5QW21765` (keep only the VOO row) |
| `historicals-monthly.json` | `get_equity_historicals` | symbols `VOO SPY QQQ BND VTI`, interval `month`, from `2010-08-01` |
| `historicals-daily.json` | `get_equity_historicals` | symbol `VOO`, interval `day`, trailing ~15 months |
| `portfolio.json` | `get_portfolio` (×3 accounts) | one call per account: `5QW21765`, `181931349615`, `892209883`. Combine into the `accounts` array — see the committed file's shape. `asOf` is the VOO quote time. |
| `pnl-history.json` | `get_pnl_trade_history` | account `106217656` (the individual account's rhs number), span `all`. Keep the `data.trades` array verbatim. |

Each raw file keeps only the fields `scripts/build-data.mjs` reads. Match the trimming
already in the committed files (e.g. historicals keep `begins_at`, `close_price`,
`interpolated` per bar). If a tool returns more, trim to that shape before saving.

The portfolio overview (allocation, accounts, realized-trade history) is rebuilt from
`portfolio.json` and `pnl-history.json`. If the account holdings have changed materially
— a new equity beyond VOO, options, etc. — the overview will still render, but its panels
were designed around an all-VOO book; flag it in the session so the layout can be revisited
rather than silently misrepresenting a diversified portfolio. The specific crypto coin is
not exposed by any available tool, so it stays labelled "Crypto".

If any fetch fails — most likely the Robinhood connector is not authenticated in an
unattended run — STOP. Do not rebuild from stale data and do not publish. Leave a
one-line note in the session so the failure is visible, and end. The existing
dashboard stays as the last good version.

## 2. Rebuild

```sh
node scripts/build-data.mjs   # scripts/raw/*.json -> data/dataset.json
node scripts/build-html.mjs   # + src/dashboard.html -> index.html, dist/artifact.html
```

`build-data.mjs` prints a one-line summary (buy count, bar counts, VOO price). Sanity-check
it: share count and price should be plausible and non-zero.

## 3. Republish the artifact

Publish `dist/artifact.html` with the Artifact tool, passing the existing URL above as
`url` so it updates in place and keeps the same link. Keep `favicon` `📈` and
`capabilities` `{"downloads": true}`.

## 4. Commit and push

Only if the data actually changed (`git status` shows a diff):

```sh
git add data/dataset.json dist/artifact.html index.html scripts/raw
git commit -m "Refresh VOO data (<capture date>)"
git push origin claude/voo-investment-dashboard-2nc0iv
```

If nothing changed (e.g. fired on a market holiday), skip the commit — do not push an
empty change.
