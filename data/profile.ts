// Structured facts for the AI twin. Keep in sync with data/authors/default.mdx.
// The assistant treats everything here as ground truth, so only add facts you are happy to publish.

export type TimelineItem = {
  kind: 'work' | 'education'
  org: string
  role?: string
  period?: string
  current?: boolean
  summary?: string
}

export const timeline: TimelineItem[] = [
  {
    kind: 'work',
    org: 'Visa',
    role: 'Software Engineer',
    current: true,
    summary: 'Building agentic AI for autonomous security remediation.',
  },
  {
    kind: 'work',
    org: 'Crédit Agricole CIB',
    summary:
      'Designed and modernized large-scale trade-data ingestion systems for multi-regulation compliance (MAS, HKTR, JFSA, CFTC, MiFID and others), and delivered real-time data pipelines to downstream platforms.',
  },
  {
    kind: 'education',
    org: 'Nanyang Technological University (NTU)',
    role: 'MSc in Artificial Intelligence',
  },
  {
    kind: 'education',
    org: 'Hong Kong University of Science and Technology (HKUST)',
    role: 'MSc in Mechanical Engineering',
  },
]

// Short, approved project facts keep broad introductions representative of the work.
// ES/DTCC: author's project descriptions. TRPGHub: the published product post-mortem.
// Employer attribution and benchmark numbers need separate supporting evidence.
export const projects = [
  {
    kind: 'work',
    name: 'DTCC S3-to-Kafka pipeline',
    summary:
      'Designed a pipeline that reads large financial CSV files from S3, transforms rows to XML and sends them to Kafka, using Java virtual threads and bounded backpressure.',
  },
  {
    kind: 'work',
    name: 'Elasticsearch migration',
    summary: 'Designed an Elasticsearch migration flow using parallel scanning and bulk requests.',
  },
  {
    kind: 'side project',
    name: 'TRPGHub',
    summary:
      'Owned engineering and infrastructure for a tabletop RPG marketplace, using Java/Spring Boot and React Native with AI-assisted development. Co-founders handled product, market and regulation. The app was built but never launched.',
    postSlug: 'more-than-vibe-coding-why-my-app-never-made-it-to-launch',
  },
] as const

export const skills: Record<string, string[]> = {
  'Backend & data': [
    'Backend systems',
    'Distributed data pipelines',
    'Real-time data pipelines',
    'High-performance processing',
  ],
  'Storage & search': ['Elasticsearch', 'DynamoDB'],
  'Cloud & infra': ['Cloud-native architecture', 'Kubernetes'],
  AI: ['Agentic AI', 'AI-assisted development workflows'],
}

export const interests: string[] = [
  'Outdoor distance running',
  'Technical writing and post-mortems',
  'Autonomous agent workflows and distributed backend architectures',
]
