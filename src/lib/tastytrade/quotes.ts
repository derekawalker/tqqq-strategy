import WebSocket from "ws";
import { tastyFetch } from "./client";

/** Convert OCC symbol "TQQQ  260515P00056000" → DXLink streamer symbol ".TQQQ260515P56" */
function occToStreamer(sym: string): string {
  const m = sym.replace(/\s+/g, "").match(/^(.+?)(\d{6})([CP])(\d{8})$/);
  if (!m) return "";
  const [, root, date, cp, strikeRaw] = m;
  const strike = parseInt(strikeRaw, 10) / 1000;
  const strikeStr = strike % 1 === 0 ? strike.toFixed(0) : strike.toString();
  return `.${root}${date}${cp}${strikeStr}`;
}

/** Core DXLink fetcher. Takes raw DXLink symbols, returns symbol → bid/ask midpoint. */
async function dxlinkMarks(symbols: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (symbols.length === 0) return result;

  try {
    const tokenRes = await tastyFetch("/api-quote-tokens");
    if (!tokenRes.ok) return result;
    const tokenJson = await tokenRes.json();
    const token: string = tokenJson.data?.token;
    const wsUrl: string = tokenJson.data?.["dxlink-url"];
    if (!token || !wsUrl) return result;

    await new Promise<void>((resolve) => {
      const pending = new Set(symbols);
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }
        resolve();
      };

      const timer = setTimeout(finish, 8000);

      const ws = new WebSocket(wsUrl, { headers: { Authorization: token } });

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "SETUP", channel: 0, version: "0.1", minVersion: "0.1",
          keepaliveTimeout: 10, acceptKeepaliveTimeout: 10,
        }));
        ws.send(JSON.stringify({ type: "AUTH", channel: 0, token }));
      });

      ws.on("message", (data) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg: any = JSON.parse(data.toString());
        switch (msg.type) {
          case "SETUP":
            ws.send(JSON.stringify({
              type: "SETUP", channel: 0, version: "0.1", minVersion: "0.1",
              keepaliveTimeout: 10, acceptKeepaliveTimeout: 10,
            }));
            break;
          case "AUTH_STATE":
            if (msg.state === "UNAUTHORIZED") {
              ws.send(JSON.stringify({ type: "AUTH", channel: 0, token }));
            } else if (msg.state === "AUTHORIZED") {
              ws.send(JSON.stringify({
                type: "CHANNEL_REQUEST", channel: 1,
                service: "FEED", parameters: { contract: "AUTO" },
              }));
            }
            break;
          case "CHANNEL_OPENED":
            if (msg.channel === 1) {
              ws.send(JSON.stringify({
                type: "FEED_SETUP", channel: 1,
                acceptAggregationPeriod: 0, acceptDataFormat: "COMPACT",
                acceptEventFields: { Quote: ["eventSymbol", "bidPrice", "askPrice"] },
              }));
              ws.send(JSON.stringify({
                type: "FEED_SUBSCRIPTION", channel: 1,
                add: symbols.map((s) => ({ type: "Quote", symbol: s })),
              }));
            }
            break;
          case "FEED_DATA": {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const feedData: any[] = msg.data ?? [];
            for (let i = 0; i + 1 < feedData.length; i += 2) {
              if (feedData[i] !== "Quote") continue;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const flat: any[] = feedData[i + 1] ?? [];
              for (let j = 0; j + 2 < flat.length; j += 3) {
                const sym = flat[j];
                const bid = flat[j + 1];
                const ask = flat[j + 2];
                if (typeof bid === "number" && typeof ask === "number" && bid >= 0 && ask >= 0) {
                  result.set(sym, (bid + ask) / 2);
                  pending.delete(sym);
                }
              }
            }
            if (pending.size === 0) finish();
            break;
          }
          case "KEEPALIVE":
            ws.send(JSON.stringify({ type: "KEEPALIVE", channel: 0 }));
            break;
        }
      });

      ws.on("error", () => { /* finish fires on close */ });
      ws.on("close", () => finish());
    });
  } catch {
    // fall through — return whatever was collected
  }

  return result;
}

// Module-level cache — avoids opening multiple WebSocket connections in rapid succession
const CACHE_TTL_MS = 30_000;
let marksCache: Map<string, number> = new Map();
let marksCacheTime = 0;

/**
 * Real-time marks for OCC option symbols via DXLink.
 * Results are cached for 30 seconds to avoid redundant WebSocket connections.
 * Returns trimmed OCC symbol → mark price per share.
 */
export async function getOptionMarks(occSymbols: string[]): Promise<Map<string, number>> {
  const streamerToOcc = new Map<string, string>();
  const streamerSymbols: string[] = [];
  for (const occ of occSymbols) {
    const streamer = occToStreamer(occ.trim());
    if (streamer) {
      streamerSymbols.push(streamer);
      streamerToOcc.set(streamer, occ.trim());
    }
  }
  // Return from cache if fresh enough — avoids a new WebSocket per rapid refresh
  const now = Date.now();
  const allCached = occSymbols.every((s) => marksCache.has(s.trim()));
  if (allCached && now - marksCacheTime < CACHE_TTL_MS) {
    const cached = new Map<string, number>();
    for (const occ of occSymbols) {
      const mark = marksCache.get(occ.trim());
      if (mark !== undefined) cached.set(occ.trim(), mark);
    }
    return cached;
  }

  const raw = await dxlinkMarks(streamerSymbols);
  const result = new Map<string, number>();
  for (const [streamer, mark] of raw) {
    const occ = streamerToOcc.get(streamer);
    if (occ) result.set(occ, mark);
  }

  // Update cache with fresh marks
  for (const [sym, mark] of result) marksCache.set(sym, mark);
  marksCacheTime = now;

  return result;
}

/**
 * Real-time bid/ask midpoint for an equity symbol via DXLink.
 * Returns null if tastytrade is not configured or the quote is unavailable.
 */
export async function getEquityMark(symbol: string): Promise<number | null> {
  if (!process.env.TASTYTRADE_USERNAME) return null;
  // Use cache if fresh
  const now = Date.now();
  if (marksCache.has(symbol) && now - marksCacheTime < CACHE_TTL_MS) {
    return marksCache.get(symbol) ?? null;
  }
  const marks = await dxlinkMarks([symbol]);
  const mark = marks.get(symbol) ?? null;
  if (mark !== null) {
    marksCache.set(symbol, mark);
    marksCacheTime = now;
  }
  return mark;
}
