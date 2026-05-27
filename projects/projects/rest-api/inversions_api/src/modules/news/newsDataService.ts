import {
  buildDefaultNewsQuery,
  type NewsDataServiceResult,
  type NewsEventKind,
  type NewsProviderDiagnostic,
  type NewsProviderId,
  type NewsQueryParams,
  type NormalizedNewsArticle
} from "./newsContract";

interface ProviderFetchResult {
  provider: NewsProviderId;
  articles: NormalizedNewsArticle[];
  diagnostic: NewsProviderDiagnostic;
}

interface YahooNewsItem {
  uuid?: string;
  title?: string;
  summary?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number;
}

interface FinnhubItem {
  id?: number;
  headline?: string;
  summary?: string;
  source?: string;
  url?: string;
  datetime?: number;
  related?: string;
}

interface NewsApiItem {
  title?: string;
  description?: string;
  content?: string;
  url?: string;
  publishedAt?: string;
  source?: { name?: string };
}

interface AlphaVantageItem {
  title?: string;
  summary?: string;
  url?: string;
  time_published?: string;
  source?: string;
  topics?: Array<{ topic?: string }>;
}

interface PolygonItem {
  id?: string;
  title?: string;
  description?: string;
  article_url?: string;
  published_utc?: string;
  publisher?: { name?: string };
  tickers?: string[];
}

interface SecCompanyTickerItem {
  cik_str: number;
  ticker: string;
  title: string;
}

const DEFAULT_PROVIDERS: NewsProviderId[] = [
  "finnhub",
  "newsapi",
  "alphaVantage",
  "polygon",
  "secEdgar",
  "cftcCot",
  "yahooFinance"
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_MIN_INTERVAL_MS = 1_000;
const cache = new Map<string, { expiresAt: number; data: NewsDataServiceResult }>();
const lastProviderCall = new Map<NewsProviderId, number>();
let secTickerCache: Map<string, SecCompanyTickerItem> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit ?? 0)) return 8;
  return Math.max(1, Math.min(30, Number(limit)));
}

function toIsoFromUnixSeconds(value?: number): string {
  return value ? new Date(value * 1000).toISOString() : nowIso();
}

function toIsoFromAlphaVantage(value?: string): string {
  if (!value) return nowIso();
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(9, 11) || "00";
  const minute = value.slice(11, 13) || "00";
  const second = value.slice(13, 15) || "00";
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
}

function detectEventKind(text: string): NewsEventKind {
  const value = text.toLowerCase();

  if (/earnings|revenue|eps|profit|guidance|quarter|q[1-4]/i.test(value)) return "EARNINGS";
  if (/inflation|cpi|fomc|fed|rates|jobs report|payroll|gdp|macro/i.test(value)) return "MACRO";
  if (/sec|filing|10-k|10-q|8-k|13f|lawsuit|probe|investigation|regulator/i.test(value)) return "REGULATORY";
  if (/institutional|fund flow|inflow|outflow|whale|block trade|hedge fund/i.test(value)) return "INSTITUTIONAL_FLOW";
  if (/open interest|put call|put-call|options volume|unusual options/i.test(value)) return "OPEN_INTEREST";
  if (/upgrade|downgrade|analyst|price target|rating/i.test(value)) return "ANALYST_RATING";
  if (/dividend|buyback|split|merger|acquisition|partnership|launch/i.test(value)) return "CORPORATE_ACTION";
  if (value.trim().length > 0) return "MARKET_NEWS";

  return "UNKNOWN";
}

function makeId(provider: NewsProviderId, symbol: string, title: string, publishedAt: string): string {
  const slug = `${provider}-${symbol}-${title}-${publishedAt}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

  return slug || `${provider}-${symbol}-${Date.now()}`;
}

function createArticle(input: {
  provider: NewsProviderId;
  symbol: string;
  title?: string;
  summary?: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  raw?: unknown;
}): NormalizedNewsArticle | null {
  const title = input.title?.trim();
  if (!title) return null;

  const summary = input.summary?.trim() || "Sin resumen disponible.";
  const publishedAt = input.publishedAt || nowIso();
  const eventKind = detectEventKind(`${title} ${summary}`);

  return {
    id: makeId(input.provider, input.symbol, title, publishedAt),
    provider: input.provider,
    symbol: input.symbol,
    title,
    summary,
    source: input.source?.trim() || input.provider,
    url: input.url?.trim() || "",
    publishedAt,
    eventKind,
    raw: input.raw
  };
}

function buildDiagnostic(
  provider: NewsProviderId,
  status: NewsProviderDiagnostic["status"],
  items: number,
  startedAt: number,
  message?: string
): NewsProviderDiagnostic {
  return {
    provider,
    status,
    items,
    elapsedMs: Date.now() - startedAt,
    message
  };
}

function canCallProvider(provider: NewsProviderId): boolean {
  const last = lastProviderCall.get(provider) ?? 0;
  return Date.now() - last >= PROVIDER_MIN_INTERVAL_MS;
}

function markProviderCall(provider: NewsProviderId): void {
  lastProviderCall.set(provider, Date.now());
}

async function fetchJson<T>(url: string, headers?: Record<string, string>, timeoutMs = 5_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": process.env.SEC_USER_AGENT ?? "InversionsPWA/0.1 dev-contact@example.com",
        ...headers
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function skipped(provider: NewsProviderId, message: string): ProviderFetchResult {
  return {
    provider,
    articles: [],
    diagnostic: {
      provider,
      status: "SKIPPED",
      items: 0,
      message,
      elapsedMs: 0
    }
  };
}

function rateLimited(provider: NewsProviderId): ProviderFetchResult {
  return {
    provider,
    articles: [],
    diagnostic: {
      provider,
      status: "RATE_LIMITED",
      items: 0,
      message: "Provider skipped by local rate-limit guard.",
      elapsedMs: 0
    }
  };
}

async function withProviderGuard(
  provider: NewsProviderId,
  run: () => Promise<NormalizedNewsArticle[]>
): Promise<ProviderFetchResult> {
  if (!canCallProvider(provider)) return rateLimited(provider);

  const startedAt = Date.now();
  markProviderCall(provider);

  try {
    const articles = await run();
    return {
      provider,
      articles,
      diagnostic: buildDiagnostic(provider, "OK", articles.length, startedAt)
    };
  } catch (error) {
    return {
      provider,
      articles: [],
      diagnostic: buildDiagnostic(
        provider,
        "ERROR",
        0,
        startedAt,
        error instanceof Error ? error.message : "Unknown provider error"
      )
    };
  }
}

async function fetchYahooFinance(query: NewsQueryParams): Promise<ProviderFetchResult> {
  const symbol = query.instrument.ticker;
  const limit = clampLimit(query.limit);

  return withProviderGuard("yahooFinance", async () => {
    const params = new URLSearchParams({
      q: symbol,
      quotesCount: "0",
      newsCount: String(limit),
      lang: "en-US",
      region: "US"
    });

    const payload = await fetchJson<{ news?: YahooNewsItem[] }>(
      `https://query2.finance.yahoo.com/v1/finance/search?${params.toString()}`
    );

    return (payload.news ?? [])
      .map((item) =>
        createArticle({
          provider: "yahooFinance",
          symbol,
          title: item.title,
          summary: item.summary,
          source: item.publisher ?? "Yahoo Finance",
          url: item.link,
          publishedAt: toIsoFromUnixSeconds(item.providerPublishTime),
          raw: item
        })
      )
      .filter((item): item is NormalizedNewsArticle => item !== null)
      .slice(0, limit);
  });
}

async function fetchFinnhub(query: NewsQueryParams): Promise<ProviderFetchResult> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return skipped("finnhub", "FINNHUB_API_KEY not configured.");

  const symbol = query.instrument.ticker;
  const from = query.periods?.from?.slice(0, 10) ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to = query.periods?.to?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  return withProviderGuard("finnhub", async () => {
    const params = new URLSearchParams({ symbol, from, to, token: apiKey });
    const payload = await fetchJson<FinnhubItem[]>(`https://finnhub.io/api/v1/company-news?${params.toString()}`);

    return payload
      .map((item) =>
        createArticle({
          provider: "finnhub",
          symbol,
          title: item.headline,
          summary: item.summary,
          source: item.source ?? "Finnhub",
          url: item.url,
          publishedAt: toIsoFromUnixSeconds(item.datetime),
          raw: item
        })
      )
      .filter((item): item is NormalizedNewsArticle => item !== null)
      .slice(0, clampLimit(query.limit));
  });
}

async function fetchNewsApi(query: NewsQueryParams): Promise<ProviderFetchResult> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return skipped("newsapi", "NEWS_API_KEY not configured.");

  const symbol = query.instrument.ticker;
  const search = query.instrument.companyName ? `${symbol} OR "${query.instrument.companyName}"` : symbol;

  return withProviderGuard("newsapi", async () => {
    const params = new URLSearchParams({
      q: search,
      language: "en",
      sortBy: "publishedAt",
      pageSize: String(clampLimit(query.limit)),
      apiKey
    });

    if (query.periods?.from) params.set("from", query.periods.from);
    if (query.periods?.to) params.set("to", query.periods.to);

    const payload = await fetchJson<{ articles?: NewsApiItem[] }>(`https://newsapi.org/v2/everything?${params.toString()}`);

    return (payload.articles ?? [])
      .map((item) =>
        createArticle({
          provider: "newsapi",
          symbol,
          title: item.title,
          summary: item.description ?? item.content,
          source: item.source?.name ?? "NewsAPI",
          url: item.url,
          publishedAt: item.publishedAt,
          raw: item
        })
      )
      .filter((item): item is NormalizedNewsArticle => item !== null);
  });
}

async function fetchAlphaVantage(query: NewsQueryParams): Promise<ProviderFetchResult> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return skipped("alphaVantage", "ALPHA_VANTAGE_API_KEY not configured.");

  const symbol = query.instrument.ticker;

  return withProviderGuard("alphaVantage", async () => {
    const params = new URLSearchParams({
      function: "NEWS_SENTIMENT",
      tickers: symbol,
      limit: String(clampLimit(query.limit)),
      apikey: apiKey
    });

    const payload = await fetchJson<{ feed?: AlphaVantageItem[] }>(
      `https://www.alphavantage.co/query?${params.toString()}`
    );

    return (payload.feed ?? [])
      .map((item) =>
        createArticle({
          provider: "alphaVantage",
          symbol,
          title: item.title,
          summary: item.summary,
          source: item.source ?? "Alpha Vantage",
          url: item.url,
          publishedAt: toIsoFromAlphaVantage(item.time_published),
          raw: item
        })
      )
      .filter((item): item is NormalizedNewsArticle => item !== null);
  });
}

async function fetchPolygon(query: NewsQueryParams): Promise<ProviderFetchResult> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return skipped("polygon", "POLYGON_API_KEY not configured.");

  const symbol = query.instrument.ticker;

  return withProviderGuard("polygon", async () => {
    const params = new URLSearchParams({
      "ticker": symbol,
      "limit": String(clampLimit(query.limit)),
      "order": "desc",
      "sort": "published_utc",
      "apiKey": apiKey
    });

    const payload = await fetchJson<{ results?: PolygonItem[] }>(`https://api.polygon.io/v2/reference/news?${params}`);

    return (payload.results ?? [])
      .map((item) =>
        createArticle({
          provider: "polygon",
          symbol,
          title: item.title,
          summary: item.description,
          source: item.publisher?.name ?? "Polygon",
          url: item.article_url,
          publishedAt: item.published_utc,
          raw: item
        })
      )
      .filter((item): item is NormalizedNewsArticle => item !== null);
  });
}

async function getSecTickerMap(): Promise<Map<string, SecCompanyTickerItem>> {
  if (secTickerCache) return secTickerCache;

  const payload = await fetchJson<Record<string, SecCompanyTickerItem>>("https://www.sec.gov/files/company_tickers.json");
  secTickerCache = new Map(
    Object.values(payload).map((item) => [item.ticker.toUpperCase(), item])
  );

  return secTickerCache;
}

async function fetchSecEdgar(query: NewsQueryParams): Promise<ProviderFetchResult> {
  const symbol = query.instrument.ticker;

  return withProviderGuard("secEdgar", async () => {
    const tickerMap = await getSecTickerMap();
    const company = tickerMap.get(symbol);
    if (!company) return [];

    const cik = String(company.cik_str).padStart(10, "0");
    const payload = await fetchJson<{
      filings?: {
        recent?: {
          accessionNumber?: string[];
          form?: string[];
          filingDate?: string[];
          primaryDocument?: string[];
        };
      };
    }>(`https://data.sec.gov/submissions/CIK${cik}.json`);

    const recent = payload.filings?.recent;
    const forms = recent?.form ?? [];
    const accession = recent?.accessionNumber ?? [];
    const dates = recent?.filingDate ?? [];
    const docs = recent?.primaryDocument ?? [];

    return forms.slice(0, clampLimit(query.limit)).map((form, index) => {
      const accessionNoDash = (accession[index] ?? "").replace(/-/g, "");
      const doc = docs[index] ?? "";
      const url = accessionNoDash && doc
        ? `https://www.sec.gov/Archives/edgar/data/${company.cik_str}/${accessionNoDash}/${doc}`
        : "";

      return createArticle({
        provider: "secEdgar",
        symbol,
        title: `${symbol} SEC filing ${form}`,
        summary: `${company.title} filed ${form} with SEC EDGAR.`,
        source: "SEC EDGAR",
        url,
        publishedAt: dates[index] ? new Date(`${dates[index]}T00:00:00Z`).toISOString() : nowIso(),
        raw: { form, accession: accession[index], filingDate: dates[index], primaryDocument: doc }
      });
    }).filter((item): item is NormalizedNewsArticle => item !== null);
  });
}

async function fetchCftcCot(query: NewsQueryParams): Promise<ProviderFetchResult> {
  const enabled = process.env.CFTC_COT_ENABLED === "true";
  if (!enabled) return skipped("cftcCot", "CFTC_COT_ENABLED is not true. Enable only when instrument mapping is configured.");

  const symbol = query.instrument.ticker;

  return withProviderGuard("cftcCot", async () => {
    const params = new URLSearchParams({
      "$limit": String(clampLimit(query.limit)),
      "$order": "report_date_as_yyyy_mm_dd DESC"
    });

    const payload = await fetchJson<Array<Record<string, string>>>(
      `https://publicreporting.cftc.gov/resource/6dca-aqww.json?${params.toString()}`
    );

    return payload
      .map((item, index) =>
        createArticle({
          provider: "cftcCot",
          symbol,
          title: `${symbol} CFTC COT context ${index + 1}`,
          summary: `CFTC COT market context: ${item.market_and_exchange_names ?? "unknown market"}.`,
          source: "CFTC COT",
          url: "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
          publishedAt: item.report_date_as_yyyy_mm_dd
            ? new Date(`${item.report_date_as_yyyy_mm_dd}T00:00:00Z`).toISOString()
            : nowIso(),
          raw: item
        })
      )
      .filter((item): item is NormalizedNewsArticle => item !== null);
  });
}

function buildDemoNews(query: NewsQueryParams): NormalizedNewsArticle[] {
  const symbol = query.instrument.ticker;
  const now = Date.now();
  const templates = [
    {
      title: `${symbol} reports stronger revenue growth and positive market momentum`,
      summary: "Fallback demo: noticia positiva para validar el motor cuando las fuentes externas no responden.",
      eventKind: "EARNINGS" as NewsEventKind,
      offset: 1
    },
    {
      title: `${symbol} faces volatility as investors monitor economic risks`,
      summary: "Fallback demo: noticia negativa/mixta para probar sensibilidad del clasificador.",
      eventKind: "MACRO" as NewsEventKind,
      offset: 2
    },
    {
      title: `Analysts remain cautious but see upside potential for ${symbol}`,
      summary: "Fallback demo: noticia de analistas con sentimiento mixto.",
      eventKind: "ANALYST_RATING" as NewsEventKind,
      offset: 3
    }
  ];

  return templates.map((item) => ({
    id: makeId("demoFallback", symbol, item.title, String(item.offset)),
    provider: "demoFallback",
    symbol,
    title: item.title,
    summary: item.summary,
    source: "DEMO-FALLBACK",
    url: "",
    publishedAt: new Date(now - item.offset * 60 * 60 * 1000).toISOString(),
    eventKind: item.eventKind
  }));
}

function deduplicateArticles(articles: NormalizedNewsArticle[]): NormalizedNewsArticle[] {
  const seen = new Set<string>();
  const result: NormalizedNewsArticle[] = [];

  for (const article of articles) {
    const titleKey = article.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = article.url || titleKey;

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(article);
  }

  return result;
}

function makeCacheKey(query: NewsQueryParams): string {
  return JSON.stringify({
    ticker: query.instrument.ticker,
    companyName: query.instrument.companyName ?? "",
    providers: query.providers ?? DEFAULT_PROVIDERS,
    limit: clampLimit(query.limit),
    from: query.periods?.from ?? "",
    to: query.periods?.to ?? ""
  });
}

async function runProvider(provider: NewsProviderId, query: NewsQueryParams): Promise<ProviderFetchResult> {
  switch (provider) {
    case "finnhub":
      return fetchFinnhub(query);
    case "newsapi":
      return fetchNewsApi(query);
    case "alphaVantage":
      return fetchAlphaVantage(query);
    case "polygon":
      return fetchPolygon(query);
    case "secEdgar":
      return fetchSecEdgar(query);
    case "cftcCot":
      return fetchCftcCot(query);
    case "yahooFinance":
      return fetchYahooFinance(query);
    case "demoFallback": {
      const articles = buildDemoNews(query);
      return {
        provider,
        articles,
        diagnostic: {
          provider,
          status: "FALLBACK",
          items: articles.length,
          message: "Demo fallback generated locally.",
          elapsedMs: 0
        }
      };
    }
  }
}

export async function fetchNewsData(query: NewsQueryParams): Promise<NewsDataServiceResult> {
  const cleanQuery: NewsQueryParams = {
    ...query,
    instrument: {
      ...query.instrument,
      ticker: query.instrument.ticker.trim().toUpperCase()
    },
    limit: clampLimit(query.limit),
    includeFallback: query.includeFallback ?? true
  };

  const cacheKey = makeCacheKey(cleanQuery);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.data,
      fromCache: true
    };
  }

  const providers = cleanQuery.providers?.length ? cleanQuery.providers : DEFAULT_PROVIDERS;
  const providerResults = await Promise.all(providers.map((provider) => runProvider(provider, cleanQuery)));

  let articles = deduplicateArticles(providerResults.flatMap((result) => result.articles))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, cleanQuery.limit);

  const diagnostics = providerResults.map((result) => result.diagnostic);

  if (articles.length === 0 && cleanQuery.includeFallback) {
    const fallback = await runProvider("demoFallback", cleanQuery);
    articles = fallback.articles;
    diagnostics.push(fallback.diagnostic);
  }

  const data: NewsDataServiceResult = {
    query: cleanQuery,
    articles,
    diagnostics,
    fromCache: false,
    generatedAt: nowIso()
  };

  cache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    data
  });

  return data;
}

export async function fetchNewsForSymbol(symbol: string, limit = 8): Promise<NormalizedNewsArticle[]> {
  const result = await fetchNewsData(buildDefaultNewsQuery(symbol, limit));
  return result.articles;
}
