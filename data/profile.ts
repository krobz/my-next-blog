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
    kind: 'work',
    org: 'Works Applications',
    summary:
      'Designed and implemented EBM, a Google Drive-like document platform using Elasticsearch and DynamoDB; worked on Datagate data integration and document RAG question answering.',
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
// Works Applications project/employer mapping and RAG workflow confirmed by the author.
// Do not infer employer mappings for other projects or unverified benchmark numbers.
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
    kind: 'work',
    org: 'Works Applications',
    name: 'EBM document platform',
    summary:
      'Designed and implemented a Google Drive-like document platform, with DynamoDB data modeling, Elasticsearch search and DynamoDB Streams/Lambda integration to keep the search index updated.',
  },
  {
    kind: 'work',
    org: 'Works Applications',
    name: 'Datagate',
    summary:
      'Worked on an enterprise data hub, including hybrid cloud/on-premises batch processing and incremental data synchronization using PostgreSQL, Spring Batch and AWS SQS.',
  },
  {
    kind: 'work',
    org: 'Works Applications',
    name: 'Document RAG question-answering system',
    summary:
      'Built the document RAG chatbot workflow described in Datagate: loading documents, configuring embedding and language models, chunking text, building a searchable index and retrieving relevant information to answer queries.',
    details: [
      'Load raw documents from a specified directory.',
      'Initialize an embedding model to generate text embeddings for semantic similarity.',
      'Configure a language model for query understanding and response generation.',
      'Configure text chunking, context-window size, output-token limits and chunk overlap.',
      'Create a shared service context that integrates the language model, embedding model and text-chunking tools.',
      'Build a searchable index from the loaded documents.',
      'Create a query engine, with an optional Q&A template for shaping responses.',
      'Retrieve relevant information from the index for a query and use it to generate the response.',
    ],
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
  AI: ['Agentic AI', 'Retrieval-augmented generation (RAG)', 'AI-assisted development workflows'],
}

export const interests: string[] = [
  'Outdoor distance running',
  'Technical writing and post-mortems',
  'Autonomous agent workflows and distributed backend architectures',
]
