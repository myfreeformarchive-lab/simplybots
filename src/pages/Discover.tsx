import { useCallback, useEffect, useMemo, useState } from "react";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { Download, ExternalLink, Flame, RefreshCw } from "lucide-react";

type BoostMode = "latest" | "top";

type BoostedToken = {
  url: string;
  chainId: string;
  tokenAddress: string;
  amount?: number;
  totalAmount?: number;
  icon?: string;
  header?: string;
  openGraph?: string;
  description?: string;
};

type TokenPair = {
  chainId: string;
  dexId: string;
  url: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  baseToken?: { address?: string; symbol?: string; name?: string };
  info?: { imageUrl?: string };
};

type TokenViewModel = {
  tokenAddress: string;
  dexUrl: string | null;
  symbol: string | null;
  marketCap: number | null;
  imageUrl: string | null;
  boostsActive: number | null;
  boostsTotal: number | null;
};

const formatCompactUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);

const shorten = (value: string, left = 4, right = 4) => {
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
};

const isHttpUrl = (value: string) => value.startsWith("http://") || value.startsWith("https://");

const toHttpImageUrl = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isHttpUrl(trimmed)) return trimmed;
  if (trimmed.startsWith("ipfs://")) {
    const cidPath = trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
    return `https://ipfs.io/ipfs/${cidPath}`;
  }
  return trimmed;
};

const normalizeAddress = (value: string) => value.trim().toLowerCase();

const fetchBoosts = async (mode: BoostMode) => {
  const endpoint =
    mode === "top"
      ? "https://api.dexscreener.com/token-boosts/top/v1"
      : "https://api.dexscreener.com/token-boosts/latest/v1";

  const res = await fetch(endpoint);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Dexscreener boosts request failed (${res.status}) ${body}`.trim());
  }
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) return [];
  return json as BoostedToken[];
};

const fetchTokenPairs = async (tokenAddresses: string[]) => {
  if (tokenAddresses.length === 0) return [];
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddresses.map(encodeURIComponent).join(",")}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Dexscreener token request failed (${res.status}) ${body}`.trim());
  }
  const json = (await res.json()) as unknown;
  const record = json as { pairs?: unknown };
  if (!record || typeof record !== "object" || !Array.isArray(record.pairs)) return [];
  return record.pairs as TokenPair[];
};

const chunk = <T,>(items: T[], size: number) => {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export default function Discover() {
  const [mode, setMode] = useState<BoostMode>("latest");
  const [items, setItems] = useState<TokenViewModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const lastUpdated = useMemo(() => {
    if (lastFetchAt == null) return null;
    const diffMs = nowMs - lastFetchAt;
    const diffMin = Math.max(0, Math.round(diffMs / 60000));
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d ago`;
  }, [lastFetchAt, nowMs]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const downloadSeedCommand = () => {
    const addresses = items.map((t) => t.tokenAddress).filter(Boolean);
    const lines: string[] = [];
    for (let i = 0; i < addresses.length; i += 20) {
      const batch = addresses.slice(i, i + 20);
      lines.push(`/seedglobal ${batch.join(",")}`);
    }
    const text = `${lines.join("\n")}\n`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `seedglobal-${mode}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const cacheKey = `simplybots:discover:v1:${mode}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as unknown;
        const record = parsed as { items?: unknown; fetchedAt?: unknown };
        if (Array.isArray(record.items)) setItems(record.items as TokenViewModel[]);
        if (typeof record.fetchedAt === "number" && Number.isFinite(record.fetchedAt)) {
          setLastFetchAt(record.fetchedAt);
        }
      }

      const boosts = await fetchBoosts(mode);
      const solanaBoosts = boosts.filter((t) => t.chainId === "solana" && t.tokenAddress);

      const uniqueAddresses: string[] = [];
      const seen = new Set<string>();
      for (const t of solanaBoosts) {
        const key = normalizeAddress(t.tokenAddress);
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueAddresses.push(t.tokenAddress);
      }

      const pairsByToken = new Map<string, TokenPair[]>();
      const batches = chunk(uniqueAddresses.slice(0, 60), 30);
      for (const batch of batches) {
        const pairs = await fetchTokenPairs(batch);
        for (const p of pairs) {
          const address = p.baseToken?.address;
          if (!address) continue;
          const key = normalizeAddress(address);
          const list = pairsByToken.get(key) ?? [];
          list.push(p);
          pairsByToken.set(key, list);
        }
      }

      const byAddressBoost = new Map<string, BoostedToken>();
      for (const t of solanaBoosts) {
        const key = normalizeAddress(t.tokenAddress);
        if (!byAddressBoost.has(key)) byAddressBoost.set(key, t);
      }

      const viewModels: TokenViewModel[] = uniqueAddresses.slice(0, 60).map((addr) => {
        const key = normalizeAddress(addr);
        const boost = byAddressBoost.get(key) ?? null;
        const pairs = pairsByToken.get(key) ?? [];
        const best =
          pairs.length === 0
            ? null
            : pairs.reduce((acc, cur) => {
                const accLiq = acc.liquidity?.usd ?? 0;
                const curLiq = cur.liquidity?.usd ?? 0;
                return curLiq > accLiq ? cur : acc;
              }, pairs[0]);

        const imageUrlRaw =
          best?.info?.imageUrl ??
          (boost?.icon && isHttpUrl(boost.icon) ? boost.icon : null) ??
          boost?.openGraph ??
          boost?.header ??
          null;

        const rawAmount =
          typeof boost?.amount === "number" && Number.isFinite(boost.amount) ? boost.amount : null;
        const rawTotal =
          typeof boost?.totalAmount === "number" && Number.isFinite(boost.totalAmount)
            ? boost.totalAmount
            : null;
        const boostsActive = rawAmount ?? rawTotal;
        const boostsTotal = rawAmount == null ? null : rawTotal;

        return {
          tokenAddress: addr,
          dexUrl: best?.url ?? boost?.url ?? null,
          symbol: best?.baseToken?.symbol ?? null,
          marketCap:
            typeof best?.marketCap === "number" && Number.isFinite(best.marketCap)
              ? best.marketCap
              : typeof best?.fdv === "number" && Number.isFinite(best.fdv)
                ? best.fdv
                : null,
          imageUrl: toHttpImageUrl(imageUrlRaw),
          boostsActive,
          boostsTotal,
        };
      });

      setItems(viewModels);
      setLastFetchAt(Date.now());
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ items: viewModels, fetchedAt: Date.now() }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load boosted tokens.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="min-h-screen bg-black text-white selection:bg-solana-purple/30 selection:text-white">
      <Navbar />

      <section className="pt-24 pb-24">
        <div className="w-full px-3 sm:px-6 lg:px-8">
          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold">Discover</h1>
            <p className="text-gray-400 mt-2 max-w-2xl">
              Boosted tokens on Solana from Dexscreener.
            </p>
          </div>

          <div className="glass-card border border-white/10 rounded-2xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 text-white font-bold">
                <Flame className="w-4 h-4 text-banana" />
                Boosted Tokens
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
                  <button
                    type="button"
                    onClick={() => setMode("latest")}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      mode === "latest" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Latest
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("top")}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      mode === "top" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    Top
                  </button>
                </div>
                <button
                  type="button"
                  onClick={load}
                  disabled={isLoading}
                  className="h-8 px-3 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                  <span className="text-xs font-bold">Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={downloadSeedCommand}
                  disabled={items.length === 0}
                  aria-label="Download"
                  className="h-8 px-2 sm:px-3 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5"
                >
                  <Download className="w-4 h-4" />
                  <span className="sr-only sm:not-sr-only text-xs font-bold">Download</span>
                </button>
              </div>
            </div>

            {error ? (
              <p className="text-sm text-red-400">{error}</p>
            ) : isLoading && items.length === 0 ? (
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <div
                    key={`sk-${idx}`}
                    className="rounded-xl border border-white/5 bg-white/5 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded bg-white/10" />
                        <div className="h-4 w-24 rounded bg-white/10" />
                      </div>
                      <div className="h-4 w-16 rounded bg-white/10" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <div className="space-y-2">
                  {items.map((t) => (
                    <div
                      key={t.tokenAddress}
                      className="rounded-xl border border-white/5 bg-white/5 px-3 py-2"
                    >
                      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3">
                        <div className="h-9 w-9 rounded-lg bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center">
                          {t.imageUrl ? (
                            <img
                              src={t.imageUrl}
                              alt={t.symbol ?? t.tokenAddress}
                              className="h-full w-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="text-xs text-gray-500">—</span>
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-white truncate">
                              {t.symbol ?? shorten(t.tokenAddress, 6, 6)}
                            </span>
                            {t.dexUrl ? (
                              <a
                                href={t.dexUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-white/50 hover:text-white transition-colors"
                                title="Open on Dexscreener"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-xs text-gray-400 tabular-nums truncate">
                            {t.tokenAddress}
                          </div>
                        </div>

                        <div className="justify-self-end text-right">
                          <div className="text-sm font-bold text-banana tabular-nums">
                            {t.marketCap == null ? "—" : formatCompactUsd(t.marketCap)}
                          </div>
                          <div className="text-xs text-gray-400 tabular-nums">
                            Boosts{" "}
                            {t.boostsActive == null ? "—" : t.boostsActive}
                            {t.boostsTotal == null ? "" : ` / ${t.boostsTotal}`}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {items.length === 0 ? (
                    <p className="text-sm text-gray-400">No boosted Solana tokens found.</p>
                  ) : null}
                </div>

                <div className="mt-4 text-xs text-gray-500 text-right">
                  {lastUpdated ? `Updated ${lastUpdated}` : "Updated just now"}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
