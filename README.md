# reddit-scraper

Two ways to use the same read-only Reddit research engine:

- **Web app** (`/` + `/api`) — a frontend + serverless API you can deploy to
  Vercel and open at a public URL.
- **MCP server** (`mcp-reddit/`) — the same logic exposed as a Model Context
  Protocol server for Claude Desktop / Claude Code. See
  [`mcp-reddit/README.md`](mcp-reddit/README.md).

Both share one implementation of the research logic in
`mcp-reddit/src/reddit.ts`.

## Deploy to Vercel

1. **Get Reddit API credentials** at <https://www.reddit.com/prefs/apps> —
   create an app (type `script` or `web app`). The **client id** is the string
   under the app name; the **client secret** is labelled "secret".

2. **Import the repo** into Vercel (no build settings needed — it's a static
   `index.html` plus a serverless function in `api/`).

3. **Add Environment Variables** in the Vercel project settings:

   | Name | Value |
   | ---- | ----- |
   | `REDDIT_CLIENT_ID` | your client id |
   | `REDDIT_CLIENT_SECRET` | your client secret |
   | `REDDIT_USER_AGENT` | `reddit-mcp/1.0 (by /u/your_username)` |

   Optional (for account-context reads, requires a `script` app):
   `REDDIT_USERNAME`, `REDDIT_PASSWORD`.

4. **Deploy.** Open the public URL, type a theme/keyword/brand, and you'll get
   the relevant discussions, communities, recent mentions, and (on request) top
   comments.

> Reddit requires a unique, descriptive `User-Agent` and enforces ~60–100
> requests/minute per app. The app uses application-only (read-only) access by
> default.

## Sharing it publicly (scaling & rate limits)

A single Reddit app is shared by **everyone** who opens the link, and each
search makes several Reddit calls — so a public/LinkedIn link needs two
protections. Both are built in:

**1. Edge caching (automatic, no setup).** Every response is cached on Vercel's
CDN for 15 minutes per unique query. Repeated searches for the same term (the
common case when a link is shared) are served from the edge **without hitting
Reddit or even re-invoking the function**. This absorbs the bulk of public
traffic for free.

**2. Per-IP rate limiting (recommended before sharing widely).** Enable it by
creating a free [Upstash Redis](https://upstash.com/) database and adding its
two env vars in Vercel:

   | Name | Value |
   | ---- | ----- |
   | `UPSTASH_REDIS_REST_URL` | from the Upstash console |
   | `UPSTASH_REDIS_REST_TOKEN` | from the Upstash console |

When present, two limits apply (both only on cache *misses*, so they cost
almost nothing):

- **Per visitor — 5 searches/min.** Stops one person or a script from hogging
  the shared quota.
- **Global — 25 searches/min across everyone.** Keeps total throughput under
  Reddit's ~100 req/min so the shared app never gets throttled or flagged when
  many people (e.g. a whole team) research at once. When the team is at the cap,
  users get a friendly "busy, try again in Ns" message and the UI auto-retries
  once after the cooldown.

If the Upstash vars are absent the app still runs — it just skips rate limiting.
To tune the limits, edit `IP_PER_MIN` / `GLOBAL_PER_MIN` at the top of
`api/research.ts`. Comments are off by default on the public endpoint (they add
extra Reddit calls); users opt in with the "Top comments" checkbox.

> **Note for larger teams:** a single free Reddit app caps the whole tool at
> ~100 Reddit req/min. With unique-query research (where caching can't help),
> that's roughly 25–30 searches/min shared across all users. If that's too
> tight for sustained heavy use, request a higher quota from Reddit or run a
> second app — but the global limiter ensures you degrade gracefully rather
> than getting the app throttled.

## API

`GET /api/research?query=<term>&time=<day|week|month|year|all>&subreddit=<optional>&include_comments=<true|false>`

Returns JSON: `relevant_communities`, `top_subreddits`, `posts`,
`recent_mentions`, and `highlights` (top comments).

## Run locally

```bash
vercel dev        # serves index.html + /api with your env vars
```

(Or use the [Vercel CLI](https://vercel.com/docs/cli). Set the env vars above in
a `.env` file or your shell first.)
