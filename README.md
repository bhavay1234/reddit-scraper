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
   the relevant discussions, communities, recent mentions, and top comments.

> Reddit requires a unique, descriptive `User-Agent` and enforces ~60
> requests/minute per token. The app uses application-only (read-only) access
> by default.

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
