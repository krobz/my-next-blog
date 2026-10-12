import type { ParentChunk } from './types'

// Presentation-only labels: retain the original sources and retrieval index.
function projectLabel(label: string): string {
  const neutral = label
    .replace(/\bSummary for (?:the )?Interview\b/gi, 'Project summary')
    .replace(/\bInterview Q&A\b/gi, 'Technical Q&A')
  // Future private documents can fall back to a neutral label pending curation.
  return /\binterviews?\b|面试/i.test(neutral) ? 'Project notes' : neutral
}

export function citationLabels(parent: ParentChunk): { title: string; section: string } {
  const label = parent.source === 'private' ? projectLabel : (value: string) => value
  return {
    title: label(parent.title),
    section: parent.headingPath.map(label).join(' > '),
  }
}
