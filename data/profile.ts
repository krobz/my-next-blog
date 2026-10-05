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
