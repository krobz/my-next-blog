import Link from 'next/link'
import { formatDate } from 'pliny/utils/formatDate'
import siteMetadata from '@/data/siteMetadata'
import type { PostMeta } from '@/lib/ai/knowledge'

export default function PostCards({ posts }: { posts: PostMeta[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {posts.map((post) => (
        <Link
          key={post.slug}
          href={post.url}
          className="group hover:border-primary-500 dark:hover:border-primary-400 block rounded-xl border border-gray-200 p-4 transition-colors dark:border-gray-700"
        >
          <time dateTime={post.date} className="text-xs text-gray-500 dark:text-gray-400">
            {formatDate(post.date, siteMetadata.locale)}
          </time>
          <h3 className="group-hover:text-primary-500 dark:group-hover:text-primary-400 mt-1 leading-snug font-semibold text-gray-900 dark:text-gray-100">
            {post.title}
          </h3>
          {post.summary && (
            <p className="mt-1.5 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
              {post.summary}
            </p>
          )}
          {post.tags.length > 0 && (
            <div className="text-primary-500 mt-2 flex flex-wrap gap-x-3 text-xs font-medium uppercase">
              {post.tags.slice(0, 3).map((tag) => (
                <span key={tag}>{tag.split(' ').join('-')}</span>
              ))}
            </div>
          )}
        </Link>
      ))}
    </div>
  )
}
