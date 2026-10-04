import { tool } from 'ai'
import { z } from 'zod'
import { getTimeline, listPosts, readPost, searchPosts } from './knowledge'

export const tools = {
  searchPosts: tool({
    description:
      "Keyword search over krob's blog posts, which are written in English. Returns the best matching sections with a snippet and a url. Always pass English keywords, translating the visitor's question if needed.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(200)
        .describe('Keywords, e.g. "leetcode contest" or "virtual threads"'),
      tag: z.string().max(50).optional().describe('Restrict to posts with this tag'),
      limit: z.number().int().min(1).max(8).optional(),
    }),
    execute: async ({ query, tag, limit }) => ({ results: searchPosts(query, { tag, limit }) }),
  }),

  getPost: tool({
    description:
      'Read a blog post by slug. Pass section (a heading) to read only that part; the response lists all headings.',
    inputSchema: z.object({
      slug: z.string().min(1).max(200),
      section: z.string().max(200).optional(),
    }),
    execute: async ({ slug, section }) => readPost(slug, section),
  }),

  showPosts: tool({
    description:
      'Display blog posts to the visitor as cards. Pass slugs to show specific posts, or omit them to show the newest posts (optionally filtered by tag).',
    inputSchema: z.object({
      slugs: z.array(z.string().max(200)).max(6).optional(),
      tag: z.string().max(50).optional(),
      limit: z.number().int().min(1).max(6).optional(),
    }),
    execute: async ({ slugs, tag, limit }) => ({ posts: listPosts({ slugs, tag, limit }) }),
  }),

  showTimeline: tool({
    description: "Display krob's career and education timeline to the visitor.",
    inputSchema: z.object({
      focus: z.enum(['all', 'work', 'education']).optional(),
    }),
    execute: async ({ focus }) => ({ items: getTimeline(focus) }),
  }),
}

export type AskTools = typeof tools
