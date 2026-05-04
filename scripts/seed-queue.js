import { createClient } from "@supabase/supabase-js";

const getEnv = (key) => {
  const value = process.env[key];
  return value == null || value.trim() === "" ? null : value.trim();
};

const fetchJsonArray = async (url) => {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Request failed ${res.status} ${url} ${body}`.trim());
  }
  const json = await res.json();
  return Array.isArray(json) ? json : [];
};

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const uniq = (items) => {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = String(item).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(item).trim());
  }
  return out;
};

const buildSeedLines = (addresses, perLine) =>
  chunk(addresses, perLine).map((batch) => `/seedglobal ${batch.join(",")}`);

const main = async () => {
  const supabaseUrl = getEnv("SUPABASE_URL") ?? getEnv("VITE_SUPABASE_URL");
  const supabaseKey =
    getEnv("SUPABASE_SERVICE_ROLE_KEY") ??
    getEnv("SUPABASE_ANON_KEY") ??
    getEnv("VITE_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars (or VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY fallback).",
    );
  }

  const seedMode = (getEnv("SEED_MODE") ?? "both").toLowerCase();
  const maxTokensRaw = Number(getEnv("MAX_TOKENS") ?? "200");
  const perCommandRaw = Number(getEnv("PER_COMMAND") ?? "20");

  const maxTokens = Number.isFinite(maxTokensRaw) && maxTokensRaw > 0 ? maxTokensRaw : 200;
  const perCommand = Number.isFinite(perCommandRaw) && perCommandRaw > 0 ? perCommandRaw : 20;

  const modes =
    seedMode === "latest" || seedMode === "top"
      ? [seedMode]
      : ["latest", "top"];

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const mode of modes) {
    const endpoint =
      mode === "top"
        ? "https://api.dexscreener.com/token-boosts/top/v1"
        : "https://api.dexscreener.com/token-boosts/latest/v1";

    const raw = await fetchJsonArray(endpoint);
    const sol = raw
      .filter((t) => t && typeof t === "object" && t.chainId === "solana" && t.tokenAddress)
      .map((t) => t.tokenAddress);

    const addresses = uniq(sol).slice(0, maxTokens);
    const lines = buildSeedLines(addresses, perCommand);
    const content = `${lines.join("\n")}\n`;

    const { error } = await supabase
      .from("global_seed_queue")
      .insert({ text: content, mode });

    if (error) {
      throw new Error(`Supabase insert failed (${mode}): ${error.message}`);
    }

    process.stdout.write(
      `Inserted global_seed_queue row for mode=${mode} addresses=${addresses.length} lines=${lines.length}\n`,
    );
  }
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});

