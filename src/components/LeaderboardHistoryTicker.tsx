import { useEffect, useMemo, useRef, useState } from "react";
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

type TokenPair = {
  baseToken?: { address?: string };
  info?: { imageUrl?: string };
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

const chunk = <T,>(items: T[], size: number) => {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const fetchTokenPairs = async (tokenAddresses: string[]) => {
  if (tokenAddresses.length === 0) return [];
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddresses.map(encodeURIComponent).join(",")}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as unknown;
  const record = json as { pairs?: unknown };
  if (!record || typeof record !== "object" || !Array.isArray(record.pairs)) return [];
  return record.pairs as TokenPair[];
};

const sortForTicker = (list: HistoryRow[]) =>
  list.slice().sort((a, b) => {
    const seenA = typeof a.seen_count === "number" && Number.isFinite(a.seen_count) ? a.seen_count : -1;
    const seenB = typeof b.seen_count === "number" && Number.isFinite(b.seen_count) ? b.seen_count : -1;
    if (seenA !== seenB) return seenB - seenA;

    const holdersA =
      typeof a.holder_count === "number" && Number.isFinite(a.holder_count) ? a.holder_count : -1;
    const holdersB =
      typeof b.holder_count === "number" && Number.isFinite(b.holder_count) ? b.holder_count : -1;
    if (holdersA !== holdersB) return holdersB - holdersA;

    const updatedA = typeof a.updated_at === "string" ? a.updated_at : "";
    const updatedB = typeof b.updated_at === "string" ? b.updated_at : "";
    if (updatedA !== updatedB) return updatedB.localeCompare(updatedA);

    const addrA = typeof a.contract_address === "string" ? a.contract_address : "";
    const addrB = typeof b.contract_address === "string" ? b.contract_address : "";
    return addrA.localeCompare(addrB);
  });

export default function LeaderboardHistoryTicker() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [imagesByAddress, setImagesByAddress] = useState<Record<string, string>>({});
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);

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

          setRows(sortForTicker(normalized));
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
        setRows(sortForTicker(normalized));
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

  useEffect(() => {
    if (rows.length === 0) return;

    const addresses = rows
      .map((r) => r.contract_address)
      .filter((a) => typeof a === "string" && a.trim())
      .map((a) => a.trim());

    const missing = addresses.filter((a) => !imagesByAddress[normalizeAddress(a)]);
    if (missing.length === 0) return;

    let cancelled = false;

    const load = async () => {
      const batches = chunk(missing.slice(0, 60), 30);
      const next: Record<string, string> = {};

      for (const batch of batches) {
        const pairs = await fetchTokenPairs(batch);
        for (const p of pairs) {
          const addr = p.baseToken?.address;
          const imageUrl = toHttpImageUrl(p.info?.imageUrl ?? null);
          if (!addr || !imageUrl) continue;
          const key = normalizeAddress(addr);
          if (!next[key]) next[key] = imageUrl;
        }
      }

      if (cancelled) return;
      if (Object.keys(next).length === 0) return;
      setImagesByAddress((prev) => ({ ...prev, ...next }));
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [imagesByAddress, rows]);

  const items = useMemo(() => rows.filter((r) => r.holder_count != null), [rows]);

  useEffect(() => {
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    if (prefersReduced) return;

    const track = trackRef.current;
    if (!track) return;
    if (items.length === 0) {
      track.style.transform = "translate3d(0, 0, 0)";
      return;
    }

    let raf = 0;
    let lastTs = 0;
    const container = track.parentElement as HTMLElement | null;
    let containerWidth = container?.getBoundingClientRect().width ?? 0;
    let trackWidth = track.scrollWidth;
    let x = containerWidth;
    const speedPxPerSec = 40;

    const updateSizes = () => {
      containerWidth = container?.getBoundingClientRect().width ?? 0;
      trackWidth = track.scrollWidth;
    };

    updateSizes();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            updateSizes();
          })
        : null;

    if (ro) {
      if (container) ro.observe(container);
      ro.observe(track);
    }

    const tick = (ts: number) => {
      if (lastTs === 0) lastTs = ts;
      const dt = Math.min(64, ts - lastTs);
      lastTs = ts;

      if (!pausedRef.current) {
        x -= (speedPxPerSec * dt) / 1000;
        if (trackWidth > 0 && x <= -trackWidth) {
          x = containerWidth;
        }

        track.style.transform = `translate3d(${x}px, 0, 0)`;
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      if (ro) ro.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, [items.length]);

  if (items.length === 0) {
    return (
      <div className="glass-card border-white/10 px-4 py-3">
        <div className="text-xs text-gray-500 tabular-nums">
          {hasLoadedOnce ? "No leaderboard history yet." : "Loading leaderboard history..."}
        </div>
      </div>
    );
  }

  const renderItem = (row: HistoryRow) => {
    const contract = row.contract_address.trim();
    const label = formatSymbol(row.symbol, contract);
    const mcap = row.mcap == null ? null : Number(row.mcap);
    const holders = row.holder_count == null ? null : Number(row.holder_count);
    const imageUrl = imagesByAddress[normalizeAddress(contract)] ?? null;

    return (
      <div
        key={contract}
        className="flex items-center gap-3 px-4 py-2 rounded-xl border border-white/10 bg-black/40 backdrop-blur-md"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="h-5 w-5 rounded-full border border-white/10 object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        <span className="font-bold tracking-wide text-white">{label}</span>
        <span className="text-xs text-gray-400 tabular-nums">
          MCAP {mcap == null ? "—" : formatUsdCompact(mcap)}
        </span>
        <span className="text-xs text-gray-400 tabular-nums">
          Holders {holders == null ? "—" : formatCompact(holders)}
        </span>
      </div>
    );
  };

  const renderSeparator = (key: string) => (
    <span
      key={key}
      className="px-1 text-white/25 select-none"
      aria-hidden="true"
    >
      ·
    </span>
  );

  return (
    <div
      className="sb-ticker relative glass-card border-white/10"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-black via-black/80 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-black via-black/80 to-transparent" />

      <div ref={trackRef} className="sb-ticker__track flex items-center gap-3 py-2">
        {items.flatMap((row, idx) => [
          renderItem(row),
          idx === items.length - 1 ? null : renderSeparator(`sep:${row.contract_address}`),
        ])}
      </div>
    </div>
  );
}
