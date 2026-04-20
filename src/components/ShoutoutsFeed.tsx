import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ExternalLink, Megaphone } from "lucide-react";

type BigBuyShoutout = {
  createdAt: string | null;
  symbol: string | null;
  buyer: string | null;
  usdValue: number | null;
  solSpent: number | null;
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

const buildTxUrl = (txSig: string) =>
  `https://solscan.io/tx/${encodeURIComponent(txSig)}`;

const renderMarkdownLite = (text: string) => {
  const parts = text.split(/(https?:\/\/[^\s`|]+)(?=[`|\s]|$)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("http://") || part.startsWith("https://")) {
      return (
        <a
          key={`u-${idx}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-white/20 hover:decoration-white/60 hover:text-white transition-colors break-all"
        >
          {part}
        </a>
      );
    }
    return <span key={`t-${idx}`}>{part}</span>;
  });
};

const normalizeBigBuy = (raw: Record<string, unknown>): BigBuyShoutout => {
  const createdAt =
    getString(raw.created_ts) ??
    getString(raw.created_at) ??
    getString(raw.timestamp) ??
    getString(raw.time) ??
    null;

  const symbol = getString(raw.symbol) ?? null;
  const buyer = getString(raw.buyer) ?? null;
  const usdValue = getNumber(raw.usd_value) ?? null;
  const solSpent = getNumber(raw.sol_spent) ?? null;
  const txSig = getString(raw.tx_sig) ?? null;
  const chartUrl = getString(raw.chart_url) ?? null;
  const messageMarkdown = getString(raw.message_markdown) ?? null;

  return {
    createdAt,
    symbol,
    buyer,
    usdValue,
    solSpent,
    txSig,
    chartUrl,
    messageMarkdown,
  };
};

export default function ShoutoutsFeed() {
  const [items, setItems] = useState<BigBuyShoutout[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !tableName) return;

    let cancelled = false;

    const fetchItems = async () => {
      setIsLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from(tableName)
        .select(
          "created_ts,symbol,buyer,sol_spent,usd_value,tx_sig,chart_url,message_markdown",
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
      <div className="glass-card border border-white/10 rounded-2xl p-6">
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
    <div className="glass-card border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-white font-bold">
          <Megaphone className="w-4 h-4 text-solana-purple" />
          Shoutouts
        </div>
        <span className="text-xs text-gray-500">Live</span>
      </div>

      {error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : isLoading && items.length === 0 ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div
              key={`${item.txSig ?? item.createdAt ?? "na"}-${idx}`}
              className="rounded-xl border border-white/5 bg-white/5 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-400 w-3">#{idx + 1}</span>
                    <span className="font-bold text-white truncate">
                      {item.symbol ?? "Big buy"}
                    </span>
                    {item.usdValue != null && (
                      <span className="text-sm font-bold text-banana tabular-nums">
                        {formatUsd(item.usdValue)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    {item.solSpent == null ? "—" : `${item.solSpent.toFixed(2)} SOL`}
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

              {item.messageMarkdown ? (
                <div className="mt-2 text-xs text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                  {renderMarkdownLite(item.messageMarkdown)}
                </div>
              ) : null}
            </div>
          ))}

          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Megaphone className="w-8 h-8 text-solana-purple/30 mb-3" />
              <p className="text-gray-400 font-medium">
                No big buy shoutouts yet.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
