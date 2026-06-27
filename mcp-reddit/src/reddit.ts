/**
 * Minimal Reddit API client.
 *
 * Auth uses OAuth2. Two modes, selected automatically by which env vars exist:
 *   - "password" grant  — when REDDIT_USERNAME + REDDIT_PASSWORD are set.
 *     Requires a "script" type app. Reads with the account's context.
 *   - "client_credentials" grant (application-only) — the default. Read-only
 *     access to public data. Works with "web app" / "script" type apps.
 *
 * Create an app at https://www.reddit.com/prefs/apps to obtain the
 * client id (under the app name) and client secret.
 *
 * Reddit requires a unique, descriptive User-Agent on every request and
 * enforces ~60 requests/minute per OAuth token.
 */
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';

export interface RedditConfig {
  clientId: string;
  clientSecret: string;
  username?: string;
  password?: string;
  userAgent: string;
}

/** Read config from the environment, throwing a clear error if required keys are missing. */
export function configFromEnv(): RedditConfig {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing REDDIT_CLIENT_ID and/or REDDIT_CLIENT_SECRET. ' +
        'Create an app at https://www.reddit.com/prefs/apps and set these env vars.'
    );
  }
  return {
    clientId,
    clientSecret,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
    userAgent:
      process.env.REDDIT_USER_AGENT ||
      'reddit-mcp/1.0 (Model Context Protocol server)',
  };
}

export class RedditClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly cfg: RedditConfig) {}

  /** Fetch (and cache) an OAuth access token. Refreshes ~1 min before expiry. */
  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt) return this.token;

    const basic = Buffer.from(
      `${this.cfg.clientId}:${this.cfg.clientSecret}`
    ).toString('base64');

    const body = new URLSearchParams();
    if (this.cfg.username && this.cfg.password) {
      body.set('grant_type', 'password');
      body.set('username', this.cfg.username);
      body.set('password', this.cfg.password);
    } else {
      body.set('grant_type', 'client_credentials');
    }

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': this.cfg.userAgent,
      },
      body,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Reddit auth failed (${res.status}). Check your credentials and app type. ${detail}`.trim()
      );
    }

    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!json.access_token) {
      throw new Error(`Reddit auth returned no token${json.error ? `: ${json.error}` : ''}.`);
    }

    this.token = json.access_token;
    this.tokenExpiresAt = now + (json.expires_in ?? 3600) * 1000 - 60_000;
    return this.token;
  }

  /**
   * Authenticated GET against the OAuth API. `path` is relative to
   * https://oauth.reddit.com (e.g. "/r/programming/hot"). Retries once on a 401
   * after forcing a token refresh.
   */
  async get(path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const url = new URL(API_BASE + path);
    url.searchParams.set('raw_json', '1');
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }

    const doFetch = async (token: string) =>
      fetch(url, {
        headers: { authorization: `Bearer ${token}`, 'user-agent': this.cfg.userAgent },
      });

    let res = await doFetch(await this.getToken());
    if (res.status === 401) {
      this.token = null;
      res = await doFetch(await this.getToken());
    }
    if (res.status === 429) {
      throw new Error('Reddit rate limit hit (429). Wait a minute and try again.');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Reddit API error (${res.status}) for ${path}. ${detail}`.trim());
    }
    return res.json();
  }
}

/* ------------------------------------------------------------------ */
/* Response shaping — Reddit's "Thing"/"Listing" envelopes are verbose; */
/* we flatten to the fields that matter for an LLM.                     */
/* ------------------------------------------------------------------ */

interface ListingChild {
  kind: string;
  data: Record<string, unknown>;
}
interface Listing {
  data?: { children?: ListingChild[]; after?: string | null };
}

export interface Post {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  score: number;
  upvote_ratio?: number;
  num_comments: number;
  created_utc: number;
  permalink: string;
  url: string;
  selftext?: string;
  over_18?: boolean;
  flair?: string | null;
}

export interface Comment {
  id: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  permalink: string;
  replies: Comment[];
}

export interface SubredditInfo {
  name: string;
  title: string;
  subscribers: number;
  public_description: string;
  description?: string;
  over18: boolean;
  url: string;
  created_utc: number;
}

function s(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function n(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

export function shapePost(data: Record<string, unknown>): Post {
  return {
    id: s(data.id),
    title: s(data.title),
    author: s(data.author),
    subreddit: s(data.subreddit),
    score: n(data.score),
    upvote_ratio: typeof data.upvote_ratio === 'number' ? data.upvote_ratio : undefined,
    num_comments: n(data.num_comments),
    created_utc: n(data.created_utc),
    permalink: 'https://www.reddit.com' + s(data.permalink),
    url: s(data.url),
    selftext: s(data.selftext) || undefined,
    over_18: Boolean(data.over_18),
    flair: (data.link_flair_text as string | null) ?? null,
  };
}

export function postsFromListing(listing: unknown): { posts: Post[]; after: string | null } {
  const l = listing as Listing;
  const children = l?.data?.children ?? [];
  return {
    posts: children.filter((c) => c.kind === 't3').map((c) => shapePost(c.data)),
    after: l?.data?.after ?? null,
  };
}

export function shapeComment(child: ListingChild): Comment | null {
  if (child.kind !== 't1') return null;
  const d = child.data;
  const repliesRaw = d.replies;
  let replies: Comment[] = [];
  if (repliesRaw && typeof repliesRaw === 'object') {
    const inner = (repliesRaw as Listing).data?.children ?? [];
    replies = inner.map(shapeComment).filter((c): c is Comment => c !== null);
  }
  return {
    id: s(d.id),
    author: s(d.author),
    body: s(d.body),
    score: n(d.score),
    created_utc: n(d.created_utc),
    permalink: 'https://www.reddit.com' + s(d.permalink),
    replies,
  };
}

export function shapeSubreddit(data: Record<string, unknown>): SubredditInfo {
  return {
    name: s(data.display_name),
    title: s(data.title),
    subscribers: n(data.subscribers),
    public_description: s(data.public_description),
    description: s(data.description) || undefined,
    over18: Boolean(data.over18),
    url: 'https://www.reddit.com' + s(data.url),
    created_utc: n(data.created_utc),
  };
}
