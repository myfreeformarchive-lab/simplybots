import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Trophy } from "lucide-react";

type LeaderboardRow = {
  rank: number | null;
  symbol: string | null;
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
  const rank =
    getNumber(raw.rank) ??
    getNumber(raw.global_rank) ??
    getNumber(raw.position) ??
    null;

  const symbol =
    getString(raw.symbol) ??
    getString(raw.token_symbol) ??
    getString(raw.ticker) ??
    getString(raw.token) ??
    null;

  const score =
    getNumber(raw.score) ??
    getNumber(raw.token_score) ??
    getNumber(raw.points) ??
    null;

  return { rank, symbol, score };
};

export default function LiveLeaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const viewName = useMemo(
    () => import.meta.env.VITE_SUPABASE_LEADERBOARD_VIEW ?? "leaderboard_view",
    [],
  );

  const limit = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_LEADERBOARD_LIMIT;
    const parsed = raw ? Number(raw) : 10;
    return Number.isFinite(parsed) ? parsed : 10;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    let cancelled = false;

    const fetchRows = async () => {
      setError(null);
      const { data, error } = await supabase
        .from(viewName)
        .select("*")
        .limit(limit);

      if (cancelled) return;

      if (error) {
        setError(error.message);
        return;
      }

      const normalized = (data ?? [])
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
        .map((r) => normalizeRow(r))
        .sort((a, b) => {
          if (a.rank == null && b.rank == null) return 0;
          if (a.rank == null) return 1;
          if (b.rank == null) return -1;
          return a.rank - b.rank;
        })
        .slice(0, limit);

      setRows(normalized);
    };

    fetchRows();

    const refreshTable = import.meta.env.VITE_SUPABASE_LEADERBOARD_REFRESH_TABLE ?? viewName;
    const channel = supabase
      .channel("live-leaderboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: refreshTable },
        () => fetchRows(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [limit, viewName]);

  if (!isSupabaseConfigured) {
    return (
      <div className="glass-card border border-white/10 rounded-2xl p-6">
        <div className="flex items-center gap-2 text-white font-bold mb-2">
          <Trophy className="w-4 h-4 text-banana" />
          Global Leaderboard
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
          <Trophy className="w-4 h-4 text-banana" />
          Global Leaderboard
        </div>
        <span className="text-xs text-gray-500">Live</span>
      </div>

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <div
              key={`${row.rank ?? "na"}-${row.symbol ?? idx}`}
              className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400 w-8">
                  #{row.rank ?? idx + 1}
                </span>
                <span className="font-bold text-white">
                  {row.symbol ?? "—"}
                </span>
              </div>
              <span className="text-sm text-gray-300">
                {row.score == null ? "—" : row.score.toLocaleString()}
              </span>
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

