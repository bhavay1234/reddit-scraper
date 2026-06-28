# reddit-scraper

A read-only Reddit research tool. Enter a theme, keyword, topic, or brand name
and get the relevant discussions, the communities involved, and recent mentions.

- **Web app** (`/` + `/api`) — a frontend + serverless API you deploy to Vercel
  and open at a public URL. **Data comes from [Apify](https://apify.com/)** (a
  Reddit scraper Actor), so it needs **no Reddit account or API approval** — just
  an Apify token.
- **MCP server** (`mcp-reddit/`) — a separate Model Context Protocol server for
  Claude Desktop / Claude Code. It uses Reddit's official OAuth API (needs Reddit
  credentials). See [`mcp-reddit/README.md`](mcp-reddit/README.md).

> **Why Apify?** Reddit's own Data API now gates app creation behind an approval
> process. Apify runs the scraping for you and exposes it via a simple API, which
> keeps this tool working without fighting Reddit's approval flow.

## Deploy to Vercel

1. **Get an Apify API token.** Sign up at <https://console.apify.com>, then copy
   your token from **Settings → Integrations → API token** (or
   <https://console.apify.com/account/integrations>). New accounts include free
   monthly credits.

2. **Pick the Reddit Actor** (optional). The default is
   [`trudax/reddit-scraper-lite`](https://apify.com/trudax/reddit-scraper-lite).
   To use a different one, set `APIFY_ACTOR` to its id in `user~actor` form
   (e.g. `trudax~reddit-scraper`).

3. **Import the repo** into Vercel (no build settings needed — it's a static
   `index.html` plus a serverless function in `api/`).

4. **Add Environment Variables** in the Vercel project settings:

   | Name | Value |
   | ---- | ----- |
   | `APIFY_API_TOKEN` | your Apify token (required) |
   | `APIFY_ACTOR` | Actor id, e.g. `trudax~reddit-scraper-lite` (optional) |

   Plus the two Upstash vars below to enable the shared rate limiter.

5. **Deploy.** Open the public URL, type a theme/keyword/brand, and you'll get
   the relevant discussions, the communities they come up in, recent mentions,
   and top comments from the most-discussed threads (the UGC).

> **First-call latency:** an Apify Actor run takes ~20–60s, so the *first* search
> for a term is slow — and scraping comments (on by default) roughly doubles that.
> After that it's cached for 15 minutes (see below), so repeats are instant. The
> serverless function is configured with a 60s timeout; if comment-heavy searches
> time out, untick **Top comments** in the UI (or lower `limit`).

## Cost & rate limiting (for team use)

Every *unique* search runs an Apify Actor, which spends Apify credits — so two
protections are built in:

**1. Edge caching (automatic, no setup).** Each response is cached on Vercel's
CDN for 15 minutes per unique query. Repeated searches for the same term are
served from the edge **without re-running Apify** — saving both time and credits.

**2. Global rate limit (recommended).** Create a free
[Upstash Redis](https://upstash.com/) database and add its two env vars:

   | Name | Value |
   | ---- | ----- |
   | `UPSTASH_REDIS_REST_URL` | from the Upstash console |
   | `UPSTASH_REDIS_REST_TOKEN` | from the Upstash console |

This caps the whole team at **25 searches/min** (only on cache *misses*), so a
busy day can't unexpectedly burn through your Apify credits. At the cap, users
get a friendly "busy, try again in Ns" message and the UI auto-retries once.

There is intentionally **no per-IP limit** — the team works from one office (a
single shared IP), so a per-IP cap would throttle everyone together. If the
Upstash vars are absent the app still runs; it just skips the limit. To tune it,
edit `GLOBAL_PER_MIN` at the top of `api/research.ts`.

## API

`GET /api/research?query=<term>&subreddit=<optional>&limit=<1-50>&include_comments=<true|false>`

Returns JSON: `query`, `time`, `top_subreddits`, `posts`, `recent_mentions`, and
`highlights` (top comments per leading thread; present when `include_comments` is
not `false`).

## Run locally

```bash
vercel dev        # serves index.html + /api with your env vars
```

Set `APIFY_API_TOKEN` (and optionally the Upstash vars) in a `.env` file or your
shell first. See [the Vercel CLI docs](https://vercel.com/docs/cli).

## Adjusting the data mapping

Different Apify Reddit Actors return slightly different field names. The mapping
lives in `lib/apify.ts` (`shapePost` for posts, `shapeComment` for comments) and
reads several common aliases for each field. If a column comes back empty after
your first real run, check one dataset item in the Apify console and add its key
to the relevant `pick([...])` list. Comments are handled whether the Actor embeds
them on each post or returns them as standalone items.
