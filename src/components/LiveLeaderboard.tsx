import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Trophy } from "lucide-react";

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
          <div>Missing VITE_SUPABASE_URL</div>
          <div>Missing VITE_SUPABASE_ANON_KEY</div>
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
        <span className="text-xs text-gray-500">
          {lastUpdated ? `Updated ${lastUpdated}` : "Live"}
        </span>
      </div>

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : isLoading && rows.length === 0 ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div
              key={`${row.contractAddress ?? "na"}-${row.symbol ?? idx}`}
              className="rounded-xl border border-white/5 bg-white/5 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm text-gray-400 w-8">#{idx + 1}</span>
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
          ))}

          {rows.length === 0 && (
            <p className="text-sm text-gray-400">No data yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
