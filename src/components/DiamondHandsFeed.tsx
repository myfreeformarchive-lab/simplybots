import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Diamond } from "lucide-react";

type DiamondHandEvent = {
  createdAt: string | null;
  token: string | null;
  amountUsd: number | null;
  wallet: string | null;
  txUrl: string | null;
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

const normalizeEvent = (raw: Record<string, unknown>): DiamondHandEvent => {
  const createdAt =
    getString(raw.created_at) ?? getString(raw.timestamp) ?? getString(raw.time) ?? null;

  const token =
    getString(raw.token_symbol) ??
    getString(raw.symbol) ??
    getString(raw.token) ??
    getString(raw.ticker) ??
    null;

  const amountUsd =
    getNumber(raw.amount_usd) ??
    getNumber(raw.usd) ??
    getNumber(raw.amount) ??
    getNumber(raw.value_usd) ??
    null;

  const wallet =
    getString(raw.wallet) ??
    getString(raw.buyer) ??
    getString(raw.user) ??
    getString(raw.address) ??
    null;

  const txUrl =
    getString(raw.tx_url) ??
    getString(raw.tx) ??
    getString(raw.transaction_url) ??
    null;

  return { createdAt, token, amountUsd, wallet, txUrl };
};

export default function DiamondHandsFeed() {
  const [items, setItems] = useState<DiamondHandEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const tableName = useMemo(
    () => import.meta.env.VITE_SUPABASE_DIAMOND_HANDS_TABLE ?? "diamond_hands",
    [],
  );

  const limit = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_DIAMOND_HANDS_LIMIT;
    const parsed = raw ? Number(raw) : 8;
    return Number.isFinite(parsed) ? parsed : 8;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    let cancelled = false;

    const fetchItems = async () => {
      setError(null);
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (cancelled) return;

      if (error) {
        setError(error.message);
        return;
      }

      const normalized = (data ?? [])
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
        .map((r) => normalizeEvent(r));

      setItems(normalized);
    };

    fetchItems();

    const channel = supabase
      .channel("diamond-hands")
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
        <span className="text-xs text-gray-500">Live</span>
      </div>

      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Diamond className="w-8 h-8 text-cyan-300/30 mb-3" />
        <p className="text-gray-400 font-medium">Coming soon...</p>
      </div>
    </div>
  );
}

