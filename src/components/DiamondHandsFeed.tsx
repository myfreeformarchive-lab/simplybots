import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ChevronLeft, ChevronRight, Diamond, ExternalLink } from "lucide-react";

type DiamondHandBuy = {
  createdAt: string | null;
  symbol: string | null;
  buyer: string | null;
  solSpent: number | null;
  usdValue: number | null;
  txSig: string | null;
};

const getNumber = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getString = (value: unknown) => (typeof value === "string" ? value : null);

const shorten = (value: string, left = 4, right = 4) => {
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
};

const formatUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

const formatSol = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const buildTxUrl = (txSig: string) =>
  `https://solscan.io/tx/${encodeURIComponent(txSig)}`;

const getBadge = (usdValue: number | null) => {
  if (usdValue == null) return null;
  if (usdValue >= 2000) return "👑";
  if (usdValue >= 1500) return "🐳";
  return null;
};

const normalizeBuy = (raw: Record<string, unknown>): DiamondHandBuy => {
  const createdAt =
    getString(raw.created_ts) ??
    getString(raw.created_at) ??
    getString(raw.timestamp) ??
    getString(raw.time) ??
    null;

  const symbol = getString(raw.symbol) ?? getString(raw.token_symbol) ?? getString(raw.ticker) ?? null;

  const buyer = getString(raw.buyer) ?? getString(raw.wallet) ?? getString(raw.user) ?? null;

  const solSpent = getNumber(raw.sol_spent) ?? null;

  const usdValue = getNumber(raw.usd_value) ?? getNumber(raw.amount_usd) ?? getNumber(raw.value_usd) ?? null;

  const txSig = getString(raw.tx_sig) ?? null;

  return { createdAt, symbol, buyer, solSpent, usdValue, txSig };
};

export default function DiamondHandsFeed() {
  const [items, setItems] = useState<DiamondHandBuy[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pageIndex, setPageIndex] = useState(0);

  const tableName = useMemo(
    () => import.meta.env.VITE_SUPABASE_DIAMOND_HANDS_TABLE ?? "big_buy_top10",
    [],
  );

  const limit = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_DIAMOND_HANDS_LIMIT;
    const parsed = raw ? Number(raw) : 10;
    return Number.isFinite(parsed) ? parsed : 10;
  }, []);

  const refreshMs = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_LEADERBOARD_POLL_MS;
    const parsed = raw ? Number(raw) : 600_000;
    return Number.isFinite(parsed) ? parsed : 600_000;
  }, []);

  const pageSize = 5;
  const pageCount = useMemo(() => {
    if (items.length === 0) return 1;
    return Math.max(1, Math.ceil(items.length / pageSize));
  }, [items.length]);

  const currentPageItems = useMemo(() => {
    const start = pageIndex * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, pageIndex]);

  const lastUpdated = useMemo(() => {
    const iso = items[0]?.createdAt;
    if (!iso) return null;
    const d = new Date(iso);
    const ms = d.getTime();
    if (!Number.isFinite(ms)) return null;
    const diffMs = now - ms;
    const diffMin = Math.max(0, Math.round(diffMs / 60000));
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d ago`;
  }, [items, now]);

  useEffect(() => {
    if (pageIndex > pageCount - 1) setPageIndex(0);
  }, [pageCount, pageIndex]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !tableName) return;

    let cancelled = false;

    const fetchItems = async () => {
      setIsLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from(tableName)
        .select("buyer,sol_spent,usd_value,symbol,tx_sig,created_ts")
        .order("usd_value", { ascending: false })
        .order("created_ts", { ascending: false })
        .limit(limit);

      if (cancelled) return;

      if (error) {
        setError(error.message);
        setIsLoading(false);
        return;
      }

      const normalized = (data ?? [])
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
        .map((r) => normalizeBuy(r));

      setItems(normalized);
      setIsLoading(false);
    };

    fetchItems();
    const interval = window.setInterval(fetchItems, refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [limit, refreshMs, tableName]);

  if (!isSupabaseConfigured) {
    return (
      <div className="glass-card border border-white/10 rounded-2xl p-6">
        <div className="flex items-center gap-2 text-white font-bold mb-2">
          <Diamond className="w-4 h-4 text-cyan-300" />
          Diamond Hands
        </div>
        <p className="text-sm text-gray-400">
          Coming soon...
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-white font-bold">
          <Diamond className="w-4 h-4 text-cyan-300" />
          Diamond Hands
        </div>
        {items.length > pageSize && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPageIndex((p) => (p <= 0 ? pageCount - 1 : p - 1))}
              className="w-8 h-8 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4 text-gray-400" />
            </button>
            <span className="text-xs text-gray-500 tabular-nums">
              {pageIndex + 1}/{pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPageIndex((p) => (p >= pageCount - 1 ? 0 : p + 1))}
              className="w-8 h-8 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        )}
      </div>

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : isLoading && items.length === 0 ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-2">
          {currentPageItems.map((item, idx) => {
            const globalRank = pageIndex * pageSize + idx + 1;
            const badge = getBadge(item.usdValue);
            const txUrl = item.txSig ? buildTxUrl(item.txSig) : null;
            return (
              <div
                key={`${item.txSig ?? "na"}-${globalRank}`}
                className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 min-h-[56px] flex flex-col justify-between"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm text-gray-400 w-3">#{globalRank}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {badge && <span className="text-sm">{badge}</span>}
                        <span className="font-bold text-white truncate">
                          {item.symbol ?? "—"}
                        </span>
                        <span className="text-xs text-gray-400 truncate min-w-0">
                          {item.buyer ? `· ${shorten(item.buyer)}` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-banana tabular-nums">
                    {item.usdValue == null ? "—" : formatUsd(item.usdValue)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
                  <span className="tabular-nums">
                    SOL {item.solSpent == null ? "—" : formatSol(item.solSpent)}
                  </span>
                  {txUrl ? (
                    <a
                      href={txUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-white transition-colors"
                      title={item.txSig ?? undefined}
                    >
                      <span className="tabular-nums">
                        {item.txSig ? shorten(item.txSig, 6, 6) : "Tx"}
                      </span>
                      <ExternalLink className="w-3 h-3 text-white/50" />
                    </a>
                  ) : (
                    <span>—</span>
                  )}
                </div>
              </div>
            );
          })}

          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Diamond className="w-8 h-8 text-cyan-300/30 mb-3" />
              <p className="text-gray-400 font-medium">No big buys yet.</p>
            </div>
          )}

          {items.length > 0 && (
            <div className="mt-4 text-xs text-gray-500 text-right">
              {lastUpdated ? `Updated ${lastUpdated}` : "Refreshes every 10m"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
