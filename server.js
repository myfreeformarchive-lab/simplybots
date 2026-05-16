import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);
const DIST_DIR = path.join(__dirname, "dist");
const STORE_PATH =
  process.env.X_POST_STORE_PATH ??
  path.join(process.cwd(), ".runtime", "x-posted.json");

const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN ?? "";
const X_ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET ?? "";
const X_CONSUMER_KEY = process.env.X_CONSUMER_KEY ?? "";
const X_CONSUMER_SECRET = process.env.X_CONSUMER_SECRET ?? "";
const X_POST_CRON_SECRET = process.env.X_POST_CRON_SECRET ?? "";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  "";
const SUPABASE_LEADERBOARD_VIEW =
  process.env.SUPABASE_LEADERBOARD_VIEW ??
  process.env.VITE_SUPABASE_LEADERBOARD_VIEW ??
  "global_leaderboard_scored";
const SUPABASE_LEADERBOARD_SNAPSHOT_TABLE =
  process.env.SUPABASE_LEADERBOARD_SNAPSHOT_TABLE ?? "leaderboard_history";
const LEADERBOARD_SNAPSHOT_ENABLED = process.env.LEADERBOARD_SNAPSHOT_ENABLED === "1";
const LEADERBOARD_SNAPSHOT_LIMIT = (() => {
  const parsed = Number(process.env.LEADERBOARD_SNAPSHOT_LIMIT ?? 30);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(250, Math.floor(parsed)) : 30;
})();
const LEADERBOARD_SNAPSHOT_INTERVAL_MS = (() => {
  const raw = process.env.LEADERBOARD_SNAPSHOT_INTERVAL_MS ?? "300000";
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 300_000;
})();
const LEADERBOARD_SNAPSHOT_SECRET = process.env.LEADERBOARD_SNAPSHOT_SECRET ?? "";
const LEADERBOARD_SNAPSHOT_MIN_HOLDER_COUNT = 10_000;

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const sendJson = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
};

const getOptionalNumber = (value) => {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getOptionalString = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readPostedSet = async () => {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed?.posted) ? parsed.posted : [];
    return new Set(arr.filter((v) => typeof v === "string" && v.trim()));
  } catch {
    return new Set();
  }
};

const writePostedSet = async (set) => {
  const dir = path.dirname(STORE_PATH);
  await fs.mkdir(dir, { recursive: true });
  const payload = { posted: Array.from(set) };
  await fs.writeFile(STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
};

let supabaseClient = null;
const getSupabase = () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  if (supabaseClient) return supabaseClient;
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
};

const getCronSecret = (req, url) => {
  const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const q = url.searchParams.get("secret");
  return typeof q === "string" ? q.trim() : "";
};

const leaderboardSnapshotState = {
  enabled: LEADERBOARD_SNAPSHOT_ENABLED,
  lastAttemptAt: null,
  lastOkAt: null,
  lastSnapshotAt: null,
  lastInserted: null,
  lastUpdated: null,
  lastError: null,
};

const getSnapshotBucketIso = () => {
  const bucketMs =
    Math.floor(Date.now() / LEADERBOARD_SNAPSHOT_INTERVAL_MS) * LEADERBOARD_SNAPSHOT_INTERVAL_MS;
  return new Date(bucketMs).toISOString();
};

const takeLeaderboardSnapshot = async ({ sb }) => {
  const snapshotAt = getSnapshotBucketIso();
  const nowIso = new Date().toISOString();
  leaderboardSnapshotState.lastAttemptAt = new Date().toISOString();
  leaderboardSnapshotState.lastError = null;

  const { data, error } = await sb
    .from(SUPABASE_LEADERBOARD_VIEW)
    .select("*")
    .order("score", { ascending: false })
    .limit(LEADERBOARD_SNAPSHOT_LIMIT);

  if (error) {
    leaderboardSnapshotState.lastError = {
      stage: "select",
      message: error.message,
      code: error.code ?? null,
    };
    return { ok: false, error: "Failed to load leaderboard", details: error };
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    leaderboardSnapshotState.lastOkAt = new Date().toISOString();
    leaderboardSnapshotState.lastSnapshotAt = snapshotAt;
    leaderboardSnapshotState.lastInserted = 0;
    leaderboardSnapshotState.lastUpdated = 0;
    return { ok: true, snapshotAt, inserted: 0 };
  }

  const payload = rows.map((row, idx) => {
    const r = row ?? {};
    const contractAddress = getOptionalString(r.contract_address) ?? "";
    const dex = getOptionalString(r.dex);
    const symbol = getOptionalString(r.symbol);
    const mcap = getOptionalNumber(r.mcap);
    const buyVolumeUsd = getOptionalNumber(r.buy_volume_usd);
    const buyCount = getOptionalNumber(r.buy_count);
    const holderCount = getOptionalNumber(r.holder_count);
    const score = getOptionalNumber(r.score);
    const sourceUpdatedAt = getOptionalString(r.updated_at);

    return {
      snapshot_at: snapshotAt,
      view_name: SUPABASE_LEADERBOARD_VIEW,
      rank: idx + 1,
      contract_address: contractAddress,
      dex,
      symbol,
      mcap,
      buy_volume_usd: buyVolumeUsd,
      buy_count: buyCount == null ? null : Math.floor(buyCount),
      holder_count: holderCount == null ? null : Math.floor(holderCount),
      score,
      source_updated_at: sourceUpdatedAt,
      payload: r,
    };
  });

  const valid = payload.filter((r) => {
    if (typeof r.contract_address !== "string" || !r.contract_address) return false;
    if (LEADERBOARD_SNAPSHOT_MIN_HOLDER_COUNT <= 0) return true;
    return (
      typeof r.holder_count === "number" &&
      Number.isFinite(r.holder_count) &&
      r.holder_count >= LEADERBOARD_SNAPSHOT_MIN_HOLDER_COUNT
    );
  });
  if (valid.length === 0) {
    leaderboardSnapshotState.lastOkAt = new Date().toISOString();
    leaderboardSnapshotState.lastSnapshotAt = snapshotAt;
    leaderboardSnapshotState.lastInserted = 0;
    leaderboardSnapshotState.lastUpdated = 0;
    return { ok: true, snapshotAt, inserted: 0 };
  }

  const addresses = Array.from(
    new Set(valid.map((r) => r.contract_address).filter((v) => typeof v === "string" && v)),
  );

  const existing = await sb
    .from(SUPABASE_LEADERBOARD_SNAPSHOT_TABLE)
    .select("contract_address,seen_count")
    .in("contract_address", addresses);

  if (existing.error) {
    leaderboardSnapshotState.lastError = {
      stage: "select_existing",
      message: existing.error.message,
      code: existing.error.code ?? null,
    };
    return { ok: false, error: "Failed to check existing rows", details: existing.error };
  }

  const existingMap = new Map();
  for (const row of existing.data ?? []) {
    const addr = getOptionalString(row?.contract_address);
    if (!addr) continue;
    const seen = getOptionalNumber(row?.seen_count);
    existingMap.set(addr, typeof seen === "number" && Number.isFinite(seen) ? Math.floor(seen) : 0);
  }

  const toInsert = [];
  const toUpdate = [];

  for (const row of valid) {
    const addr = row.contract_address;
    if (!addr) continue;
    if (existingMap.has(addr)) {
      const current = existingMap.get(addr) ?? 0;
      const next = Math.max(0, Math.floor(current)) + 1;
      toUpdate.push({
        ...row,
        seen_count: next,
        last_seen_at: nowIso,
      });
      continue;
    }
    toInsert.push({
      ...row,
      seen_count: 1,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
    });
  }

  if (toInsert.length > 0) {
    const insertResult = await sb.from(SUPABASE_LEADERBOARD_SNAPSHOT_TABLE).insert(toInsert);
    if (insertResult.error) {
      leaderboardSnapshotState.lastError = {
        stage: "insert_new",
        message: insertResult.error.message,
        code: insertResult.error.code ?? null,
      };
      return { ok: false, error: "Failed to insert new rows", details: insertResult.error };
    }
  }

  for (const row of toUpdate) {
    const updateResult = await sb
      .from(SUPABASE_LEADERBOARD_SNAPSHOT_TABLE)
      .update({
        snapshot_at: row.snapshot_at,
        view_name: row.view_name,
        rank: row.rank,
        dex: row.dex,
        symbol: row.symbol,
        mcap: row.mcap,
        buy_volume_usd: row.buy_volume_usd,
        buy_count: row.buy_count,
        holder_count: row.holder_count,
        score: row.score,
        source_updated_at: row.source_updated_at,
        payload: row.payload,
        last_seen_at: row.last_seen_at,
        seen_count: row.seen_count,
      })
      .eq("contract_address", row.contract_address);

    if (updateResult.error) {
      leaderboardSnapshotState.lastError = {
        stage: "update_existing",
        message: updateResult.error.message,
        code: updateResult.error.code ?? null,
      };
      return { ok: false, error: "Failed to update existing rows", details: updateResult.error };
    }
  }

  leaderboardSnapshotState.lastOkAt = new Date().toISOString();
  leaderboardSnapshotState.lastSnapshotAt = snapshotAt;
  leaderboardSnapshotState.lastInserted = toInsert.length;
  leaderboardSnapshotState.lastUpdated = toUpdate.length;
  return { ok: true, snapshotAt, inserted: toInsert.length, updated: toUpdate.length };
};

let leaderboardSnapshotTimer = null;
let isTakingSnapshot = false;
const startLeaderboardSnapshotScheduler = () => {
  if (!LEADERBOARD_SNAPSHOT_ENABLED) return { ok: true, enabled: false };

  const sb = getSupabase();
  if (!sb) {
    leaderboardSnapshotState.lastError = {
      stage: "init",
      message: "Supabase credentials not configured",
      code: null,
    };
    return { ok: false, error: "Supabase credentials not configured" };
  }

  if (leaderboardSnapshotTimer) return { ok: true, enabled: true, status: "already_running" };

  const tick = async () => {
    if (isTakingSnapshot) return;
    isTakingSnapshot = true;
    try {
      const result = await takeLeaderboardSnapshot({ sb });
      if (!result.ok) {
        process.stdout.write(
          `leaderboard snapshot failed: ${JSON.stringify({ error: result.error, details: leaderboardSnapshotState.lastError })}\n`,
        );
      } else {
        process.stdout.write(
          `leaderboard snapshot ok: ${JSON.stringify({
            snapshotAt: result.snapshotAt,
            inserted: result.inserted,
            updated: result.updated ?? 0,
          })}\n`,
        );
      }
    } finally {
      isTakingSnapshot = false;
    }
  };

  leaderboardSnapshotTimer = setInterval(tick, LEADERBOARD_SNAPSHOT_INTERVAL_MS);
  process.stdout.write(
    `leaderboard snapshot scheduler enabled: ${JSON.stringify({
      intervalMs: LEADERBOARD_SNAPSHOT_INTERVAL_MS,
      limit: LEADERBOARD_SNAPSHOT_LIMIT,
      minHolderCount: LEADERBOARD_SNAPSHOT_MIN_HOLDER_COUNT,
      table: SUPABASE_LEADERBOARD_SNAPSHOT_TABLE,
      view: SUPABASE_LEADERBOARD_VIEW,
    })}\n`,
  );
  void tick();
  return { ok: true, enabled: true };
};

const percentEncode = (value) =>
  encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const buildOauthHeader = ({
  method,
  url,
  consumerKey,
  consumerSecret,
  accessToken,
  accessTokenSecret,
}) => {
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const normalizedParams = Object.entries(oauthParams)
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .sort()
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(normalizedParams),
  ].join("&");

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const headerParams = { ...oauthParams, oauth_signature: signature };
  const headerValue =
    "OAuth " +
    Object.entries(headerParams)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
      .join(", ");

  return headerValue;
};

const formatScore = (value) => {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
};

const formatCompact = (value) => {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
  }).format(value);
};

const takeRandomUnique = (items, count) => {
  const src = Array.isArray(items) ? items.slice() : [];
  const picked = [];
  const n = Math.min(Math.max(0, count | 0), src.length);
  for (let i = 0; i < n; i++) {
    const idx = crypto.randomInt(0, src.length);
    picked.push(src[idx]);
    src.splice(idx, 1);
  }
  return picked;
};

const buildHashtagLine = () => {
  const pool = ["#Solana", "#Moonshot", "#LFG", "#Gems", "#ToTheMoon"];
  return takeRandomUnique(pool, 2).join(" ");
};

const clampTweetLength = (text) => {
  const max = 280;
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3).trimEnd()}...`;
};

const buildLeaderboardTweet = ({ symbol, score, mcap }) => {
  const rawSym = typeof symbol === "string" ? symbol : "";
  const cleanSym = rawSym.trim().replace(/^\$+/, "").toUpperCase();
  const sym = cleanSym ? `$${cleanSym}` : "$TOKEN";
  const hashtags = buildHashtagLine();
  const variant = crypto.randomInt(0, 2);

  const lines =
    variant === 0
      ? [
          `${sym} is about to go mainstream 🚀`,
          "",
          `🔥 ${formatScore(score)} score`,
          "👨‍🍳 The dev is cooking",
          `📈 MCAP: ${formatCompact(mcap)}`,
          "",
          "➡️ Last time you'll see it this low",
          "",
          "Buy now or buy the top when your favorite influencer tweets it. Your choice. 🤷‍♂️",
          "",
          hashtags,
        ]
      : [
          `${sym} is programmed for billions 💎`,
          "",
          `✅ ${formatScore(score)} Score (🗿 Elite Tier)`,
          `✅ MCAP: $${formatCompact(mcap)} (🎁 Literal gift)`,
          "✅ Distribution is looking clean 📊",
          "",
          "The chart is primed and the community is relentless",
          "If you're looking for the next runner on SOL, this is the one 🏃‍♂️💨",
          "",
          hashtags,
        ];

  return clampTweetLength(lines.join("\n"));
};

const processLeaderboardCandidate = async ({
  contractAddress,
  symbol,
  score,
  mcap,
  buyVolumeUsd,
  holderCount,
  rank,
  posted,
}) => {
  const addr = typeof contractAddress === "string" ? contractAddress.trim() : "";
  if (!addr) return { ok: false, status: "error", error: "Missing contractAddress" };
  if (posted.has(addr)) return { ok: true, status: "skipped", reason: "duplicate" };

  const scoreOk = score != null && Number.isFinite(score) && score > 100;
  const rankOk = rank != null && Number.isFinite(rank) && rank >= 1 && rank <= 5;
  const holderOk = holderCount != null && Number.isFinite(holderCount);
  const warning =
    mcap != null &&
    buyVolumeUsd != null &&
    Number.isFinite(mcap) &&
    Number.isFinite(buyVolumeUsd) &&
    buyVolumeUsd > mcap;
  const warningOk = !warning;

  if (!scoreOk || !rankOk || !holderOk || !warningOk) {
    return {
      ok: true,
      status: "skipped",
      reason: "conditions_not_met",
      details: { scoreOk, rankOk, holderOk, warningOk },
    };
  }

  const text = buildLeaderboardTweet({ symbol, score, mcap });
  const result = await postToX({ text });
  posted.add(addr);
  return { ok: true, status: "posted", result };
};

const postToX = async ({ text }) => {
  const url = "https://api.twitter.com/2/tweets";
  const auth = buildOauthHeader({
    method: "POST",
    url,
    consumerKey: X_CONSUMER_KEY,
    consumerSecret: X_CONSUMER_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessTokenSecret: X_ACCESS_TOKEN_SECRET,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      authorization: auth,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  const raw = await resp.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!resp.ok) {
    const msg =
      typeof parsed?.detail === "string"
        ? parsed.detail
        : typeof parsed?.title === "string"
          ? parsed.title
          : `X API error (${resp.status})`;
    const err = new Error(msg);
    err.status = resp.status;
    err.payload = parsed ?? raw;
    throw err;
  }

  return parsed;
};

const handleLeaderboardPost = async (req, res) => {
  const host = String(req.headers.host ?? "");
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (process.env.NODE_ENV === "production") {
    try {
      const originHost = origin ? new URL(origin).host : "";
      if (!originHost || !host || originHost !== host) {
        sendJson(res, 403, { ok: false, error: "Forbidden" });
        return;
      }
    } catch {
      sendJson(res, 403, { ok: false, error: "Forbidden" });
      return;
    }
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") {
    sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  const contractAddress =
    typeof body.contractAddress === "string" ? body.contractAddress.trim() : "";
  const symbol = typeof body.symbol === "string" ? body.symbol : null;
  const score = getOptionalNumber(body.score);
  const mcap = getOptionalNumber(body.mcap);
  const buyVolumeUsd = getOptionalNumber(body.buyVolumeUsd);
  const holderCount = getOptionalNumber(body.holderCount ?? body.holder_count);
  const rank = getOptionalNumber(body.rank);

  if (!contractAddress) {
    sendJson(res, 400, { ok: false, error: "Missing contractAddress" });
    return;
  }

  const hasXCreds =
    Boolean(X_ACCESS_TOKEN) &&
    Boolean(X_ACCESS_TOKEN_SECRET) &&
    Boolean(X_CONSUMER_KEY) &&
    Boolean(X_CONSUMER_SECRET);

  if (!hasXCreds) {
    sendJson(res, 503, { ok: false, error: "X credentials not configured" });
    return;
  }

  const posted = await readPostedSet();
  const outcome = await processLeaderboardCandidate({
    contractAddress,
    symbol,
    score,
    mcap,
    buyVolumeUsd,
    holderCount,
    rank,
    posted,
  });

  if (outcome.ok && outcome.status === "posted") await writePostedSet(posted);
  sendJson(res, outcome.ok ? 200 : 400, outcome);
};

const handleLeaderboardCron = async (req, res, url) => {
  if (!X_POST_CRON_SECRET) {
    sendJson(res, 503, { ok: false, error: "Cron secret not configured" });
    return;
  }
  const token = getCronSecret(req, url);
  if (!token || token !== X_POST_CRON_SECRET) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }

  const hasXCreds =
    Boolean(X_ACCESS_TOKEN) &&
    Boolean(X_ACCESS_TOKEN_SECRET) &&
    Boolean(X_CONSUMER_KEY) &&
    Boolean(X_CONSUMER_SECRET);
  if (!hasXCreds) {
    sendJson(res, 503, { ok: false, error: "X credentials not configured" });
    return;
  }

  const sb = getSupabase();
  if (!sb) {
    sendJson(res, 503, { ok: false, error: "Supabase credentials not configured" });
    return;
  }

  const { data, error } = await sb
    .from(SUPABASE_LEADERBOARD_VIEW)
    .select("contract_address,symbol,mcap,buy_volume_usd,holder_count,score")
    .order("score", { ascending: false })
    .limit(5);

  if (error) {
    sendJson(res, 500, { ok: false, error: "Failed to load leaderboard" });
    return;
  }

  const posted = await readPostedSet();
  const results = [];
  let wrote = false;

  for (let i = 0; i < (data ?? []).length; i++) {
    const row = data[i] ?? {};
    const contractAddress =
      typeof row.contract_address === "string" ? row.contract_address : "";
    const symbol = typeof row.symbol === "string" ? row.symbol : null;
    const score = getOptionalNumber(row.score);
    const mcap = getOptionalNumber(row.mcap);
    const buyVolumeUsd = getOptionalNumber(row.buy_volume_usd);
    const holderCount = getOptionalNumber(row.holder_count);
    const rank = i + 1;

    try {
      const outcome = await processLeaderboardCandidate({
        contractAddress,
        symbol,
        score,
        mcap,
        buyVolumeUsd,
        holderCount,
        rank,
        posted,
      });
      results.push({ contractAddress: contractAddress.trim(), ...outcome });
      if (outcome.ok && outcome.status === "posted") wrote = true;
    } catch {
      results.push({
        contractAddress: contractAddress.trim(),
        ok: false,
        status: "error",
        error: "Unhandled error",
      });
    }
  }

  if (wrote) await writePostedSet(posted);
  sendJson(res, 200, { ok: true, checked: results.length, results });
};

const serveStatic = async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  const filePath =
    pathname === "/" ? path.join(DIST_DIR, "index.html") : path.join(DIST_DIR, pathname);

  const safePath = path.normalize(filePath);
  if (!safePath.startsWith(DIST_DIR)) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  try {
    const stat = await fs.stat(safePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(safePath, "index.html");
      const html = await fs.readFile(indexPath);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    const data = await fs.readFile(safePath);
    const ext = path.extname(safePath).toLowerCase();
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : ext === ".svg"
              ? "image/svg+xml"
              : ext === ".json"
                ? "application/json; charset=utf-8"
                : ext === ".png"
                  ? "image/png"
                  : ext === ".jpg" || ext === ".jpeg"
                    ? "image/jpeg"
                    : "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    });
    res.end(data);
  } catch {
    try {
      const html = await fs.readFile(path.join(DIST_DIR, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
};

const runLeaderboardCronOnce = async () => {
  const hasXCreds =
    Boolean(X_ACCESS_TOKEN) &&
    Boolean(X_ACCESS_TOKEN_SECRET) &&
    Boolean(X_CONSUMER_KEY) &&
    Boolean(X_CONSUMER_SECRET);
  if (!hasXCreds) {
    return { ok: false, error: "X credentials not configured" };
  }

  const sb = getSupabase();
  if (!sb) {
    return { ok: false, error: "Supabase credentials not configured" };
  }

  const { data, error } = await sb
    .from(SUPABASE_LEADERBOARD_VIEW)
    .select("contract_address,symbol,mcap,buy_volume_usd,holder_count,score")
    .order("score", { ascending: false })
    .limit(5);

  if (error) {
    return { ok: false, error: "Failed to load leaderboard" };
  }

  const posted = await readPostedSet();
  const results = [];
  let wrote = false;

  for (let i = 0; i < (data ?? []).length; i++) {
    const row = data[i] ?? {};
    const contractAddress =
      typeof row.contract_address === "string" ? row.contract_address : "";
    const symbol = typeof row.symbol === "string" ? row.symbol : null;
    const score = getOptionalNumber(row.score);
    const mcap = getOptionalNumber(row.mcap);
    const buyVolumeUsd = getOptionalNumber(row.buy_volume_usd);
    const holderCount = getOptionalNumber(row.holder_count);
    const rank = i + 1;

    try {
      const outcome = await processLeaderboardCandidate({
        contractAddress,
        symbol,
        score,
        mcap,
        buyVolumeUsd,
        holderCount,
        rank,
        posted,
      });
      results.push({ contractAddress: contractAddress.trim(), ...outcome });
      if (outcome.ok && outcome.status === "posted") wrote = true;
    } catch {
      results.push({
        contractAddress: contractAddress.trim(),
        ok: false,
        status: "error",
        error: "Unhandled error",
      });
    }
  }

  if (wrote) await writePostedSet(posted);
  return { ok: true, checked: results.length, results };
};

const startWebServer = () => {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === "/api/leaderboard/snapshot/status") {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          state: leaderboardSnapshotState,
          config: {
            enabled: LEADERBOARD_SNAPSHOT_ENABLED,
            intervalMs: LEADERBOARD_SNAPSHOT_INTERVAL_MS,
            limit: LEADERBOARD_SNAPSHOT_LIMIT,
            minHolderCount: LEADERBOARD_SNAPSHOT_MIN_HOLDER_COUNT,
            view: SUPABASE_LEADERBOARD_VIEW,
            table: SUPABASE_LEADERBOARD_SNAPSHOT_TABLE,
            hasSupabaseUrl: Boolean(SUPABASE_URL),
            keyType: SUPABASE_KEY
              ? SUPABASE_KEY === (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
              ? "service_role"
              : SUPABASE_KEY === (process.env.SUPABASE_SERVICE_KEY ?? "")
                ? "service_role"
                : "anon_or_other"
              : "missing",
          },
        });
        return;
      }

      if (url.pathname === "/api/leaderboard/snapshot/run") {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        if (LEADERBOARD_SNAPSHOT_SECRET) {
          const token = getCronSecret(req, url);
          if (!token || token !== LEADERBOARD_SNAPSHOT_SECRET) {
            sendJson(res, 403, { ok: false, error: "Forbidden" });
            return;
          }
        }

        const sb = getSupabase();
        if (!sb) {
          sendJson(res, 503, { ok: false, error: "Supabase credentials not configured" });
          return;
        }

        const result = await takeLeaderboardSnapshot({ sb });
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

      if (url.pathname === "/api/leaderboard/history") {
        if (req.method !== "GET") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        const sb = getSupabase();
        if (!sb) {
          sendJson(res, 503, { ok: false, error: "Supabase credentials not configured" });
          return;
        }

        const minHolders = getOptionalNumber(url.searchParams.get("min_holders")) ?? 0;
        const limitRaw = getOptionalNumber(url.searchParams.get("limit")) ?? 30;
        const limit = Math.min(250, Math.max(1, Math.floor(limitRaw)));

        const snapshotAtParam = getOptionalString(url.searchParams.get("snapshot_at"));
        let snapshotAt = snapshotAtParam;
        if (!snapshotAt) {
          const latest = await sb
            .from(SUPABASE_LEADERBOARD_SNAPSHOT_TABLE)
            .select("snapshot_at")
            .order("snapshot_at", { ascending: false })
            .limit(1);

          if (latest.error) {
            sendJson(res, 500, { ok: false, error: "Failed to load snapshots" });
            return;
          }
          snapshotAt = getOptionalString(latest.data?.[0]?.snapshot_at);
        }

        if (!snapshotAt) {
          sendJson(res, 200, { ok: true, snapshotAt: null, rows: [] });
          return;
        }

        let query = sb
          .from(SUPABASE_LEADERBOARD_SNAPSHOT_TABLE)
          .select(
            "snapshot_at,view_name,rank,contract_address,dex,symbol,mcap,buy_volume_usd,buy_count,holder_count,score,source_updated_at",
          )
          .eq("snapshot_at", snapshotAt)
          .order("rank", { ascending: true })
          .limit(limit);

        if (minHolders > 0) query = query.gte("holder_count", Math.floor(minHolders));

        const { data, error } = await query;
        if (error) {
          sendJson(res, 500, { ok: false, error: "Failed to load leaderboard history" });
          return;
        }

        sendJson(res, 200, { ok: true, snapshotAt, rows: data ?? [] });
        return;
      }

      if (url.pathname === "/api/x/liveleaderboard") {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        await handleLeaderboardPost(req, res);
        return;
      }

      if (url.pathname === "/api/x/liveleaderboard/cron") {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }
        await handleLeaderboardCron(req, res, url);
        return;
      }

      await serveStatic(req, res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: "Internal server error" });
    }
  });

  server.listen(PORT, () => {
    process.stdout.write(`server listening on :${PORT}\n`);
  });

  startLeaderboardSnapshotScheduler();
};

if (process.env.RUN_LEADERBOARD_CRON === "1") {
  runLeaderboardCronOnce()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.ok ? 0 : 1);
    })
    .catch(() => {
      process.exit(1);
    });
} else {
  startWebServer();
}
