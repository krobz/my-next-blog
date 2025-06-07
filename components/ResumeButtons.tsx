import { SVGProps } from 'react'

// 文档图标
function DocumentIcon(svgProps: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...svgProps}
    >
      <title>Document</title>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10,9 9,9 8,9" />
    </svg>
  )
}

interface ResumeButtonsProps {
  googleDriveUrl?: string
  className?: string
}

export default function ResumeButtons({ googleDriveUrl, className = '' }: ResumeButtonsProps) {
  if (!googleDriveUrl) return null

  return (
    <div className={`flex justify-center pt-6 ${className}`}>
      <a
        href={googleDriveUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex transform items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-md transition-all duration-200 hover:scale-105 hover:bg-blue-700 hover:shadow-lg focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        <DocumentIcon className="mr-2 h-5 w-5" />
        View Resume
      </a>
    </div>
  )
}
