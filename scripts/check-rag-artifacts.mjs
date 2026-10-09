import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function checkRagArtifacts({ excludePrivate = false } = {}) {
  let manifests = 0,
    removed = 0
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.name.endsWith('.nft.json')) {
        manifests++
        const manifest = JSON.parse(await readFile(file, 'utf8'))
        const files = manifest.files.filter(
          (item) => !/(^|[/\\])\.rag-(private|evals)([/\\]|$)/.test(item)
        )
        if (files.length !== manifest.files.length) {
          if (!excludePrivate)
            throw new Error('Private RAG state was included in a deployment trace.')
          removed += manifest.files.length - files.length
          await writeFile(file, JSON.stringify({ ...manifest, files }))
        }
      }
    }
  }
  await walk('.next')
  if (!manifests) throw new Error('Build the application before checking deployment traces.')
  console.log(
    `Checked ${manifests} deployment traces: no private RAG state included (${removed} excluded).`
  )
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/check-rag-artifacts.mjs'))
  await checkRagArtifacts()
