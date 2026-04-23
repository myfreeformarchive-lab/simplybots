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

type BoostStats = {
  symbol: string | null;
  mcap: number | null;
  buyCount: number | null;
  buyVolumeUsd: number | null;
  score: number | null;
};

type BoostShoutout = {
  id: string | null;
  boostId: string | null;
  contractAddress: string | null;
  tokenSymbol: string | null;
  templateKey: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
  stats: BoostStats | null;
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

const formatUsdCompact = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatScore = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
};

const buildTxUrl = (txSig: string) =>
  `https://solscan.io/tx/${encodeURIComponent(txSig)}`;

const buildDexscreenerUrl = (contractAddress: string) =>
  `https://dexscreener.com/solana/${encodeURIComponent(contractAddress)}`;

const extractFirstUrl = (value: string) => {
  const stripped = value.replace(/[`<>]/g, " ").trim();
  const parts = stripped.split(/\s*\|\s*|\s+/g).filter(Boolean);

  for (const part of parts) {
    const candidate = part.replace(/[),.;]+$/g, "");
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) return candidate;
  }

  return null;
};

const cleanTextToken = (value: string) => value.replace(/[`<>]/g, "").trim();

const buildTxHref = (txSigOrUrl: string) => {
  const maybeUrl = extractFirstUrl(txSigOrUrl);
  if (maybeUrl) {
    try {
      const parsed = new URL(maybeUrl);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const txIdx = segments.findIndex((s) => s.toLowerCase() === "tx");
      if (txIdx >= 0 && segments[txIdx + 1]) return buildTxUrl(segments[txIdx + 1]);
      const last = segments[segments.length - 1];
      if (last) return buildTxUrl(last);
    } catch {
      return maybeUrl;
    }
    return maybeUrl;
  }

  const cleaned = cleanTextToken(txSigOrUrl);
  return cleaned ? buildTxUrl(cleaned) : null;
};

const buildBuyerUrl = (buyer: string) => {
  const maybeUrl = extractFirstUrl(buyer);
  if (maybeUrl) return maybeUrl;

  const trimmed = cleanTextToken(buyer);
  if (!trimmed) return null;
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

const shoutoutEmojis = ["📢", "📣", "🙌", "🥳", "👏", "🚀", "💯", "🫡", "❤️", "🔥"] as const;

const pickEmoji = (seed: string | null | undefined) => {
  const base = (seed ?? "").trim();
  if (!base) return shoutoutEmojis[0];
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash * 31 + base.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % shoutoutEmojis.length;
  return shoutoutEmojis[idx];
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
    const url = rawUrl.trim().replace(/[),.;]+$/g, "");
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    let parsed: URL;
    let hostname = "";
    try {
      parsed = new URL(url);
      hostname = parsed.hostname.toLowerCase();
    } catch {
      continue;
    }

    const isIgnore =
      hostname.includes("solscan.io") ||
      hostname.includes("dexscreener.com") ||
      hostname.includes("pump.fun") ||
      (hostname === "t.me" && parsed.pathname.toLowerCase() === "/solbananabot");

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

const normalizeBoost = (raw: Record<string, unknown>): BoostShoutout => {
  const id = getString(raw.id) ?? null;
  const boostId = getString(raw.boost_id) ?? null;
  const contractAddress =
    getString(raw.contract_address) ??
    getString(raw.contractAddress) ??
    getString(raw.mint) ??
    null;
  const tokenSymbol =
    getString(raw.token_symbol) ??
    getString(raw.tokenSymbol) ??
    getString(raw.symbol) ??
    getString(raw.ticker) ??
    null;
  const templateKey = getString(raw.template_key) ?? null;
  const scheduledAt = getString(raw.scheduled_at) ?? null;
  const sentAt = getString(raw.sent_at) ?? null;
  const createdAt = getString(raw.created_at) ?? null;

  return {
    id,
    boostId,
    contractAddress,
    tokenSymbol,
    templateKey,
    scheduledAt,
    sentAt,
    createdAt,
    stats: null,
  };
};

const normalizeBoostStats = (raw: Record<string, unknown>): BoostStats => {
  const symbol = getString(raw.symbol) ?? null;
  const mcap = getNumber(raw.mcap) ?? getNumber(raw.market_cap) ?? null;
  const buyCount = getNumber(raw.buy_count) ?? getNumber(raw.buys) ?? null;
  const buyVolumeUsd =
    getNumber(raw.buy_volume_usd) ?? getNumber(raw.volume_usd) ?? null;
  const score = getNumber(raw.score) ?? null;
  return { symbol, mcap, buyCount, buyVolumeUsd, score };
};

const renderBoostTemplate = (
  templateKey: string | null,
  symbol: string,
  stats: BoostStats | null,
) => {
  const sym = symbol.trim().toUpperCase() || "TOKEN";
  const buysTxt =
    stats?.buyCount == null ? "—" : new Intl.NumberFormat(undefined).format(stats.buyCount);
  const volTxt = stats?.buyVolumeUsd == null ? "—" : `$${formatUsdCompact(stats.buyVolumeUsd)}`;
  const mcapTxt = stats?.mcap == null ? "—" : `$${formatUsdCompact(stats.mcap)}`;
  const scoreTxt = stats?.score == null ? null : formatScore(stats.score);

  if (templateKey === "we_see_you") {
    return {
      headline: `🔥 We see you, $${sym}!`,
      body: `Shoutout to the team for pushing the limits today. ${buysTxt} buys in a single hour is wild.`,
      footer: `MCAP ${mcapTxt} · 1h Vol ${volTxt}`,
    };
  }
  if (templateKey === "builders") {
    return {
      headline: `Shoutout to $${sym} 🙌`,
      body: `Thanks for the energy you’re injecting into the Solana space. With ${volTxt} in volume this hour, the numbers speak.`,
      footer: scoreTxt ? `Score ${scoreTxt} · 1h Vol ${volTxt}` : `1h Vol ${volTxt} · MCAP ${mcapTxt}`,
    };
  }
  if (templateKey === "volume_surge") {
    return {
      headline: `⚡ Volume Surge: $${sym}`,
      body: `Momentum check: ${volTxt} in 1h volume and ${buysTxt} buys.`,
      footer: scoreTxt ? `Score ${scoreTxt} · MCAP ${mcapTxt}` : `MCAP ${mcapTxt}`,
    };
  }
  if (templateKey === "buy_frenzy") {
    return {
      headline: `📈 Buy Frenzy: $${sym}`,
      body: `${buysTxt} buys this hour — that’s the kind of pressure we love to see.`,
      footer: `1h Vol ${volTxt} · MCAP ${mcapTxt}`,
    };
  }
  if (templateKey === "mcap_watch") {
    return {
      headline: `💎 MCAP Watch`,
      body: `Keeping an eye on $${sym} — currently sitting at ${mcapTxt} with strong activity.`,
      footer: `1h Buys ${buysTxt} · 1h Vol ${volTxt}`,
    };
  }
  if (templateKey === "score_spike") {
    return {
      headline: `🎯 Score Spike: $${sym}`,
      body: scoreTxt ? `Leaderboard score rising ${scoreTxt} 🔥` : `Momentum building fast right now.`,
      footer: `1h Vol ${volTxt} · 1h Buys ${buysTxt}`,
    };
  }
  if (templateKey === "community_call") {
    return {
      headline: `🌐 Community Call: $${sym}`,
      body: `Builders, traders, and memers — this one’s worth a look.`,
      footer: `MCAP ${mcapTxt} · 1h Vol ${volTxt}`,
    };
  }
  if (templateKey === "featured_token") {
    return {
      headline: `⭐ Today’s Featured Token`,
      body: `Shoutout to $${sym} for making noise on Solana today!`,
      footer: `MCAP ${mcapTxt} · 1h Buys ${buysTxt} · 1h Vol ${volTxt}`,
    };
  }

  return {
    headline: `🤝 Partnership Spotlight`,
    body: `Huge thanks to the $${sym} team. We love the momentum you're bringing to Solana right now.`,
    footer: `MCAP ${mcapTxt} · 1h Buys ${buysTxt} · 1h Vol ${volTxt}`,
  };
};

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
};

type ShoutoutCard =
  | { kind: "big_buy"; item: BigBuyShoutout }
  | { kind: "boost"; item: BoostShoutout };

export default function ShoutoutsFeed() {
  const [bigBuyItems, setBigBuyItems] = useState<BigBuyShoutout[]>([]);
  const [boostItems, setBoostItems] = useState<BoostShoutout[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isCacheHydrated, setIsCacheHydrated] = useState(false);

  const tableName = useMemo(
    () => import.meta.env.VITE_SUPABASE_SHOUTOUTS_TABLE ?? "big_buy_top10",
    [],
  );

  const limit = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_SHOUTOUTS_LIMIT;
    const parsed = raw ? Number(raw) : 3;
    return Number.isFinite(parsed) ? parsed : 3;
  }, []);

  const refreshMs = useMemo(() => {
    const raw =
      import.meta.env.VITE_SUPABASE_SHOUTOUTS_POLL_MS ??
      import.meta.env.VITE_SUPABASE_LEADERBOARD_POLL_MS;
    const parsed = raw ? Number(raw) : 600_000;
    return Number.isFinite(parsed) ? parsed : 600_000;
  }, []);

  const boostTableName = useMemo(
    () => import.meta.env.VITE_SUPABASE_BOOST_SHOUTOUTS_TABLE ?? "boost_shoutouts",
    [],
  );

  const boostLimit = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_BOOST_SHOUTOUTS_LIMIT;
    const parsed = raw ? Number(raw) : 5;
    return Number.isFinite(parsed) ? parsed : 5;
  }, []);

  const leaderboardViewName = useMemo(
    () => import.meta.env.VITE_SUPABASE_LEADERBOARD_VIEW ?? "global_leaderboard_scored",
    [],
  );

  const minUsd = 10_000;

  useEffect(() => {
    try {
      const cached = localStorage.getItem("simplybots:shoutouts:v2");
      if (!cached) return;
      const parsed = JSON.parse(cached) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      const record = parsed as {
        bigBuys?: unknown;
        boosts?: unknown;
        fetchedAt?: unknown;
      };
      if (Array.isArray(record.bigBuys)) {
        setBigBuyItems(record.bigBuys as BigBuyShoutout[]);
      }
      if (Array.isArray(record.boosts)) {
        setBoostItems(record.boosts as BoostShoutout[]);
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

  const rotationMs = 20_000;
  const activeCard = useMemo<ShoutoutCard | null>(() => {
    const hasBig = bigBuyItems.length > 0;
    const hasBoost = boostItems.length > 0;
    if (!hasBig && !hasBoost) return null;

    const slot = Math.floor(nowMs / rotationMs);
    const baseHash = Math.abs(hashString(String(slot)));
    const preferBoost = hasBoost && (!hasBig || baseHash % 2 === 0);
    if (preferBoost) {
      const idx = boostItems.length === 0 ? 0 : baseHash % boostItems.length;
      return boostItems[idx] ? { kind: "boost", item: boostItems[idx] } : null;
    }
    const idx = bigBuyItems.length === 0 ? 0 : baseHash % bigBuyItems.length;
    return bigBuyItems[idx] ? { kind: "big_buy", item: bigBuyItems[idx] } : null;
  }, [bigBuyItems, boostItems, nowMs]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !tableName) return;
    if (!isCacheHydrated) return;

    let cancelled = false;
    let interval: number | null = null;
    let timeout: number | null = null;

    const fetchItems = async () => {
      setIsLoading(true);
      setError(null);
      const { data: bigBuyData, error: bigBuyError } = await supabase
        .from(tableName)
        .select(
          "created_ts,token_address,symbol,buyer,sol_spent,usd_value,tokens_received,dex,tx_sig,chart_url,message_markdown",
        )
        .gte("usd_value", minUsd)
        .order("usd_value", { ascending: false })
        .order("created_ts", { ascending: false })
        .limit(limit);

      if (cancelled) return;

      if (bigBuyError) {
        setError(bigBuyError.message);
        setIsLoading(false);
        return;
      }

      const normalizedBigBuys = (bigBuyData ?? [])
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
        .map((r) => normalizeBigBuy(r));

      const { data: boostData, error: boostError } = await supabase
        .from(boostTableName)
        .select("id,boost_id,contract_address,token_symbol,template_key,scheduled_at,sent_at,created_at")
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false })
        .limit(boostLimit);

      if (cancelled) return;

      if (boostError) {
        setError(boostError.message);
        setIsLoading(false);
        return;
      }

      const normalizedBoosts = (boostData ?? [])
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
        .map((r) => normalizeBoost(r));

      const contractAddresses = normalizedBoosts
        .map((b) => (b.contractAddress ?? "").trim())
        .filter(Boolean);

      let statsByAddress = new Map<string, BoostStats>();
      if (contractAddresses.length > 0) {
        const { data: statsData, error: statsError } = await supabase
          .from(leaderboardViewName)
          .select("contract_address,symbol,mcap,buy_volume_usd,buy_count,score")
          .in("contract_address", contractAddresses);

        if (cancelled) return;

        if (statsError) {
          setError(statsError.message);
          setIsLoading(false);
          return;
        }

        statsByAddress = new Map(
          (statsData ?? [])
            .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
            .map((r) => {
              const addr = getString(r.contract_address) ?? "";
              return [addr, normalizeBoostStats(r)] as const;
            })
            .filter(([addr]) => Boolean(addr)),
        );
      }

      const boostsWithStats = normalizedBoosts.map((b) => {
        const addr = (b.contractAddress ?? "").trim();
        const stats = addr ? statsByAddress.get(addr) ?? null : null;
        return { ...b, stats };
      });

      setBigBuyItems(normalizedBigBuys);
      setBoostItems(boostsWithStats);
      const fetchedAt = Date.now();
      setLastFetchAt(fetchedAt);
      try {
        localStorage.setItem(
          "simplybots:shoutouts:v2",
          JSON.stringify({ bigBuys: normalizedBigBuys, boosts: boostsWithStats, fetchedAt }),
        );
      } catch (err) {
        void err;
      }
      setIsLoading(false);
    };

    const ageMs = lastFetchAt == null ? Number.POSITIVE_INFINITY : Date.now() - lastFetchAt;
    const delayMs = ageMs >= refreshMs ? 0 : Math.max(0, refreshMs - ageMs);

    if (delayMs === 0) {
      fetchItems();
      interval = window.setInterval(fetchItems, refreshMs);
    } else {
      timeout = window.setTimeout(() => {
        fetchItems();
        interval = window.setInterval(fetchItems, refreshMs);
      }, delayMs);
    }

    return () => {
      cancelled = true;
      if (timeout != null) window.clearTimeout(timeout);
      if (interval != null) window.clearInterval(interval);
    };
  }, [boostLimit, boostTableName, isCacheHydrated, lastFetchAt, leaderboardViewName, limit, refreshMs, tableName]);

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
      ) : isLoading && bigBuyItems.length === 0 && boostItems.length === 0 ? (
        <div className="space-y-2 animate-pulse">
          <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-4 min-h-[300px] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-4 w-4 rounded bg-white/10" />
                  <div className="h-4 w-6 rounded bg-white/10" />
                  <div className="h-4 w-24 rounded bg-white/10" />
                </div>
                <div className="h-4 w-16 rounded bg-white/10" />
              </div>
              <div className="mt-2 h-3 w-48 rounded bg-white/10" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={`skb-${idx}`} className="rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
                    <div className="h-3 w-10 rounded bg-white/10" />
                    <div className="mt-2 h-4 w-16 rounded bg-white/10" />
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                <div className="h-3 w-12 rounded bg-white/10" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <div key={`sks-${idx}`} className="h-7 w-20 rounded-md bg-white/10" />
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="h-3 w-40 rounded bg-white/10" />
              <div className="h-3 w-16 rounded bg-white/10" />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          {activeCard == null ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
              <Megaphone className="w-8 h-8 text-solana-purple/30 mb-3" />
              <p className="text-gray-400 font-medium">
                No big buy shoutouts yet.
              </p>
            </div>
          ) : activeCard.kind === "boost" ? (
            <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-4 flex flex-col justify-between min-h-[300px]">
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm">{pickEmoji(activeCard.item.contractAddress ?? activeCard.item.id)}</span>
                      <span className="font-bold text-white truncate">
                        {activeCard.item.tokenSymbol ?? activeCard.item.stats?.symbol ?? "Boost Shoutout"}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-white">
                      {renderBoostTemplate(
                        activeCard.item.templateKey,
                        activeCard.item.tokenSymbol ?? activeCard.item.stats?.symbol ?? "TOKEN",
                        activeCard.item.stats,
                      ).headline}
                    </div>
                    <div className="mt-2 text-xs text-gray-300 leading-relaxed">
                      {renderBoostTemplate(
                        activeCard.item.templateKey,
                        activeCard.item.tokenSymbol ?? activeCard.item.stats?.symbol ?? "TOKEN",
                        activeCard.item.stats,
                      ).body}
                    </div>
                    <div className="mt-2 text-xs text-gray-400">
                      {renderBoostTemplate(
                        activeCard.item.templateKey,
                        activeCard.item.tokenSymbol ?? activeCard.item.stats?.symbol ?? "TOKEN",
                        activeCard.item.stats,
                      ).footer}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {activeCard.item.contractAddress ? (
                      <a
                        href={buildDexscreenerUrl(activeCard.item.contractAddress)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-gray-300 hover:text-white transition-colors"
                        title={activeCard.item.contractAddress}
                      >
                        <span>Dex</span>
                        <ExternalLink className="w-3 h-3 text-white/50" />
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-gray-300">
                  <div className="rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
                    <div className="text-[10px] text-gray-500">MCAP</div>
                    <div className="font-bold text-white tabular-nums">
                      {activeCard.item.stats?.mcap == null ? "—" : `$${formatUsdCompact(activeCard.item.stats.mcap)}`}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
                    <div className="text-[10px] text-gray-500">1h Vol</div>
                    <div className="font-bold text-white tabular-nums">
                      {activeCard.item.stats?.buyVolumeUsd == null
                        ? "—"
                        : `$${formatUsdCompact(activeCard.item.stats.buyVolumeUsd)}`}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
                    <div className="text-[10px] text-gray-500">1h Buys</div>
                    <div className="font-bold text-white tabular-nums">
                      {activeCard.item.stats?.buyCount == null
                        ? "—"
                        : new Intl.NumberFormat(undefined).format(activeCard.item.stats.buyCount)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-white/5 px-2 py-1.5">
                    <div className="text-[10px] text-gray-500">Score</div>
                    <div className="font-bold text-white tabular-nums">
                      {activeCard.item.stats?.score == null ? "—" : formatScore(activeCard.item.stats.score)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-xs text-gray-500 truncate min-w-0">
                  Template · {activeCard.item.templateKey ?? "default"}
                </span>
                <span className="text-xs text-gray-600 tabular-nums">
                  {activeCard.item.sentAt ?? activeCard.item.createdAt ?? ""}
                </span>
              </div>
            </div>
          ) : (
            (() => {
              const item = activeCard.item;
              const socials = extractSocialLinks(item.messageMarkdown);
              const dexPaid = extractDexPaid(item.messageMarkdown);
              return (
                <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-4 flex flex-col justify-between min-h-[300px]">
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm">{pickEmoji(item.txSig ?? item.createdAt ?? item.symbol)}</span>
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
                            href={extractFirstUrl(item.chartUrl) ?? item.chartUrl}
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
                            href={buildTxHref(item.txSig) ?? undefined}
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
          )}

          <div className="mt-4 text-xs text-gray-500 text-right">
            {lastUpdated ? `Updated ${lastUpdated}` : "Updated just now"}
          </div>
        </div>
      )}
    </div>
  );
}
