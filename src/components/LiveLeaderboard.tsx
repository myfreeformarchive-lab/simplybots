import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";

type LeaderboardRow = {
  contractAddress: string | null;
  symbol: string | null;
  mcap: number | null;
  buyVolumeUsd: number | null;
  buyCount: number | null;
  updatedAt: string | null;
  score: number | null;
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

const normalizeRow = (raw: Record<string, unknown>): LeaderboardRow => {
  const contractAddress =
    getString(raw.contract_address) ??
    getString(raw.mint) ??
    getString(raw.address) ??
    null;

  const symbol =
    getString(raw.symbol) ??
    getString(raw.token_symbol) ??
    getString(raw.ticker) ??
    getString(raw.token) ??
    null;

  const mcap = getNumber(raw.mcap) ?? getNumber(raw.market_cap) ?? null;

  const buyVolumeUsd =
    getNumber(raw.buy_volume_usd) ?? getNumber(raw.volume_usd) ?? null;

  const buyCount = getNumber(raw.buy_count) ?? getNumber(raw.buys) ?? null;

  const updatedAt =
    getString(raw.updated_at) ?? getString(raw.updatedAt) ?? null;

  const score =
    getNumber(raw.score) ??
    getNumber(raw.token_score) ??
    getNumber(raw.points) ??
    null;

  return {
    contractAddress,
    symbol,
    mcap,
    buyVolumeUsd,
    buyCount,
    updatedAt,
    score,
  };
};

const formatCompact = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatScore = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
};

export default function LiveLeaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pageIndex, setPageIndex] = useState(0);

  const hasSupabaseUrl = Boolean(import.meta.env.VITE_SUPABASE_URL);
  const hasSupabaseAnonKey = Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

  const viewName = useMemo(
    () =>
      import.meta.env.VITE_SUPABASE_LEADERBOARD_VIEW ??
      "global_leaderboard_scored",
    [],
  );

  const limit = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_LEADERBOARD_LIMIT;
    const parsed = raw ? Number(raw) : 10;
    return Number.isFinite(parsed) ? parsed : 10;
  }, []);

  const refreshMs = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_LEADERBOARD_POLL_MS;
    const parsed = raw ? Number(raw) : 60_000;
    return Number.isFinite(parsed) ? parsed : 60_000;
  }, []);

  const lastUpdated = useMemo(() => {
    const iso = rows[0]?.updatedAt;
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
  }, [now, rows]);

  const pageSize = 5;
  const pageCount = useMemo(() => {
    if (rows.length === 0) return 1;
    return Math.max(1, Math.ceil(rows.length / pageSize));
  }, [rows.length]);

  const currentPageRows = useMemo(() => {
    const start = pageIndex * pageSize;
    return rows.slice(start, start + pageSize);
  }, [pageIndex, rows]);

  useEffect(() => {
    if (pageIndex > pageCount - 1) setPageIndex(0);
  }, [pageCount, pageIndex]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    let cancelled = false;

    const fetchRows = async () => {
      setIsLoading(true);
      setError(null);
      const { data, error } = await supabase
          .from(viewName)
          .select(
            "contract_address,symbol,mcap,buy_volume_usd,buy_count,updated_at,score",
          )
          .order("score", { ascending: false })
          .limit(limit);

      if (cancelled) return;

      if (error) {
        setError(error.message);
        setIsLoading(false);
        return;
      }

      const normalized = (data ?? [])
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
        .map((r) => normalizeRow(r))
        .slice(0, limit);

      setRows(normalized);
      setIsLoading(false);
    };

    fetchRows();

    const interval = window.setInterval(fetchRows, refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [limit, refreshMs, viewName]);

  if (!isSupabaseConfigured) {
    return (
      <div className="glass-card border border-white/10 rounded-2xl p-6">
        <div className="flex items-center gap-2 text-white font-bold mb-2">
          <Trophy className="w-4 h-4 text-banana" />
          Global Leaderboard
        </div>
        <p className="text-sm text-gray-400">
          Supabase is not configured for this deployment.
        </p>
        <div className="mt-3 text-xs text-gray-500 space-y-1">
          <div>
            VITE_SUPABASE_URL: {hasSupabaseUrl ? "set" : "missing"}
          </div>
          <div>
            VITE_SUPABASE_ANON_KEY: {hasSupabaseAnonKey ? "set" : "missing"}
          </div>
          <div>
            VITE_SUPABASE_LEADERBOARD_VIEW: {viewName}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-white font-bold">
          <Trophy className="w-4 h-4 text-banana" />
          Global Leaderboard
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {lastUpdated ? `Updated ${lastUpdated}` : "Live"}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous"
              disabled={pageIndex === 0 || rows.length === 0}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="min-w-[52px] text-center text-xs text-gray-500 tabular-nums">
              {Math.min(pageIndex + 1, pageCount)}/{pageCount}
            </div>
            <button
              type="button"
              aria-label="Next"
              disabled={pageIndex >= pageCount - 1 || rows.length === 0}
              onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
              className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : isLoading && rows.length === 0 ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-2">
          {currentPageRows.map((row, idx) => {
            const globalRank = pageIndex * pageSize + idx + 1;
            return (
            <div
              key={`${row.contractAddress ?? "na"}-${row.symbol ?? globalRank}`}
              className="rounded-xl border border-white/5 bg-white/5 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm text-gray-400 w-8">#{globalRank}</span>
                  <span className="font-bold text-white truncate">
                    {row.symbol ?? "—"}
                  </span>
                </div>
                <span className="text-sm text-gray-300 tabular-nums">
                  {row.score == null ? "—" : formatScore(row.score)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
                <span className="tabular-nums">
                  MCAP {row.mcap == null ? "—" : formatCompact(row.mcap)}
                </span>
                <span className="tabular-nums">
                  1h Vol {row.buyVolumeUsd == null ? "—" : `$${formatCompact(row.buyVolumeUsd)}`}
                </span>
                <span className="tabular-nums">
                  1h Buys {row.buyCount == null ? "—" : formatCompact(row.buyCount)}
                </span>
              </div>
            </div>
          )})}

          {rows.length === 0 && (
            <p className="text-sm text-gray-400">No data yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
