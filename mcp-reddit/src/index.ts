#!/usr/bin/env node
/**
 * Reddit MCP server.
 *
 * Exposes read-only Reddit tools over stdio so MCP clients (Claude Desktop,
 * Claude Code, etc.) can search and read Reddit. Configuration comes from
 * environment variables — see README.md.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  configFromEnv,
  RedditClient,
  research,
  postsFromListing,
  shapeComment,
  shapeSubreddit,
  type Comment,
} from './reddit.js';

const client = new RedditClient(configFromEnv());

const server = new McpServer({
  name: 'reddit-mcp',
  version: '1.0.0',
});

/** Wrap a handler so any thrown error becomes a clean tool error result. */
function tool(
  name: string,
  description: string,
  schema: z.ZodRawShape,
  run: (args: Record<string, unknown>) => Promise<unknown>
) {
  server.registerTool(
    name,
    { description, inputSchema: schema },
    async (args: Record<string, unknown>) => {
      try {
        const data = await run(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text' as const, text: message }] };
      }
    }
  );
}

const sortListing = z
  .enum(['hot', 'new', 'top', 'rising', 'controversial'])
  .default('hot');
const timeRange = z
  .enum(['hour', 'day', 'week', 'month', 'year', 'all'])
  .default('day')
  .describe('Only used when sort is "top" or "controversial".');

tool(
  'search_reddit',
  'Search Reddit posts across all of Reddit or within a specific subreddit. Returns matching posts with title, author, score, comment count, and permalink.',
  {
    query: z.string().describe('Search query (supports Reddit search syntax).'),
    subreddit: z
      .string()
      .optional()
      .describe('Restrict the search to this subreddit (name only, no "r/").'),
    sort: z.enum(['relevance', 'hot', 'top', 'new', 'comments']).default('relevance'),
    time: timeRange,
    limit: z.number().int().min(1).max(100).default(25),
  },
  async (a) => {
    const subreddit = a.subreddit as string | undefined;
    const path = subreddit ? `/r/${subreddit}/search` : '/search';
    const listing = await client.get(path, {
      q: a.query as string,
      sort: a.sort as string,
      t: a.time as string,
      limit: a.limit as number,
      restrict_sr: subreddit ? 'true' : undefined,
      type: 'link',
    });
    return postsFromListing(listing).posts;
  }
);

tool(
  'get_subreddit_posts',
  'List posts from a subreddit by sort order (hot, new, top, rising, controversial).',
  {
    subreddit: z.string().describe('Subreddit name (no "r/" prefix).'),
    sort: sortListing,
    time: timeRange,
    limit: z.number().int().min(1).max(100).default(25),
    after: z
      .string()
      .optional()
      .describe('Pagination cursor (the "after" value from a previous call).'),
  },
  async (a) => {
    const sort = a.sort as string;
    const listing = await client.get(`/r/${a.subreddit}/${sort}`, {
      t: sort === 'top' || sort === 'controversial' ? (a.time as string) : undefined,
      limit: a.limit as number,
      after: a.after as string | undefined,
    });
    const { posts, after } = postsFromListing(listing);
    return { posts, after };
  }
);

tool(
  'get_post_comments',
  'Fetch a single post and its comment tree by post id (e.g. "1abc23") or "subreddit/post_id". Returns the post plus nested comments.',
  {
    post_id: z
      .string()
      .describe('The post id (with or without the "t3_" prefix), or "subreddit/id".'),
    subreddit: z.string().optional().describe('Subreddit, if not included in post_id.'),
    sort: z.enum(['confidence', 'top', 'new', 'controversial', 'old', 'qa']).default('top'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('Max number of top-level comments to fetch.'),
  },
  async (a) => {
    let raw = (a.post_id as string).trim();
    let subreddit = a.subreddit as string | undefined;
    if (raw.includes('/')) {
      const parts = raw.split('/').filter(Boolean);
      raw = parts[parts.length - 1];
      if (!subreddit && parts.length >= 2) subreddit = parts[parts.length - 2];
    }
    const id = raw.replace(/^t3_/, '');
    const path = subreddit ? `/r/${subreddit}/comments/${id}` : `/comments/${id}`;
    const result = (await client.get(path, {
      sort: a.sort as string,
      limit: a.limit as number,
    })) as unknown[];
    const postListing = result[0];
    const commentListing = result[1] as
      | { data?: { children?: Parameters<typeof shapeComment>[0][] } }
      | undefined;
    const post = postsFromListing(postListing).posts[0] ?? null;
    const comments: Comment[] = (commentListing?.data?.children ?? [])
      .map(shapeComment)
      .filter((c): c is Comment => c !== null);
    return { post, comments };
  }
);

tool(
  'search_subreddits',
  'Search for subreddits by name/topic. Returns subreddit name, title, subscriber count, and description.',
  {
    query: z.string().describe('Search terms.'),
    limit: z.number().int().min(1).max(100).default(20),
  },
  async (a) => {
    const listing = await client.get('/subreddits/search', {
      q: a.query as string,
      limit: a.limit as number,
    });
    const children =
      (listing as { data?: { children?: { data: Record<string, unknown> }[] } }).data?.children ??
      [];
    return children.map((c) => shapeSubreddit(c.data));
  }
);

tool(
  'get_subreddit_info',
  'Get metadata about a subreddit: title, subscriber count, description, and creation date.',
  {
    subreddit: z.string().describe('Subreddit name (no "r/" prefix).'),
  },
  async (a) => {
    const about = (await client.get(`/r/${a.subreddit}/about`)) as { data?: Record<string, unknown> };
    if (!about.data) throw new Error(`Subreddit "${a.subreddit}" not found.`);
    return shapeSubreddit(about.data);
  }
);

tool(
  'get_user_posts',
  "Fetch a Reddit user's recent submissions or comments.",
  {
    username: z.string().describe('Reddit username (no "u/" prefix).'),
    kind: z.enum(['submitted', 'comments', 'overview']).default('submitted'),
    sort: z.enum(['new', 'hot', 'top', 'controversial']).default('new'),
    time: timeRange,
    limit: z.number().int().min(1).max(100).default(25),
  },
  async (a) => {
    const listing = await client.get(`/user/${a.username}/${a.kind}`, {
      sort: a.sort as string,
      t: a.time as string,
      limit: a.limit as number,
    });
    const children =
      (listing as { data?: { children?: { kind: string; data: Record<string, unknown> }[] } }).data
        ?.children ?? [];
    return children.map((c) => {
      if (c.kind === 't3') return postsFromListing({ data: { children: [c] } }).posts[0];
      const d = c.data;
      return {
        type: 'comment',
        id: d.id,
        author: d.author,
        body: d.body,
        score: d.score,
        subreddit: d.subreddit,
        created_utc: d.created_utc,
        permalink: 'https://www.reddit.com' + (d.permalink ?? ''),
      };
    });
  }
);

tool(
  'reddit_research',
  'One-shot Reddit research for a theme, keyword, topic, or brand name. Returns the most relevant discussions, the communities where it comes up, recent mentions, and (optionally) top comments from the leading threads. Use this when you just have a term and want to know what Reddit is saying about it.',
  {
    query: z
      .string()
      .describe('A theme, keyword, topic, or brand name (e.g. "Notion", "electric SUV range anxiety").'),
    subreddit: z
      .string()
      .optional()
      .describe('Optionally restrict all research to a single subreddit (name only, no "r/").'),
    time: timeRange.describe(
      'Recency window for relevance ranking (hour/day/week/month/year/all). Defaults to month.'
    ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe('Max number of relevant posts to return.'),
    include_comments: z
      .boolean()
      .default(true)
      .describe('Also pull top comments from the most-discussed matching threads.'),
  },
  async (a) =>
    research(client, {
      query: a.query as string,
      subreddit: a.subreddit as string | undefined,
      time: a.time as string,
      limit: a.limit as number,
      include_comments: a.include_comments as boolean,
    })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('reddit-mcp running on stdio');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
