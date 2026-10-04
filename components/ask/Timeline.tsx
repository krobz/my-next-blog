import type { TimelineItem } from '@/data/profile'

export default function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="space-y-5 border-l border-gray-200 pl-5 dark:border-gray-700">
      {items.map((item) => (
        <li key={`${item.kind}-${item.org}`} className="relative">
          <span
            className={`absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-gray-950 ${
              item.current ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-gray-900 dark:text-gray-100">{item.org}</span>
            {item.role && (
              <span className="text-sm text-gray-600 dark:text-gray-300">{item.role}</span>
            )}
            <span className="text-xs text-gray-400 uppercase">
              {item.current
                ? 'Now'
                : (item.period ?? (item.kind === 'education' ? 'Education' : 'Work'))}
            </span>
          </div>
          {item.summary && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{item.summary}</p>
          )}
        </li>
      ))}
    </ol>
  )
}
