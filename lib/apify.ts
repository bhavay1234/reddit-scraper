/**
 * Apify-backed Reddit data source.
 *
 * Instead of calling Reddit's OAuth API directly (which now requires app
 * approval), we run an Apify "Reddit scraper" Actor and shape its dataset
 * items into the same structure the frontend expects. No Reddit credentials
 * needed — just an Apify API token.
 *
 * Config (env vars):
 *   APIFY_API_TOKEN  (required) — from https://console.apify.com/account/integrations
 *   APIFY_ACTOR      (optional) — Actor id, "user~actor" form.
 *                                 Default: trudax~reddit-scraper-lite
 *
 * Field names below are mapped defensively because different Actors use
 * slightly different keys; unmatched fields fall back to 0 / "" gracefully.
 */
const APIFY_BASE = 'https://api.apify.com/v2';
const DEFAULT_ACTOR = 'trudax~reddit-scraper-lite';

export interface ResearchOptions {
  query: string;
  subreddit?: string;
  time?: string;
  limit?: number;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return 0;
}
/** Accepts epoch seconds, epoch millis, or an ISO date string; returns epoch seconds. */
function toEpoch(v: unknown): number {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
  }
  return 0;
}
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

async function runActor(token: string, actor: string, input: unknown): Promise<Record<string, unknown>[]> {
  const url = `${APIFY_BASE}/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400);
    throw new Error(`Apify run failed (${res.status}). ${detail}`.trim());
  }
  const items = await res.json();
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

function shapePost(item: Record<string, unknown>) {
  const community = str(pick(item, ['communityName', 'parsedCommunityName', 'subreddit', 'community']))
    .replace(/^\/?r\//i, '');
  const permalink = str(pick(item, ['url', 'link', 'postUrl', 'permalink']));
  const body = str(pick(item, ['body', 'text', 'selftext', 'description', 'html']));
  return {
    id: str(pick(item, ['id', 'postId'])),
    title: str(pick(item, ['title'])),
    subreddit: community,
    author: str(pick(item, ['username', 'author', 'authorName'])).replace(/^\/?u\//i, ''),
    score: num(pick(item, ['upVotes', 'score', 'numberOfUpvotes', 'upvotes', 'ups'])),
    num_comments: num(pick(item, ['numberOfComments', 'numComments', 'commentsCount', 'num_comments'])),
    created_utc: toEpoch(pick(item, ['createdAt', 'created', 'createdAtIso', 'created_utc', 'date'])),
    permalink,
    url: permalink,
    snippet: body ? body.replace(/\s+/g, ' ').trim().slice(0, 280) : undefined,
  };
}

export async function research(opts: ResearchOptions) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error(
      'Missing APIFY_API_TOKEN. Get a token at https://console.apify.com/account/integrations and set it in the environment.'
    );
  }
  const actor = process.env.APIFY_ACTOR || DEFAULT_ACTOR;
  const limit = opts.limit ?? 20;

  const input: Record<string, unknown> = {
    searches: [opts.query],
    type: 'posts',
    sort: 'RELEVANCE',
    maxItems: limit,
    maxPostCount: limit,
    skipComments: true,
    proxy: { useApifyProxy: true },
  };
  if (opts.subreddit) {
    input.startUrls = [
      {
        url: `https://www.reddit.com/r/${opts.subreddit}/search/?q=${encodeURIComponent(
          opts.query
        )}&restrict_sr=1&sort=relevance`,
      },
    ];
  }

  const items = await runActor(token, actor, input);
  const posts = items
    .filter((it) => !it.dataType || it.dataType === 'post')
    .map(shapePost)
    .filter((p) => p.title);

  const counts = new Map<string, number>();
  for (const p of posts) if (p.subreddit) counts.set(p.subreddit, (counts.get(p.subreddit) ?? 0) + 1);
  const top_subreddits = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, post_count]) => ({ name, post_count }));

  const recent_mentions = [...posts]
    .sort((a, b) => b.created_utc - a.created_utc)
    .slice(0, 10)
    .map((p) => ({
      title: p.title,
      subreddit: p.subreddit,
      score: p.score,
      num_comments: p.num_comments,
      created_utc: p.created_utc,
      permalink: p.permalink,
    }));

  return {
    query: opts.query,
    time: opts.time || 'all',
    top_subreddits,
    posts,
    recent_mentions,
  };
}
