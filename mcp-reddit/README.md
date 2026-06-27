# Reddit MCP server

A standalone, **read-only** [Model Context Protocol](https://modelcontextprotocol.io)
server for the Reddit API. It connects to Reddit over OAuth2 and exposes a small
set of tools that let MCP clients (Claude Desktop, Claude Code, etc.) search and
read Reddit.

The headline tool is **`reddit_research`**: give it a theme, keyword, topic, or
brand name and it returns the relevant discussions, the communities involved,
recent mentions, and top comments — all in one call.

## Tools

| Tool | What it does |
| ---- | ------------ |
| **`reddit_research`** | **One-shot research for a theme, keyword, topic, or brand name.** Returns the most relevant discussions, the communities where the term comes up (`relevant_communities` + `top_subreddits`), recent mentions, and — when `include_comments` is on — top comments from the most-discussed matching threads. Start here when you just have a term and want to know what Reddit is saying about it. |
| `search_reddit` | Search posts across all of Reddit or within one subreddit. Returns title, author, score, comment count, and permalink. |
| `get_subreddit_posts` | List posts from a subreddit by sort order (`hot`, `new`, `top`, `rising`, `controversial`), with pagination via `after`. |
| `get_post_comments` | Fetch a single post and its nested comment tree by post id (`1abc23`, `t3_1abc23`, or `subreddit/post_id`). |
| `search_subreddits` | Find subreddits by name/topic. Returns name, title, subscriber count, and description. |
| `get_subreddit_info` | Metadata about a subreddit: title, subscriber count, description, creation date. |
| `get_user_posts` | A user's recent `submitted` posts, `comments`, or `overview`. |

All output is JSON, flattened from Reddit's verbose "Thing"/"Listing" envelopes
down to the fields that matter.

## Getting Reddit API credentials

1. Go to <https://www.reddit.com/prefs/apps> (logged into your Reddit account).
2. Click **"create another app..."** at the bottom.
3. Choose an app type:
   - **`script`** — for personal use. Lets you optionally use the *password
     grant* (reads with your account's context) by also setting
     `REDDIT_USERNAME` / `REDDIT_PASSWORD`.
   - **`web app`** — works with application-only (read-only public) access.
4. Set a name and (for web apps) a redirect URI such as `http://localhost`.
5. After creating it:
   - The **client id** is the string shown directly **under the app name**.
   - The **client secret** is the value labelled **"secret"**.

Copy `.env.example` to `.env` and fill these in:

```
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_USER_AGENT=reddit-mcp/1.0 (by /u/your_username)
# Optional, for account-context reads (script app):
# REDDIT_USERNAME=your_username
# REDDIT_PASSWORD=your_password
```

By default the server uses the **`client_credentials`** grant (application-only,
read-only public data). If both `REDDIT_USERNAME` and `REDDIT_PASSWORD` are set,
it automatically switches to the **`password`** grant (requires a `script` app).

### Reddit limits & User-Agent

- Reddit enforces roughly **60 requests per minute** per OAuth token. The server
  surfaces a clear error on a `429`.
- Reddit **requires a unique, descriptive `User-Agent`** on every request. Set
  `REDDIT_USER_AGENT` to something identifying your app, e.g.
  `reddit-mcp/1.0 (by /u/your_username)`. A generic default is used if you omit
  it, but a unique one is strongly recommended.

## Install & build

```bash
cd mcp-reddit
npm install
npm run build
```

This compiles TypeScript to `dist/`. The executable entry point is
`dist/index.js`. For local development without building, use `npm run dev`
(runs `src/index.ts` via `tsx`).

## Connect in Claude Desktop

Edit your `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add a `reddit` entry under `mcpServers`, pointing `node` at the **absolute path**
to the built `dist/index.js`:

```json
{
  "mcpServers": {
    "reddit": {
      "command": "node",
      "args": ["/absolute/path/to/reddit-scraper/mcp-reddit/dist/index.js"],
      "env": {
        "REDDIT_CLIENT_ID": "your_client_id",
        "REDDIT_CLIENT_SECRET": "your_client_secret",
        "REDDIT_USER_AGENT": "reddit-mcp/1.0 (by /u/your_username)"
      }
    }
  }
}
```

Restart Claude Desktop. The Reddit tools will appear in the tool picker.

## Connect in Claude Code

From the repo root, after building:

```bash
claude mcp add reddit \
  -e REDDIT_CLIENT_ID=your_client_id \
  -e REDDIT_CLIENT_SECRET=your_client_secret \
  -e "REDDIT_USER_AGENT=reddit-mcp/1.0 (by /u/your_username)" \
  -- node "$(pwd)/mcp-reddit/dist/index.js"
```

Then run `claude mcp list` to confirm it's connected. See
`.mcp.json.example` for a project-scoped configuration you can commit (it reads
credentials from environment variables).

## License

Read-only client for public Reddit data. Respect
[Reddit's API terms](https://www.redditinc.com/policies/data-api-terms) and rate
limits.
