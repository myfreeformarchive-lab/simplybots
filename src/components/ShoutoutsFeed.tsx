import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ExternalLink, Megaphone } from "lucide-react";

type BigBuyShoutout = {
  createdAt: string | null;
  tokenAddress: string | null;
  symbol: string | null;
  buyer: string | null;
  usdValue: number | null;
  solSpent: number | null;
  tokensReceived: number | null;
  dex: string | null;
  txSig: string | null;
  chartUrl: string | null;
  messageMarkdown: string | null;
};

const getString = (value: unknown) => (typeof value === "string" ? value : null);

const getNumber = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

const formatCompact = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatSol = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

const buildTxUrl = (txSig: string) =>
  `https://solscan.io/tx/${encodeURIComponent(txSig)}`;

const buildBuyerUrl = (buyer: string) => {
  const trimmed = buyer.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://solscan.io/account/${encodeURIComponent(trimmed)}`;
};

const shorten = (value: string, head = 4, tail = 4) => {
  const trimmed = value.trim();
  if (!trimmed) return "—";
  if (trimmed.length <= head + tail + 3) return trimmed;
  return `${trimmed.slice(0, head)}…${trimmed.slice(-tail)}`;
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

type SocialLink = {
  label: string;
  url: string;
};

const extractSocialLinks = (markdown: string | null): SocialLink[] => {
  if (!markdown) return [];

  const urls = markdown.match(/https?:\/\/[^\s`|]+/g) ?? [];
  const seen = new Set<string>();
  const result: SocialLink[] = [];

  for (const rawUrl of urls) {
    const url = rawUrl.trim();
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    let hostname = "";
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }

    const isIgnore =
      hostname.includes("solscan.io") ||
      hostname.includes("dexscreener.com") ||
      hostname.includes("pump.fun");

    if (isIgnore) continue;

    let label: string | null = null;
    if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com") {
      label = "X";
    } else if (hostname === "t.me" || hostname.endsWith(".t.me")) {
      label = "Telegram";
    } else if (hostname === "instagram.com" || hostname.endsWith(".instagram.com")) {
      label = "Instagram";
    } else if (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com")) {
      label = "TikTok";
    } else {
      label = "Website";
    }

    result.push({ label, url });
    if (result.length >= 5) break;
  }

  return result;
};

const extractDexPaid = (markdown: string | null): boolean | null => {
  if (!markdown) return null;
  const match = markdown.match(/DEX Paid:\s*(Yes|No)\b/i);
  if (!match) return null;
  return match[1].toLowerCase() === "yes";
};

const normalizeBigBuy = (raw: Record<string, unknown>): BigBuyShoutout => {
  const createdAt =
    getString(raw.created_ts) ??
    getString(raw.created_at) ??
    getString(raw.timestamp) ??
    getString(raw.time) ??
    null;

  const tokenAddress =
    getString(raw.token_address) ??
    getString(raw.mint) ??
    getString(raw.contract_address) ??
    null;

  const symbol = getString(raw.symbol) ?? null;
  const buyer = getString(raw.buyer) ?? null;
  const usdValue = getNumber(raw.usd_value) ?? null;
  const solSpent = getNumber(raw.sol_spent) ?? null;
  const tokensReceived =
    getNumber(raw.tokens_received) ?? getNumber(raw.amount_out) ?? null;
  const dex = getString(raw.dex) ?? null;
  const txSig = getString(raw.tx_sig) ?? null;
  const chartUrl = getString(raw.chart_url) ?? null;
  const messageMarkdown = getString(raw.message_markdown) ?? null;

  return {
    createdAt,
    tokenAddress,
    symbol,
    buyer,
    usdValue,
    solSpent,
    tokensReceived,
    dex,
    txSig,
    chartUrl,
    messageMarkdown,
  };
};

export default function ShoutoutsFeed() {
  const [items, setItems] = useState<BigBuyShoutout[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);

  const tableName = useMemo(
    () => import.meta.env.VITE_SUPABASE_SHOUTOUTS_TABLE ?? "big_buy_top10",
    [],
  );

  const limit = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_SHOUTOUTS_LIMIT;
    const parsed = raw ? Number(raw) : 3;
    return Number.isFinite(parsed) ? parsed : 3;
  }, []);

  const minUsd = 10_000;

  const lastUpdated = useMemo(() => {
    if (lastFetchAt == null) return null;
    const diffMs = Date.now() - lastFetchAt;
    const diffMin = Math.max(0, Math.round(diffMs / 60000));
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d ago`;
  }, [lastFetchAt]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !tableName) return;

    let cancelled = false;

    const fetchItems = async () => {
      setIsLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from(tableName)
        .select(
          "created_ts,token_address,symbol,buyer,sol_spent,usd_value,tokens_received,dex,tx_sig,chart_url,message_markdown",
        )
        .gte("usd_value", minUsd)
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
        .map((r) => normalizeBigBuy(r));

      setItems(normalized);
      setLastFetchAt(Date.now());
      setIsLoading(false);
    };

    fetchItems();

    const channel = supabase
      .channel("shoutouts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: tableName },
        () => fetchItems(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [limit, tableName]);

  if (!isSupabaseConfigured || !tableName) {
    return (
      <div className="glass-card border border-white/10 rounded-2xl p-6 h-full flex flex-col">
        <div className="flex items-center gap-2 text-white font-bold mb-2">
          <Megaphone className="w-4 h-4 text-solana-purple" />
          Shoutouts
        </div>
        <p className="text-sm text-gray-400">
          Coming soon...
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card border border-white/10 rounded-2xl p-6 h-full flex flex-col">
      <div className="flex items-center gap-2 text-white font-bold mb-4">
        <Megaphone className="w-4 h-4 text-solana-purple" />
        Shoutouts
      </div>

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : isLoading && items.length === 0 ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="flex-1 flex flex-col">
          <div className="space-y-2">
          {items.map((item, idx) => (
            (() => {
              const socials = extractSocialLinks(item.messageMarkdown);
              const dexPaid = extractDexPaid(item.messageMarkdown);
              return (
            <div
              key={`${item.txSig ?? item.createdAt ?? "na"}-${idx}`}
              className="rounded-xl border border-white/5 bg-white/5 px-4 py-4 flex flex-col justify-between min-h-[300px]"
            >
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-gray-400 w-3">#{idx + 1}</span>
                      <span className="text-sm">🍌</span>
                      <span className="font-bold text-white truncate">
                        {item.symbol ?? "Big buy"}
                      </span>
                      {item.usdValue != null && (
                        <span className="text-sm font-bold text-banana tabular-nums">
                          {formatUsd(item.usdValue)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-gray-400 truncate">
                      {item.dex ? (formatDexLabel(item.dex) ?? item.dex) : "—"}
                      {item.solSpent != null ? ` · ${formatSol(item.solSpent)} SOL` : ""}
                      {item.tokensReceived != null ? ` · Got ${formatCompact(item.tokensReceived)}` : ""}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {item.chartUrl ? (
                      <a
                        href={item.chartUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-gray-300 hover:text-white transition-colors"
                        title={item.chartUrl}
                      >
                        <span>Chart</span>
                        <ExternalLink className="w-3 h-3 text-white/50" />
                      </a>
                    ) : null}
                    {item.txSig ? (
                      <a
                        href={buildTxUrl(item.txSig)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-gray-300 hover:text-white transition-colors"
                        title={item.txSig}
                      >
                        <span>Tx</span>
                        <ExternalLink className="w-3 h-3 text-white/50" />
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-gray-300">
                  <div className="rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
                    <div className="text-[10px] text-gray-500">SOL</div>
                    <div className="font-bold text-white tabular-nums">
                      {item.solSpent == null ? "—" : formatSol(item.solSpent)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
                    <div className="text-[10px] text-gray-500">USD</div>
                    <div className="font-bold text-white tabular-nums">
                      {item.usdValue == null ? "—" : formatUsd(item.usdValue)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
                    <div className="text-[10px] text-gray-500">Got</div>
                    <div className="font-bold text-white tabular-nums">
                      {item.tokensReceived == null ? "—" : formatCompact(item.tokensReceived)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
                    <div className="text-[10px] text-gray-500">Token</div>
                    <div className="font-bold text-white tabular-nums truncate">
                      {item.tokenAddress == null ? "—" : shorten(item.tokenAddress, 6, 4)}
                    </div>
                  </div>
                </div>

                {socials.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                    <div className="text-[10px] text-gray-500 mb-1">Socials</div>
                    <div className="flex flex-wrap gap-2">
                      {socials.map((s) => (
                        <a
                          key={s.url}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                          title={s.url}
                        >
                          <span>{s.label}</span>
                          <ExternalLink className="w-3 h-3 text-white/50" />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                {item.buyer ? (
                  <a
                    href={buildBuyerUrl(item.buyer) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-gray-400 truncate min-w-0 hover:text-white transition-colors"
                    title={item.buyer}
                  >
                    Buyer · {shorten(item.buyer, 6, 4)}
                  </a>
                ) : (
                  <span className="text-xs text-gray-500">Buyer · —</span>
                )}
                {dexPaid == null ? (
                  <span className="text-xs text-gray-600 tabular-nums">{item.createdAt ?? ""}</span>
                ) : dexPaid ? (
                  <span className="text-xs text-solana-green font-bold">DEX Paid</span>
                ) : (
                  <span className="text-xs text-gray-500 font-bold">DEX Unpaid</span>
                )}
              </div>
            </div>
              );
            })()
          ))}
          </div>

          {items.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
              <Megaphone className="w-8 h-8 text-solana-purple/30 mb-3" />
              <p className="text-gray-400 font-medium">
                No big buy shoutouts yet.
              </p>
            </div>
          )}

          <div className="mt-4 text-xs text-gray-500 text-right">
            {lastUpdated ? `Updated ${lastUpdated}` : "Updated just now"}
          </div>
        </div>
      )}
    </div>
  );
}
