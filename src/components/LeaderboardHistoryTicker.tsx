import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

type HistoryRow = {
  contract_address: string;
  dex: string | null;
  symbol: string | null;
  mcap: number | null;
  holder_count: number | null;
  seen_count: number | null;
  updated_at: string | null;
};

const DISPLAY_LOCALE = "en-US";

const formatCompact = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatUsdCompact = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  return `$${formatCompact(value)}`;
};

const formatSymbol = (symbol: string | null, contractAddress: string) => {
  const clean = (symbol ?? "").trim().replace(/^\$+/, "").toUpperCase();
  if (clean) return `$${clean}`;
  const addr = (contractAddress ?? "").trim();
  if (addr.length <= 10) return addr || "TOKEN";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
};

export default function LeaderboardHistoryTicker() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "30");
    params.set("min_holders", "10000");
    return `/api/leaderboard/history?${params.toString()}`;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;

    const fetchRows = async () => {
      try {
        if (isSupabaseConfigured && supabase) {
          const { data, error } = await supabase
            .from("leaderboard_history")
            .select("contract_address,dex,symbol,mcap,holder_count,seen_count,updated_at")
            .gte("holder_count", 10000)
            .order("seen_count", { ascending: false })
            .order("holder_count", { ascending: false })
            .order("updated_at", { ascending: false })
            .limit(30);

          if (cancelled) return;
          if (error) {
            setRows([]);
            setHasLoadedOnce(true);
            return;
          }

          const normalized = (data ?? [])
            .filter((r): r is HistoryRow => Boolean(r && typeof r === "object"))
            .filter((r) => typeof r.contract_address === "string" && r.contract_address.trim())
            .slice(0, 30);

          setRows(normalized);
          setHasLoadedOnce(true);
          return;
        }

        const resp = await fetch(url, { method: "GET" });
        const raw = await resp.json().catch(() => null);
        if (cancelled) return;
        const list = Array.isArray(raw?.rows) ? (raw.rows as HistoryRow[]) : [];
        const normalized = list
          .filter((r) => r && typeof r === "object")
          .filter((r) => typeof r.contract_address === "string" && r.contract_address.trim())
          .slice(0, 30);
        setRows(normalized);
        setHasLoadedOnce(true);
      } catch {
        if (cancelled) return;
        setRows([]);
        setHasLoadedOnce(true);
      }
    };

    fetchRows();
    interval = window.setInterval(fetchRows, 60_000);

    return () => {
      cancelled = true;
      if (interval != null) window.clearInterval(interval);
    };
  }, [url]);

  const items = useMemo(() => rows.filter((r) => r.holder_count != null), [rows]);
  if (items.length === 0) {
    return (
      <div className="glass-card border-white/10 px-4 py-3">
        <div className="text-xs text-gray-500 tabular-nums">
          {hasLoadedOnce ? "No leaderboard history yet." : "Loading leaderboard history..."}
        </div>
      </div>
    );
  }

  const renderItem = (row: HistoryRow, idx: number, suffix: string) => {
    const contract = row.contract_address.trim();
    const label = formatSymbol(row.symbol, contract);
    const mcap = row.mcap == null ? null : Number(row.mcap);
    const holders = row.holder_count == null ? null : Number(row.holder_count);
    const seen = row.seen_count == null ? null : Number(row.seen_count);

    return (
      <div
        key={`${suffix}:${contract}:${idx}`}
        className="flex items-center gap-3 px-4 py-2 rounded-xl border border-white/10 bg-black/40 backdrop-blur-md"
      >
        <span className="font-bold tracking-wide text-white">{label}</span>
        <span className="text-xs text-gray-400 tabular-nums">
          MCAP {mcap == null ? "—" : formatUsdCompact(mcap)}
        </span>
        <span className="text-xs text-gray-400 tabular-nums">
          Holders {holders == null ? "—" : formatCompact(holders)}
        </span>
        <span className="text-xs text-gray-500 tabular-nums">Seen {seen == null ? "—" : seen}</span>
      </div>
    );
  };

  return (
    <div className="sb-ticker relative glass-card border-white/10">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-black via-black/80 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-black via-black/80 to-transparent" />

      <div className="sb-ticker__track flex items-center gap-3 py-2">
        <div className="flex items-center gap-3 pr-3">
          {items.map((row, idx) => renderItem(row, idx, "a"))}
        </div>
        <div className="flex items-center gap-3 pr-3" aria-hidden="true">
          {items.map((row, idx) => renderItem(row, idx, "b"))}
        </div>
      </div>
    </div>
  );
}
