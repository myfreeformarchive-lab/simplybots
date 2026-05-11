import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Trophy } from "lucide-react";

type LeaderboardRow = {
  contractAddress: string | null;
  dex: string | null;
  symbol: string | null;
  mcap: number | null;
  buyVolumeUsd: number | null;
  buyCount: number | null;
  updatedAt: string | null;
  score: number | null;
};

const DISPLAY_LOCALE = "en-US";

const getNumber = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/[$,]/g, "").replace(/\s+/g, "");
    const match = normalized.match(/^(-?\d+(?:\.\d+)?)([kKmMbBtT])?$/);
    if (!match) {
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const num = Number(match[1]);
    if (!Number.isFinite(num)) return null;
    const suffix = match[2]?.toLowerCase() ?? null;
    const multiplier =
      suffix === "k"
        ? 1e3
        : suffix === "m"
          ? 1e6
          : suffix === "b"
            ? 1e9
            : suffix === "t"
              ? 1e12
              : 1;
    const parsed = num * multiplier;
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

  const dex =
    getString(raw.dex) ??
    getString(raw.dex_id) ??
    getString(raw.dexId) ??
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
    dex,
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
  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatScore = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    maximumFractionDigits: 2,
  }).format(value);
};

const formatDexLabel = (dex: string) => {
  const trimmed = dex.trim();
  if (!trimmed) return null;
  return trimmed
    .split(/[_\-\s]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
};

const buildTokenUrl = (
  chain: string,
  contractAddress: string,
  dex: string | null,
) => {
  const safeAddress = contractAddress.trim();
  if (!safeAddress) return null;

  const safeDex = (dex ?? "").trim().toLowerCase();
  if (safeDex === "pumpfun" || safeDex === "pumpswap") {
    return `https://pump.fun/coin/${encodeURIComponent(safeAddress)}`;
  }

  const safeChain = chain.trim().toLowerCase();
  if (!safeChain) return null;
  return `https://dexscreener.com/${encodeURIComponent(safeChain)}/${encodeURIComponent(safeAddress)}`;
};

const isCompleteLeaderboardRow = (row: LeaderboardRow) => {
  if (row.mcap == null || !Number.isFinite(row.mcap)) return false;
  if (row.buyVolumeUsd == null || !Number.isFinite(row.buyVolumeUsd)) return false;
  if (row.buyCount == null || !Number.isFinite(row.buyCount)) return false;
  return true;
};

const shouldPostToX = (row: LeaderboardRow, rank: number) => {
  if (row.contractAddress == null) return false;
  if (row.score == null || !Number.isFinite(row.score) || row.score <= 100) return false;
  if (rank < 1 || rank > 5) return false;
  if (
    row.mcap != null &&
    row.buyVolumeUsd != null &&
    Number.isFinite(row.mcap) &&
    Number.isFinite(row.buyVolumeUsd) &&
    row.buyVolumeUsd > row.mcap
  ) {
    return false;
  }
  return true;
};

export default function LiveLeaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isCacheHydrated, setIsCacheHydrated] = useState(false);

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

  const fetchLimit = useMemo(() => {
    const expanded = limit * 4;
    return Math.min(250, Math.max(limit, expanded));
  }, [limit]);

  const refreshMs = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_LEADERBOARD_POLL_MS;
    const fallback = 600_000;
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    if (parsed >= 60_000) return parsed;
    if (parsed <= 60) return parsed * 60_000;
    return parsed * 1000;
  }, []);

  const dexscreenerChain = useMemo(
    () => import.meta.env.VITE_DEXSCREENER_CHAIN ?? "solana",
    [],
  );

  useEffect(() => {
    try {
      const cached = localStorage.getItem("simplybots:leaderboard:v1");
      if (!cached) return;
      const parsed = JSON.parse(cached) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      const record = parsed as { rows?: unknown; fetchedAt?: unknown };
      if (Array.isArray(record.rows)) {
        setRows((record.rows as LeaderboardRow[]).filter(isCompleteLeaderboardRow));
      }
      if (typeof record.fetchedAt === "number" && Number.isFinite(record.fetchedAt)) {
        setLastFetchAt(record.fetchedAt);
      }
    } catch (err) {
      void err;
    } finally {
      setIsCacheHydrated(true);
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

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
    if (!isSupabaseConfigured || !supabase) return;
    if (!isCacheHydrated) return;

    let cancelled = false;
    let interval: number | null = null;
    let timeout: number | null = null;

    const fetchRows = async () => {
      setIsLoading(true);
      setError(null);
      const selectFields =
        "contract_address,dex,symbol,mcap,buy_volume_usd,buy_count,updated_at,score";

      const targetCount = limit;
      const pageSize = 100;
      const maxFetch = Math.min(1000, Math.max(fetchLimit, limit * 20));

      let offset = 0;
      let collected: LeaderboardRow[] = [];

      while (collected.length < targetCount && offset < maxFetch) {
        const { data, error } = await supabase
          .from(viewName)
          .select(selectFields)
          .order("score", { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (cancelled) return;

        if (error) {
          setError(error.message);
          setIsLoading(false);
          return;
        }

        const batch = (data ?? [])
          .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
          .map((r) => normalizeRow(r))
          .filter(isCompleteLeaderboardRow);

        collected = collected.concat(batch);

        if (!data || data.length < pageSize) break;
        offset += pageSize;
      }

      const normalized = collected.slice(0, limit);

      setRows(normalized);
      const fetchedAt = Date.now();
      setLastFetchAt(fetchedAt);
      try {
        localStorage.setItem(
          "simplybots:leaderboard:v1",
          JSON.stringify({ rows: normalized, fetchedAt }),
        );
      } catch (err) {
        void err;
      }
      setIsLoading(false);
    };

    const ageMs = lastFetchAt == null ? Number.POSITIVE_INFINITY : Date.now() - lastFetchAt;
    const delayMs = ageMs >= refreshMs ? 0 : Math.max(0, refreshMs - ageMs);

    if (delayMs === 0) {
      fetchRows();
      interval = window.setInterval(fetchRows, refreshMs);
    } else {
      timeout = window.setTimeout(() => {
        fetchRows();
        interval = window.setInterval(fetchRows, refreshMs);
      }, delayMs);
    }

    return () => {
      cancelled = true;
      if (timeout != null) window.clearTimeout(timeout);
      if (interval != null) window.clearInterval(interval);
    };
  }, [fetchLimit, isCacheHydrated, lastFetchAt, limit, refreshMs, viewName]);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (rows.length === 0) return;

    const key = "simplybots:xposts:leaderboard:v1";
    let already = new Set<string>();
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          already = new Set(
            parsed.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean),
          );
        }
      }
    } catch {
      already = new Set();
    }

    const top5 = rows.slice(0, 5);
    const candidates = top5
      .map((row, idx) => ({ row, rank: idx + 1 }))
      .filter(({ row, rank }) => {
        const addr = row.contractAddress?.trim() ?? "";
        if (!addr) return false;
        if (already.has(addr)) return false;
        return shouldPostToX(row, rank);
      });

    if (candidates.length === 0) return;

    let cancelled = false;

    const run = async () => {
      for (const { row, rank } of candidates) {
        const addr = row.contractAddress?.trim() ?? "";
        if (!addr || already.has(addr)) continue;
        try {
          const resp = await fetch("/api/x/liveleaderboard", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contractAddress: addr,
              symbol: row.symbol,
              score: row.score,
              mcap: row.mcap,
              buyVolumeUsd: row.buyVolumeUsd,
              rank,
            }),
          });

          const payload = (await resp.json().catch(() => null)) as unknown;
          if (!resp.ok) continue;
          if (cancelled) return;

          const status =
            payload && typeof payload === "object" && "status" in payload
              ? (payload as { status?: unknown }).status
              : null;
          const reason =
            payload && typeof payload === "object" && "reason" in payload
              ? (payload as { reason?: unknown }).reason
              : null;

          const shouldMark =
            status === "posted" || (status === "skipped" && reason === "duplicate");

          if (shouldMark) {
            already.add(addr);
            try {
              localStorage.setItem(key, JSON.stringify(Array.from(already)));
            } catch {
              void payload;
            }
          }
        } catch {
          continue;
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [rows]);

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
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={`sk-${idx}`}
              className="rounded-xl border border-white/5 bg-white/5 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-4 w-4 rounded bg-white/10" />
                  <div className="h-4 w-24 rounded bg-white/10" />
                </div>
                <div className="h-4 w-12 rounded bg-white/10" />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="h-3 w-20 rounded bg-white/10" />
                <div className="h-3 w-20 rounded bg-white/10" />
                <div className="h-3 w-20 rounded bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div className="space-y-2">
            {currentPageRows.map((row, idx) => {
              const globalRank = pageIndex * pageSize + idx + 1;
              const tokenUrl =
                row.contractAddress == null
                  ? null
                  : buildTokenUrl(dexscreenerChain, row.contractAddress, row.dex);
              const dexLabel = row.dex == null ? null : formatDexLabel(row.dex);
              const showWarning =
                row.mcap != null &&
                row.buyVolumeUsd != null &&
                Number.isFinite(row.mcap) &&
                Number.isFinite(row.buyVolumeUsd) &&
                row.buyVolumeUsd > row.mcap;
              return (
              <div
                key={`${row.contractAddress ?? "na"}-${row.symbol ?? globalRank}`}
                className="rounded-xl border border-white/5 bg-white/5 px-3 py-2"
              >
                <div className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-3">
                  <span className="text-sm text-gray-400 tabular-nums text-left">
                    #{globalRank}
                  </span>
                  {tokenUrl ? (
                    <a
                      href={tokenUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex items-center gap-2 font-bold text-white hover:text-banana transition-colors"
                      title={row.contractAddress ?? undefined}
                    >
                      <span className="flex items-center gap-1 min-w-0">
                        {globalRank === 1 ? <span className="shrink-0">🔥</span> : null}
                        <span className="truncate">{row.symbol ?? "—"}</span>
                      </span>
                      {dexLabel && (
                        <span className="hidden sm:inline shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300 font-bold">
                          {dexLabel}
                        </span>
                      )}
                      <span className="flex items-center gap-2 shrink-0">
                        <ExternalLink className="w-4 h-4 text-white/50 shrink-0" />
                        <AlertTriangle
                          className={`w-5 h-5 shrink-0 ${showWarning ? "text-red-400" : "opacity-0"}`}
                        />
                      </span>
                    </a>
                  ) : (
                    <span className="min-w-0 flex items-center gap-2 font-bold text-white">
                      <span className="flex items-center gap-1 min-w-0">
                        {globalRank === 1 ? <span className="shrink-0">🔥</span> : null}
                        <span className="truncate">{row.symbol ?? "—"}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <ExternalLink className="w-4 h-4 text-white/50 shrink-0 opacity-0" />
                        <AlertTriangle
                          className={`w-5 h-5 shrink-0 ${showWarning ? "text-red-400" : "opacity-0"}`}
                        />
                      </span>
                    </span>
                  )}
                  <span className="text-sm font-bold text-banana tabular-nums justify-self-end">
                    {row.score == null ? "—" : formatScore(row.score)}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-x-3 gap-y-1 text-xs text-gray-400">
                  <span className="tabular-nums">
                    MCAP {row.mcap == null ? "—" : formatCompact(row.mcap)}
                  </span>
                  <span className="tabular-nums sm:text-center">
                    1h Vol {row.buyVolumeUsd == null ? "—" : `$${formatCompact(row.buyVolumeUsd)}`}
                  </span>
                  <span className="tabular-nums sm:text-right">
                    1h Buys {row.buyCount == null ? "—" : formatCompact(row.buyCount)}
                  </span>
                </div>
              </div>
            )})}

            {rows.length === 0 && (
              <p className="text-sm text-gray-400">No data yet.</p>
            )}
          </div>

          <div className="mt-4 text-xs text-gray-500 text-right">
            {lastUpdated ? `Updated ${lastUpdated}` : "Updated just now"}
          </div>
        </div>
      )}
    </div>
  );
}
