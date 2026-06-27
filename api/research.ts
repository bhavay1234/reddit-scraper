import type { VercelRequest, VercelResponse } from '@vercel/node';
import { RedditClient, configFromEnv, research } from '../mcp-reddit/src/reddit.js';

// Reused across warm invocations so the OAuth token is cached, not re-fetched.
let client: RedditClient | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const query = (req.query.query ?? req.query.q) as string | undefined;
  if (!query) {
    res.status(400).json({ error: 'Missing required "query" parameter.' });
    return;
  }
  try {
    client ??= new RedditClient(configFromEnv());
    const data = await research(client, {
      query,
      subreddit: (req.query.subreddit as string) || undefined,
      time: (req.query.time as string) || 'month',
      limit: req.query.limit ? Number(req.query.limit) : 20,
      include_comments: req.query.include_comments !== 'false',
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
