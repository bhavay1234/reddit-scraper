import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { RedditClient, configFromEnv, research } from '../mcp-reddit/src/reddit.js';

// How long the CDN caches each unique query. Popular/repeated searches are
// served from Vercel's edge WITHOUT re-invoking this function or hitting Reddit.
const CACHE_TTL = 900; // 15 minutes

// Global cap across ALL users: keeps total throughput under Reddit's ~100 req/min.
// Each search makes ~3 Reddit calls, so 25/min ≈ 75 calls/min — safe headroom.
// (No per-IP limit: the team shares an office, hence a single NAT'd IP.)
const GLOBAL_PER_MIN = 25;

// Rate limiting is enabled automatically only when Upstash is configured
// (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN); otherwise it's a no-op so
// the app still works. The limiter runs only on cache MISSES — i.e. exactly when
// a request would otherwise consume the shared Reddit quota.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;
const globalLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(GLOBAL_PER_MIN, '60 s'),
      prefix: 'reddit-research:global',
    })
  : null;

const waitSecs = (reset: number) => Math.max(1, Math.ceil((reset - Date.now()) / 1000));

// Reused across warm invocations so the OAuth token is cached, not re-fetched.
let client: RedditClient | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const query = (req.query.query ?? req.query.q) as string | undefined;
  if (!query) {
    res.status(400).json({ error: 'Missing required "query" parameter.' });
    return;
  }

  // Global team-wide limit (keeps total throughput under Reddit's ~100 req/min).
  if (globalLimit) {
    const { success, reset } = await globalLimit.limit('all');
    if (!success) {
      const secs = waitSecs(reset);
      res.setHeader('Retry-After', secs);
      res
        .status(429)
        .json({ error: `The tool is busy across the team right now. Try again in ${secs}s.` });
      return;
    }
  }

  try {
    client ??= new RedditClient(configFromEnv());
    const data = await research(client, {
      query,
      subreddit: (req.query.subreddit as string) || undefined,
      time: (req.query.time as string) || 'month',
      // Capped for public use to limit fan-out (each post can add a Reddit call).
      limit: Math.min(req.query.limit ? Number(req.query.limit) : 15, 25),
      // Off by default: comments add up to 3 extra Reddit requests per search.
      include_comments: req.query.include_comments === 'true',
    });

    // Tell Vercel's CDN to cache this query at the edge. Repeat searches for the
    // same term are then served globally without touching Reddit or this function.
    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=3600`);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
