import { sortPosts, allCoreContent } from 'pliny/utils/contentlayer'
import { allAuthors, allBlogs } from 'contentlayer/generated'
import Main from './Main'

export default async function Page() {
  const sortedPosts = sortPosts(allBlogs)
  const posts = allCoreContent(sortedPosts)
  const author = allAuthors.find((a) => a.slug === 'default')
  return (
    <Main
      posts={posts}
      author={{ name: author?.name, occupation: author?.occupation, company: author?.company }}
    />
  )
}
