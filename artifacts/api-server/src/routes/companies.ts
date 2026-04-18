import { Router } from "express";
import * as cheerio from "cheerio";
import { logger } from "../lib/logger";

const router = Router();

const BASE = "https://www.screener.in";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/json,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.screener.in/",
};

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/[\s\u00a0]+/g, " ").trim();
}

function parseNum(s: string | null | undefined): number | undefined {
  const n = parseFloat((s ?? "").replace(/[,%\s₹]/g, ""));
  return isNaN(n) ? undefined : n;
}

function extractTableRows(
  $: cheerio.CheerioAPI,
  sectionId: string
): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  const section = $(`#${sectionId}`);
  if (!section.length) return result;

  section.find("table tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    const label = clean(cells.first().text());
    if (!label) return;
    const values: number[] = [];
    cells.each((i, td) => {
      if (i === 0) return;
      const n = parseNum($(td).text());
      if (n !== undefined) values.push(n);
    });
    if (values.length > 0) result[label] = values;
  });
  return result;
}

function extractTableYears(
  $: cheerio.CheerioAPI,
  sectionId: string
): string[] {
  const years: string[] = [];
  $(`#${sectionId} table thead tr th`).each((i, th) => {
    if (i === 0) return;
    const txt = clean($(th).text());
    if (txt) years.push(txt);
  });
  return years;
}

async function searchScreener(q: string) {
  const url = `${BASE}/api/company/search/?q=${encodeURIComponent(q)}&v=3`;
  const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
  if (!resp.ok) throw new Error(`Screener returned ${resp.status}`);
  const raw = (await resp.json()) as Array<{ id?: number; name?: string; url?: string }>;
  return raw
    .filter((r) => r.name && r.url)
    .map((r) => {
      const parts = (r.url ?? "").split("/").filter(Boolean);
      const ticker = parts[1] ?? "";
      return { ticker, name: r.name!, exchange: "NSE/BSE" };
    })
    .filter((r) => r.ticker && r.ticker !== "id" && r.ticker.length > 0)
    .slice(0, 8);
}

async function searchNSE(q: string) {
  const url = `https://scanresults.nseindia.com/search/companySearch?searchText=${encodeURIComponent(q)}`;
  const resp = await fetch(url, {
    headers: { ...HEADERS, Referer: "https://www.nseindia.com/" },
    signal: AbortSignal.timeout(6000),
  });
  if (!resp.ok) throw new Error(`NSE returned ${resp.status}`);
  const raw = (await resp.json()) as Array<{ companyName?: string; symbol?: string }>;
  return raw
    .filter((r) => r.companyName && r.symbol)
    .map((r) => ({ ticker: r.symbol!, name: r.companyName!, exchange: "NSE" }))
    .slice(0, 8);
}

router.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 2) return res.json([]);

  // Try Screener first, fall back to NSE
  try {
    const results = await searchScreener(q);
    if (results.length > 0) return res.json(results);
  } catch (err) {
    logger.warn({ err }, "Screener search failed, trying NSE fallback");
  }

  try {
    const results = await searchNSE(q);
    return res.json(results);
  } catch (err) {
    logger.error({ err }, "All company search sources failed");
    return res.status(502).json({ error: "Failed to search companies" });
  }
});

router.get("/data", async (req, res) => {
  const ticker = String(req.query.ticker ?? "").trim();
  if (!ticker) return res.status(400).json({ error: "ticker is required" });

  const slug = ticker.replace(/\.(NS|BO)$/i, "").toUpperCase();

  try {
    const pageUrl = `${BASE}/company/${slug}/consolidated/`;
    const resp = await fetch(pageUrl, { headers: HEADERS });
    if (!resp.ok) {
      const altUrl = `${BASE}/company/${slug}/`;
      const alt = await fetch(altUrl, { headers: HEADERS });
      if (!alt.ok) throw new Error(`Screener returned ${resp.status}`);
      const html = await alt.text();
      return res.json(await parseScreenerPage(html, ticker, altUrl));
    }
    const html = await resp.text();
    return res.json(await parseScreenerPage(html, ticker, pageUrl));
  } catch (err) {
    logger.error({ err, ticker }, "Company data fetch failed");
    return res.status(502).json({ error: "Failed to fetch company data" });
  }
});

async function parseScreenerPage(
  html: string,
  ticker: string,
  pageUrl: string
) {
  const $ = cheerio.load(html);

  const name =
    clean($("h1.h2").first().text()) ||
    clean($("h1").first().text()) ||
    ticker;

  const about = clean($(".company-profile p").first().text()) ||
    clean($("#about p").first().text()) ||
    clean($(".sub.text").first().text());

  let sector: string | undefined;
  let industry: string | undefined;
  $(".company-profile .company-links a, .company-links a").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const text = clean($(a).text());
    if (href.includes("/industries/")) industry = text;
    else if (href.includes("/screen/")) sector = sector ?? text;
  });

  const ratios: Record<string, number | undefined> = {};
  $("#top-ratios li").each((_, li) => {
    const label = clean($(li).find(".name").text()).toLowerCase();
    const val = parseNum($(li).find(".number").first().text());
    if (label.includes("market cap")) ratios.marketCap = val;
    else if (label.includes("current price")) ratios.currentPrice = val;
    else if (label === "stock p/e" || label === "p/e") ratios.peRatio = val;
    else if (label.includes("book value")) ratios.bookValue = val;
    else if (label.includes("dividend yield")) ratios.dividendYield = val;
    else if (label.includes("roce")) ratios.roce = val;
    else if (label.includes("roe")) ratios.roe = val;
    else if (label.includes("face value")) ratios.faceValue = val;
  });

  const plYears = extractTableYears($, "profit-loss");
  const plRows = extractTableRows($, "profit-loss");
  const bsYears = extractTableYears($, "balance-sheet");
  const bsRows = extractTableRows($, "balance-sheet");

  const salesKey = Object.keys(plRows).find(
    (k) => k.toLowerCase().includes("sales") || k.toLowerCase().includes("revenue")
  );
  const profitKey = Object.keys(plRows).find(
    (k) => k.toLowerCase() === "net profit" || k.toLowerCase().includes("net profit")
  );
  const ebitdaKey = Object.keys(plRows).find(
    (k) => k.toLowerCase().includes("operating profit")
  );
  const assetsKey = Object.keys(bsRows).find(
    (k) => k.toLowerCase().includes("total assets")
  );
  const debtKey = Object.keys(bsRows).find(
    (k) => k.toLowerCase() === "borrowings" || k.toLowerCase().includes("borrowing")
  );

  const totalCols = plYears.length;
  const startIdx = Math.max(0, totalCols - 5);
  const recentYears = plYears.slice(startIdx);
  const financialHistory = recentYears.map((year, ri) => {
    const i = startIdx + ri;
    return {
      year: year.replace("Mar ", "").trim(),
      revenue: salesKey ? plRows[salesKey]?.[i] : undefined,
      ebitda: ebitdaKey ? plRows[ebitdaKey]?.[i] : undefined,
      netProfit: profitKey ? plRows[profitKey]?.[i] : undefined,
      totalAssets: assetsKey ? bsRows[assetsKey]?.[i] : undefined,
      totalDebt: debtKey ? bsRows[debtKey]?.[i] : undefined,
      cash: undefined as number | undefined,
    };
  }).reverse();

  const lastIdx = totalCols - 1;
  const latestRevenue = salesKey ? plRows[salesKey]?.[lastIdx] : undefined;
  const prevRevenue = salesKey ? plRows[salesKey]?.[lastIdx - 1] : undefined;
  const latestProfit = profitKey ? plRows[profitKey]?.[lastIdx] : undefined;
  const latestRevForMargin =
    latestRevenue && latestRevenue !== 0 ? latestRevenue : undefined;

  const netMargin =
    latestProfit != null && latestRevForMargin != null
      ? Math.round((latestProfit / latestRevForMargin) * 10000) / 100
      : undefined;
  const revenueGrowth =
    prevRevenue != null && prevRevenue !== 0 && latestRevenue != null
      ? Math.round(((latestRevenue - prevRevenue) / prevRevenue) * 10000) / 100
      : undefined;

  return {
    ticker,
    name,
    exchange: "NSE/BSE",
    sector,
    industry,
    website: undefined,
    description: about || undefined,
    employees: undefined,
    marketCap: ratios.marketCap,
    currentPrice: ratios.currentPrice,
    peRatio: ratios.peRatio,
    pbRatio:
      ratios.bookValue && ratios.currentPrice
        ? Math.round((ratios.currentPrice / ratios.bookValue) * 100) / 100
        : undefined,
    debtToEquity: undefined,
    currentRatio: undefined,
    returnOnEquity: ratios.roe,
    returnOnAssets: undefined,
    revenueGrowth,
    grossMargin: undefined,
    ebitdaMargin: undefined,
    netProfitMargin: netMargin,
    financialHistory,
    dataSource: "Screener.in (NSE/BSE public filings)",
    fetchedAt: new Date().toISOString(),
  };
}

export default router;
