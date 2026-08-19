#!/usr/bin/env node
// Converts raw Robinhood MCP tool payloads (scripts/raw/*.json) into the compact
// dataset the dashboard embeds. Re-run after refreshing the raw payloads.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (n) => JSON.parse(readFileSync(join(root, 'scripts', 'raw', n), 'utf8'));

const bars = (payload, symbol) => {
  const r = payload.data.results.find((x) => x.symbol === symbol);
  if (!r) throw new Error(`no bars for ${symbol}`);
  return r.bars
    .filter((b) => !b.interpolated)
    .map((b) => [b.begins_at.slice(0, 10), Number(Number(b.close_price).toFixed(2))]);
};

const monthly = raw('historicals-monthly.json');
const daily = raw('historicals-daily.json');
const quotes = raw('quotes.json');
const lots = raw('tax-lots.json');
const orders = raw('orders.json');
const fundamentals = raw('fundamentals.json');
const position = raw('positions.json');
const portfolioRaw = raw('portfolio.json');
const pnl = raw('pnl-history.json');

const SYMBOLS = ['VOO', 'SPY', 'QQQ', 'BND', 'VTI'];
const quote = (s) => {
  const q = quotes.data.results.find((x) => x.quote.symbol === s);
  return {
    price: Number(q.quote.last_trade_price),
    prevClose: Number(q.quote.adjusted_previous_close),
    asOf: q.quote.venue_last_trade_time,
  };
};

// Monthly closes, with the live quote appended as the in-progress month.
const monthlySeries = {};
for (const s of SYMBOLS) {
  const series = bars(monthly, s).map(([d, c]) => [d.slice(0, 7), c]);
  const q = quote(s);
  const nowMonth = q.asOf.slice(0, 7);
  if (series.at(-1)[0] !== nowMonth) series.push([nowMonth, Number(q.price.toFixed(2))]);
  else series.at(-1)[1] = Number(q.price.toFixed(2));
  monthlySeries[s] = series;
}

const vooDaily = bars(daily, 'VOO');
const vq = quote('VOO');
const today = vq.asOf.slice(0, 10);
if (vooDaily.at(-1)[0] !== today) vooDaily.push([today, Number(vq.price.toFixed(2))]);
else vooDaily.at(-1)[1] = Number(vq.price.toFixed(2));

// Buy lots, oldest first. Cost basis comes from the tax lot; the matching filled
// order supplies the execution price and whether it was placed by the recurring plan.
const orderByDate = new Map();
for (const o of orders.data.orders) {
  if (o.state !== 'filled' || o.side !== 'buy') continue;
  orderByDate.set(`${o.last_transaction_at.slice(0, 10)}|${Number(o.cumulative_quantity).toFixed(6)}`, o);
}
const buys = lots.data.tax_lots
  .map((l) => {
    const shares = Number(l.quantity);
    const o = orderByDate.get(`${l.open_date}|${shares.toFixed(6)}`);
    return {
      date: l.open_date,
      shares,
      pricePerShare: Number(l.cost_per_share),
      cost: Number(l.tax_cost_basis),
      source: o ? o.placed_agent : 'user',
      lotId: l.open_lot_id,
    };
  })
  .sort((a, b) => a.date.localeCompare(b.date));

const f = fundamentals.data.results[0];
const pos = position.data.positions.find((p) => p.symbol === 'VOO');

// ---- Whole-portfolio overview ----
// VOO's live value is recomputed in the browser from shares x price, so it is
// NOT baked in here; only the non-VOO snapshot amounts (crypto, cash) are, plus
// the account list and the realized-trade history behind the current all-VOO book.
const round2 = (n) => Number(n.toFixed(2));
const accounts = portfolioRaw.accounts.map((a) => ({
  name: a.name, type: a.type, masked: a.masked,
  total: round2(a.total_value), equity: round2(a.equity_value),
  crypto: round2(a.crypto_value), cash: round2(a.cash),
}));
const cryptoValue = round2(accounts.reduce((s, a) => s + a.crypto, 0));
const cashValue = round2(accounts.reduce((s, a) => s + a.cash, 0));

const bySymbol = new Map();
for (const t of pnl.data.trades) {
  const g = bySymbol.get(t.symbol) || { symbol: t.symbol, gain: 0, trades: 0, lastDate: '' };
  g.gain += Number(t.realized_gain);
  g.trades += 1;
  if (t.timestamp > g.lastDate) g.lastDate = t.timestamp;
  bySymbol.set(t.symbol, g);
}
const realizedBySymbol = [...bySymbol.values()]
  .map((g) => ({ ...g, gain: round2(g.gain), lastDate: g.lastDate.slice(0, 10) }))
  .sort((a, b) => b.gain - a.gain);
const realizedTotal = round2(realizedBySymbol.reduce((s, g) => s + g.gain, 0));
const realizedTrades = pnl.data.trades
  .map((t) => ({ date: t.timestamp.slice(0, 10), symbol: t.symbol, side: t.side,
                 qty: Number(t.quantity), price: round2(Number(t.price)), gain: Number(t.realized_gain) }))
  .sort((a, b) => b.date.localeCompare(a.date));

const out = {
  generatedAt: vq.asOf,
  quote: Object.fromEntries(SYMBOLS.map((s) => [s, quote(s)])),
  monthly: monthlySeries,
  vooDaily,
  buys,
  position: {
    shares: Number(pos.quantity),
    averageCost: Number(pos.average_buy_price),
  },
  fund: {
    dividendYield: Number(f.dividend_yield),
    dividendPerShare: Number(f.dividend_per_share),
    frequency: f.distribution_frequency,
    exDividendDate: f.ex_dividend_date,
    peRatio: Number(f.pe_ratio),
    pbRatio: Number(f.pb_ratio),
    high52: Number(f.high_52_weeks),
    low52: Number(f.low_52_weeks),
    high52Date: f.high_52_weeks_date,
    low52Date: f.low_52_weeks_date,
    expenseRatio: 0.0003, // Vanguard published VOO expense ratio; not exposed by the API
    marketDate: f.market_date,
  },
  portfolio: {
    asOf: portfolioRaw.asOf,
    accounts,
    crypto: cryptoValue,
    cash: cashValue,
    snapshotEquity: round2(accounts.reduce((s, a) => s + a.equity, 0)),
    realized: {
      total: realizedTotal,
      tradeCount: realizedTrades.length,
      bySymbol: realizedBySymbol,
      trades: realizedTrades,
    },
  },
};

writeFileSync(join(root, 'data', 'dataset.json'), JSON.stringify(out));
console.log(
  `dataset.json: ${buys.length} buys, ${vooDaily.length} daily bars, ` +
  `${monthlySeries.VOO.length} monthly bars, VOO $${vq.price}`
);
