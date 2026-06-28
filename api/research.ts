import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { research } from '../lib/apify.js';

// Apify Actor runs can take 20-60s, so allow a longer function timeout.
export const config = { maxDuration: 60 };

// How long the CDN caches each unique query. Popular/repeated searches are
// served from Vercel's edge WITHOUT re-running this function or hitting Apify.
const CACHE_TTL = 900; // 15 minutes

// Global cap across ALL users. Each search runs an Apify Actor (which costs
// credits), so this protects both your Apify budget and avoids hammering it.
const GLOBAL_PER_MIN = 25;

// Rate limiting is enabled automatically only when Upstash is configured
// (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN); otherwise it's a no-op.
// It runs only on cache MISSES — i.e. exactly when a request would spend Apify
// credits. (No per-IP limit: the team shares an office, hence one shared IP.)
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const query = (req.query.query ?? req.query.q) as string | undefined;
  if (!query) {
    res.status(400).json({ error: 'Missing required "query" parameter.' });
    return;
  }

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
    const data = await research({
      query,
      subreddit: (req.query.subreddit as string) || undefined,
      time: (req.query.time as string) || 'all',
      limit: Math.min(req.query.limit ? Number(req.query.limit) : 20, 50),
    });

    // Cache this query on Vercel's CDN so repeats are served without re-running Apify.
    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_TTL}, stale-while-revalidate=3600`);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
