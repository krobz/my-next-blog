import GithubSlugger, { slug as slugify } from 'github-slugger'
import { allAuthors, allBlogs } from 'contentlayer/generated'
import siteMetadata from '@/data/siteMetadata'
import { skills, timeline, type TimelineItem } from '@/data/profile'

export type PostMeta = {
  slug: string
  title: string
  date: string
  summary?: string
  tags: string[]
  url: string
}

export type SearchHit = {
  slug: string
  title: string
  section?: string
  url: string
  snippet: string
}

type Post = PostMeta & { text: string }

type Chunk = {
  slug: string
  heading?: string
  anchor?: string
  text: string
  termFreq: Map<string, number>
  length: number
}

const MAX_CHUNK_CHARS = 1600
const MAX_CODE_CHARS = 600
const MAX_POST_CHARS = 9000
const BM25_K1 = 1.2
const BM25_B = 0.75

const STOPWORDS = new Set(
  (
    'a an and are as at be but by can could did do does for from had has have he her his how i if in into is it ' +
    'its me my no not of on or our she so than that the their them then there these they this those to up us was ' +
    'we were what when where which who why will with would you your about also just more most'
  ).split(' ')
)

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const [word] of text.toLowerCase().matchAll(/[\u3400-\u9fff]+|[a-z0-9]+[+#]*/g)) {
    if (/^[\u3400-\u9fff]/.test(word)) {
      if (word.length === 1) tokens.push(word)
      for (let i = 0; i < word.length - 1; i++) tokens.push(word.slice(i, i + 2))
      continue
    }
    if (STOPWORDS.has(word) || (word.length === 1 && !/\d/.test(word))) continue
    tokens.push(
      word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
    )
  }
  return tokens
}

function cleanProse(prose: string) {
  return prose
    .split(/(`[^`\n]+`)/)
    .map((piece, i) =>
      i % 2 === 1
        ? piece
        : piece
            .replace(/^(import|export)\s.*$/gm, '')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
            .replace(/<\/?[A-Za-z][^>]*>/g, '')
    )
    .join('')
}

function cleanMdx(raw: string) {
  return raw
    .replace(/^---[\s\S]*?---\s*/, '')
    .split(/(```[\s\S]*?```)/)
    .map((segment, i) => {
      if (i % 2 === 0) return cleanProse(segment)
      const body = segment
        .replace(/^```[^\n]*\n?/, '')
        .replace(/```$/, '')
        .trimEnd()
      return (
        '```\n' +
        (body.length > MAX_CODE_CHARS ? body.slice(0, MAX_CODE_CHARS) + '\n…' : body) +
        '\n```'
      )
    })
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function plainHeading(heading: string) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()
}

function splitSections(text: string) {
  const slugger = new GithubSlugger()
  const sections: { heading?: string; anchor?: string; lines: string[] }[] = [{ lines: [] }]
  let inCode = false
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode
    const match = inCode ? null : /^(#{1,6})\s+(.*)$/.exec(line)
    if (!match) {
      sections[sections.length - 1].lines.push(line)
      continue
    }
    const heading = plainHeading(match[2])
    const anchor = slugger.slug(heading)
    if (match[1].length >= 2 && match[1].length <= 4) sections.push({ heading, anchor, lines: [] })
  }
  return sections
    .map(({ heading, anchor, lines }) => ({ heading, anchor, body: lines.join('\n').trim() }))
    .filter((section) => section.body.length > 0)
}

function splitBody(body: string) {
  const pieces: string[] = []
  let current = ''
  for (const paragraph of body.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length > MAX_CHUNK_CHARS) {
      pieces.push(current)
      current = ''
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  if (current) pieces.push(current)
  return pieces
}

function countTerms(weighted: [string, number][]) {
  const termFreq = new Map<string, number>()
  let length = 0
  for (const [text, weight] of weighted) {
    for (const token of tokenize(text)) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + weight)
      length += weight
    }
  }
  return { termFreq, length }
}

function buildKnowledge() {
  const isProduction = process.env.NODE_ENV === 'production'
  const posts = allBlogs
    .filter((post) => !(isProduction && post.draft))
    .map<Post>((post) => ({
      slug: post.slug,
      title: post.title,
      date: post.date.slice(0, 10),
      summary: post.summary,
      tags: post.tags ?? [],
      url: `/blog/${post.slug}`,
      text: cleanMdx(post.body.raw),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))

  const chunks: Chunk[] = posts.flatMap((post) =>
    splitSections(post.text).flatMap(({ heading, anchor, body }) =>
      splitBody(body).map((text) => ({
        slug: post.slug,
        heading,
        anchor,
        text,
        ...countTerms([
          [post.title, 3],
          [post.tags.join(' '), 2],
          [heading ?? '', 2],
          [text, 1],
        ]),
      }))
    )
  )

  const docFreq = new Map<string, number>()
  for (const chunk of chunks) {
    for (const token of chunk.termFreq.keys()) docFreq.set(token, (docFreq.get(token) ?? 0) + 1)
  }
  const avgLength =
    chunks.reduce((sum, chunk) => sum + chunk.length, 0) / Math.max(chunks.length, 1)

  return {
    posts,
    postBySlug: new Map(posts.map((post) => [post.slug, post])),
    chunks,
    docFreq,
    avgLength,
  }
}

let knowledge: ReturnType<typeof buildKnowledge> | undefined
function getKnowledge() {
  knowledge ??= buildKnowledge()
  return knowledge
}

function toMeta(post: Post): PostMeta {
  const { slug, title, date, summary, tags, url } = post
  return { slug, title, date, summary, tags, url }
}

function hasTag(post: Post, tag?: string) {
  return !tag || post.tags.some((t) => slugify(t) === slugify(tag))
}

function makeSnippet(text: string, queryTokens: string[]) {
  const flat = text.replace(/\s+/g, ' ')
  const lower = flat.toLowerCase()
  const hit = queryTokens.map((token) => lower.indexOf(token)).filter((i) => i >= 0)
  const start = hit.length ? Math.max(0, Math.min(...hit) - 120) : 0
  const snippet = flat.slice(start, start + 320).trim()
  return `${start > 0 ? '…' : ''}${snippet}${start + 320 < flat.length ? '…' : ''}`
}

export function searchPosts(
  query: string,
  { tag, limit = 5 }: { tag?: string; limit?: number } = {}
) {
  const { chunks, docFreq, avgLength, postBySlug } = getKnowledge()
  const queryTokens = [...new Set(tokenize(query))]
  const total = chunks.length

  const scored = chunks
    .filter((chunk) => hasTag(postBySlug.get(chunk.slug)!, tag))
    .map((chunk) => {
      let score = 0
      for (const token of queryTokens) {
        const tf = chunk.termFreq.get(token)
        if (!tf) continue
        const df = docFreq.get(token) ?? 0
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5))
        score +=
          (idf * tf * (BM25_K1 + 1)) /
          (tf + BM25_K1 * (1 - BM25_B + (BM25_B * chunk.length) / avgLength))
      }
      return { chunk, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)

  const perPost = new Map<string, number>()
  const hits: SearchHit[] = []
  for (const { chunk } of scored) {
    const seen = perPost.get(chunk.slug) ?? 0
    if (seen >= 2) continue
    perPost.set(chunk.slug, seen + 1)
    const post = postBySlug.get(chunk.slug)!
    hits.push({
      slug: post.slug,
      title: post.title,
      section: chunk.heading,
      url: chunk.anchor ? `${post.url}#${chunk.anchor}` : post.url,
      snippet: makeSnippet(chunk.text, queryTokens),
    })
    if (hits.length >= limit) break
  }
  return hits
}

export function readPost(slug: string, section?: string) {
  const { postBySlug, chunks } = getKnowledge()
  const post = postBySlug.get(slug)
  if (!post) return { error: `No post with slug "${slug}". Use searchPosts to find valid slugs.` }

  const postChunks = chunks.filter((chunk) => chunk.slug === slug)
  const headings = [
    ...new Set(postChunks.flatMap((chunk) => (chunk.heading ? [chunk.heading] : []))),
  ]
  const matched = section
    ? postChunks.filter((chunk) => chunk.heading?.toLowerCase().includes(section.toLowerCase()))
    : []
  const content = matched.length ? matched.map((chunk) => chunk.text).join('\n\n') : post.text

  return {
    ...toMeta(post),
    headings,
    section: matched.length ? matched[0].heading : undefined,
    content: content.slice(0, MAX_POST_CHARS),
    truncated: content.length > MAX_POST_CHARS,
  }
}

export function listPosts({
  slugs,
  tag,
  limit = 3,
}: {
  slugs?: string[]
  tag?: string
  limit?: number
}) {
  const { posts, postBySlug } = getKnowledge()
  const selected = slugs?.length
    ? slugs.flatMap((slug) => postBySlug.get(slug) ?? [])
    : posts.filter((post) => hasTag(post, tag))
  return selected.slice(0, limit).map(toMeta)
}

export function getTimeline(focus: 'all' | TimelineItem['kind'] = 'all') {
  return focus === 'all' ? timeline : timeline.filter((item) => item.kind === focus)
}

export function getProfileContext() {
  const author = allAuthors.find((a) => a.slug === 'default')
  const { posts } = getKnowledge()
  const describe = (item: TimelineItem) =>
    [
      `- ${item.org}`,
      item.role && ` · ${item.role}`,
      item.period && ` (${item.period})`,
      item.current && ' [current]',
      item.summary && `: ${item.summary}`,
    ]
      .filter(Boolean)
      .join('')

  return [
    `Name: ${author?.name ?? siteMetadata.author}`,
    author?.occupation &&
      `Role: ${author.occupation}${author.company ? ` at ${author.company}` : ''}`,
    '',
    'Bio:',
    author ? cleanMdx(author.body.raw) : '',
    '',
    'Timeline:',
    ...timeline.map(describe),
    '',
    'Skills:',
    ...Object.entries(skills).map(([group, items]) => `- ${group}: ${items.join(', ')}`),
    '',
    'Links:',
    `- Email: ${siteMetadata.email}`,
    `- GitHub: ${siteMetadata.github}`,
    `- LinkedIn: ${siteMetadata.linkedin}`,
    `- X: ${siteMetadata.x}`,
    author?.resumeGoogleDrive && `- Resume: ${author.resumeGoogleDrive}`,
    '- About page: /about',
    '',
    'Published posts (newest first; slug in brackets):',
    ...posts.map((post) => `- ${post.date} · ${post.title} [${post.slug}]`),
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}
