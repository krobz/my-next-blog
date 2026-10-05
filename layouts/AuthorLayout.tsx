import { ReactNode } from 'react'
import type { Authors } from 'contentlayer/generated'
import Image from '@/components/Image'
import ResumeButtons from '@/components/ResumeButtons'
import AskKrob from '@/components/ask/AskKrob'

interface ExtendedAuthors extends Authors {
  resumeGoogleDrive?: string
}

interface Props {
  children: ReactNode
  content: Omit<ExtendedAuthors, '_id' | '_raw' | 'body'>
}

export default function AuthorLayout({ children, content }: Props) {
  const {
    name,
    avatar,
    occupation,
    company,
    email,
    twitter,
    bluesky,
    linkedin,
    github,
    resumeGoogleDrive,
  } = content

  return (
    <>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        <div className="space-y-2 pt-6 pb-8 md:space-y-5">
          <h1 className="text-3xl leading-9 font-extrabold tracking-tight text-gray-900 sm:text-4xl sm:leading-10 md:text-6xl md:leading-14 dark:text-gray-100">
            About
          </h1>
        </div>
        <div className="items-start space-y-2 xl:grid xl:grid-cols-3 xl:space-y-0 xl:gap-x-8">
          {/* Left Column: Personal Profile Card */}
          <div className="flex flex-col items-center pt-8 xl:sticky xl:top-8">
            {avatar && (
              <Image
                src={avatar}
                alt="avatar"
                width={192}
                height={192}
                className="ring-primary-500/10 dark:ring-primary-400/20 h-44 w-44 rounded-full object-cover shadow-md ring-4"
              />
            )}
            <h3 className="pt-4 pb-0.5 text-2xl leading-8 font-bold tracking-tight text-gray-900 dark:text-gray-100">
              {name}
            </h3>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {occupation && company ? `${occupation} @ ${company}` : occupation || company}
            </div>
            <ResumeButtons googleDriveUrl={resumeGoogleDrive} className="pt-2" />
          </div>

          {/* Right Column: Shortened Bio + Integrated AI Twin */}
          <div className="space-y-8 pt-8 pb-8 xl:col-span-2">
            <div className="prose dark:prose-invert max-w-none text-base leading-relaxed text-gray-600 sm:text-lg dark:text-gray-300">
              {children}
            </div>

            {/* AI Twin Section */}
            <div
              id="ask"
              className="scroll-mt-12 space-y-4 border-t border-gray-200 pt-6 dark:border-gray-800"
            >
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">
                  <span>Ask my AI Twin</span>
                  <span className="bg-primary-500/10 text-primary-500 dark:text-primary-400 border-primary-500/20 rounded-full border px-2 py-0.5 text-[11px] font-normal">
                    Live
                  </span>
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Trained on my writing, projects, and tech stack. Ask me anything.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900/40">
                <AskKrob />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
