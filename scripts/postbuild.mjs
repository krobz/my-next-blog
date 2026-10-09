import rss from './rss.mjs'
import { checkRagArtifacts } from './check-rag-artifacts.mjs'

async function postbuild() {
  // Next 15's exclude matcher uses Windows backslashes as glob escapes.
  // Enforce the same private-directory exclusion on final manifests on every platform.
  await checkRagArtifacts({ excludePrivate: true })
  await rss()
}

await postbuild()
