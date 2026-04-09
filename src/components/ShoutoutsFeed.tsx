import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Megaphone } from "lucide-react";

type Shoutout = {
  createdAt: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
};

const getString = (value: unknown) => (typeof value === "string" ? value : null);

const normalizeShoutout = (raw: Record<string, unknown>): Shoutout => {
  const createdAt =
    getString(raw.created_at) ?? getString(raw.timestamp) ?? getString(raw.time) ?? null;

  const title =
    getString(raw.title) ??
    getString(raw.headline) ??
    getString(raw.token) ??
    getString(raw.symbol) ??
    null;

  const body =
    getString(raw.body) ??
    getString(raw.message) ??
    getString(raw.text) ??
    null;

  const url =
    getString(raw.url) ??
    getString(raw.link) ??
    getString(raw.telegram_url) ??
    null;

  return { createdAt, title, body, url };
};

export default function ShoutoutsFeed() {
  const [items, setItems] = useState<Shoutout[]>([]);
  const [error, setError] = useState<string | null>(null);

  const tableName = useMemo(
    () => import.meta.env.VITE_SUPABASE_SHOUTOUTS_TABLE ?? "shoutouts",
    [],
  );

  const limit = useMemo(() => {
    const raw = import.meta.env.VITE_SUPABASE_SHOUTOUTS_LIMIT;
    const parsed = raw ? Number(raw) : 6;
    return Number.isFinite(parsed) ? parsed : 6;
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
        .map((r) => normalizeShoutout(r));

      setItems(normalized);
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

  if (!isSupabaseConfigured) {
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

      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Megaphone className="w-8 h-8 text-solana-purple/30 mb-3" />
        <p className="text-gray-400 font-medium">Coming soon...</p>
      </div>
    </div>
  );
}
