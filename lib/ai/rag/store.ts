import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { Redis } from '@upstash/redis'
import { digest, PIPELINE_VERSION } from './chunking'
import type { IngestionJob, RagDocument, RagSnapshot } from './types'

type Payload = { documents: RagDocument[]; embedding: RagSnapshot['embedding'] }
type State = {
  revision: number
  sequence: number
  latest?: string
  active?: string
  allowed?: string[]
  revoked: string[]
  jobs: IngestionJob[]
}
const empty = (): State => ({ revision: 0, sequence: 0, revoked: [], jobs: [] })
type Backend = {
  readState(): Promise<State>
  cas(before: State, after: State): Promise<boolean>
  put(key: string, text: string): Promise<void>
  get(key: string): Promise<string | null>
  putMany(entries: [string, string][]): Promise<void>
  getMany(keys: string[]): Promise<(string | null)[]>
}

function encodeVector(vector: number[]) {
  const buffer = Buffer.alloc(vector.length * 4)
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4))
  return { f32: buffer.toString('base64') }
}
function decodeVector(value: { f32: string }): number[] {
  const buffer = Buffer.from(value.f32, 'base64')
  if (!buffer.length || buffer.length % 4 || buffer.length > 3072 * 4)
    throw new Error('rag_invalid_vector_encoding')
  return Array.from({ length: buffer.length / 4 }, (_, i) => buffer.readFloatLE(i * 4))
}

class LocalBackend implements Backend {
  constructor(private directory: string) {
    const normalized = path.resolve(directory).replace(/\\/g, '/').toLowerCase()
    if (/(^|\/)(public|\.next|out|\.git)(\/|$)/.test(normalized))
      throw new Error('rag_unsafe_store_directory')
  }
  private async init() {
    await fs.mkdir(path.join(this.directory, 'revisions'), { recursive: true })
  }
  async readState(): Promise<State> {
    await this.init()
    const files = (await fs.readdir(path.join(this.directory, 'revisions')))
      .filter((f) => /^\d{12}\.json$/.test(f))
      .sort()
    return files.length
      ? JSON.parse(await fs.readFile(path.join(this.directory, 'revisions', files.at(-1)!), 'utf8'))
      : empty()
  }
  async cas(before: State, after: State) {
    await this.init()
    const temp = path.join(this.directory, `pending-${randomUUID()}`)
    const destination = path.join(
      this.directory,
      'revisions',
      `${String(before.revision + 1).padStart(12, '0')}.json`
    )
    await fs.writeFile(temp, JSON.stringify(after), { flag: 'wx', mode: 0o600 })
    try {
      await fs.link(temp, destination)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    } finally {
      await fs.unlink(temp).catch(() => {})
    }
  }
  async put(key: string, text: string) {
    await this.init()
    const destination = path.join(this.directory, digest(key) + '.json')
    const temp = path.join(this.directory, `pending-${randomUUID()}`)
    await fs.writeFile(temp, text, { flag: 'wx', mode: 0o600 })
    try {
      await fs.link(temp, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    } finally {
      await fs.unlink(temp).catch(() => {})
    }
  }
  async get(key: string) {
    try {
      return await fs.readFile(path.join(this.directory, digest(key) + '.json'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  async putMany(entries: [string, string][]) {
    await Promise.all(entries.map(([key, value]) => this.put(key, value)))
  }
  async getMany(keys: string[]) {
    return Promise.all(keys.map((key) => this.get(key)))
  }
}

class RedisBackend implements Backend {
  private redis: Redis
  private prefix = 'rag:v2:'
  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
    if (!url || !token) throw new Error('rag_redis_not_configured')
    this.redis = new Redis({ url, token, automaticDeserialization: false })
  }
  async readState(): Promise<State> {
    const value = await this.redis.get<string>(this.prefix + 'state')
    return value ? JSON.parse(value) : empty()
  }
  async cas(before: State, after: State) {
    const script = `local raw=redis.call('GET',KEYS[1]); local rev=0; if raw then rev=cjson.decode(raw).revision end; if rev~=tonumber(ARGV[1]) then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1`
    return (
      Number(
        await this.redis.eval(
          script,
          [this.prefix + 'state'],
          [before.revision, JSON.stringify(after)]
        )
      ) === 1
    )
  }
  async put(key: string, text: string) {
    await this.redis.set(this.prefix + key, text, { nx: true })
  }
  async get(key: string) {
    return this.redis.get<string>(this.prefix + key)
  }
  async putMany(entries: [string, string][]) {
    const pipeline = this.redis.pipeline()
    for (const [key, text] of entries) pipeline.set(this.prefix + key, text, { nx: true })
    await pipeline.exec()
  }
  async getMany(keys: string[]) {
    const pipeline = this.redis.pipeline()
    for (const key of keys) pipeline.get(this.prefix + key)
    return pipeline.exec<(string | null)[]>()
  }
}

export function validateSnapshot(snapshot: RagSnapshot) {
  if (
    snapshot.schemaVersion !== 1 ||
    !snapshot.version ||
    !Number.isInteger(snapshot.embedding.dimensions) ||
    snapshot.embedding.dimensions < 1 ||
    snapshot.embedding.dimensions > 3072
  )
    throw new Error('rag_invalid_snapshot')
  if (snapshot.children.length > 20000 || snapshot.parents.length > 20000)
    throw new Error('rag_snapshot_too_large')
  const parents = new Map(snapshot.parents.map((p) => [p.id, p]))
  const docs = new Map(snapshot.documents.map((d) => [d.id, d]))
  if (
    parents.size !== snapshot.parents.length ||
    new Set(snapshot.children.map((c) => c.id)).size !== snapshot.children.length
  )
    throw new Error('rag_duplicate_chunk')
  for (const p of snapshot.parents) {
    const doc = docs.get(p.documentId)
    if (
      !doc?.allowPublicAnswer ||
      !p.allowPublicAnswer ||
      doc.version !== p.version ||
      p.tokens > 1600
    )
      throw new Error('rag_invalid_parent')
  }
  for (const c of snapshot.children) {
    const p = parents.get(c.parentId)
    if (!p || p.documentId !== c.documentId || p.version !== c.version || c.tokens > 1000)
      throw new Error('rag_invalid_child')
    if (
      !c.embedding ||
      c.embedding.length !== snapshot.embedding.dimensions ||
      c.embedding.some((x) => !Number.isFinite(x)) ||
      Math.abs(Math.hypot(...c.embedding) - 1) > 0.01
    )
      throw new Error('rag_invalid_vector')
  }
}

export class RagStore {
  private snapshotCache?: RagSnapshot
  constructor(
    private backend: Backend,
    private leaseMs = 60_000,
    private now = () => Date.now()
  ) {}
  private async update<T>(fn: (state: State) => T): Promise<T> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const before = await this.backend.readState()
      const after = structuredClone(before)
      const result = fn(after)
      // Idle polls and idempotent enqueue calls must not create durable revisions.
      if (JSON.stringify(after) === JSON.stringify(before)) return result
      after.revision = before.revision + 1
      if (await this.backend.cas(before, after)) return result
    }
    throw new Error('rag_store_contention')
  }
  private async writeObject(key: string, value: unknown, progress?: () => Promise<void>) {
    // Existing immutable payloads are reusable, including the original JSON format.
    if (await this.backend.get(key)) return
    const json = JSON.stringify(value, (field, item) =>
      field === 'embedding' && Array.isArray(item) ? encodeVector(item) : item
    )
    const text = gzipSync(json).toString('base64')
    const hash = digest(text)
    const pages: string[] = []
    for (let i = 0; i < text.length; i += 48000) pages.push(text.slice(i, i + 48000))
    for (let i = 0; i < pages.length; i += 20) {
      await progress?.()
      await this.backend.putMany(
        pages.slice(i, i + 20).map((page, offset) => [`${key}:v2:${hash}:part:${i + offset}`, page])
      )
    }
    await progress?.()
    await this.backend.put(key, JSON.stringify({ format: 'gzip-f32', pages: pages.length, hash }))
  }
  private async readObject<T>(key: string): Promise<T> {
    const raw = await this.backend.get(key)
    if (!raw) throw new Error('rag_missing_payload')
    const manifest = JSON.parse(raw) as { format?: string; pages: number; hash: string }
    if (!Number.isInteger(manifest.pages) || manifest.pages < 1 || manifest.pages > 20000)
      throw new Error('rag_invalid_payload')
    let text = ''
    for (let i = 0; i < manifest.pages; i += 20) {
      const pieces = await this.backend.getMany(
        Array.from(
          { length: Math.min(20, manifest.pages - i) },
          (_, offset) =>
            `${key}:${manifest.format === 'gzip-f32' ? `v2:${manifest.hash}:` : ''}part:${i + offset}`
        )
      )
      if (pieces.some((p) => p === null)) throw new Error('rag_incomplete_payload')
      text += pieces.join('')
    }
    if (digest(text) !== manifest.hash) throw new Error('rag_corrupt_payload')
    if (!manifest.format) return JSON.parse(text)
    if (manifest.format !== 'gzip-f32') throw new Error('rag_invalid_payload')
    const json = gunzipSync(Buffer.from(text, 'base64'), { maxOutputLength: 100_000_000 }).toString(
      'utf8'
    )
    return JSON.parse(json, (field, item) =>
      field === 'embedding' && item?.f32 ? decodeVector(item) : item
    )
  }
  async enqueue(
    documents: RagDocument[],
    embedding: RagSnapshot['embedding'],
    options: { force?: boolean } = {}
  ): Promise<IngestionJob> {
    const payload = { documents, embedding }
    const id = digest(
      JSON.stringify({
        ...payload,
        pipeline: PIPELINE_VERSION,
        ...(options.force ? { nonce: randomUUID() } : {}),
      })
    )
    await this.writeObject(`job:${id}`, payload)
    return this.update((state) => {
      const existing = state.jobs.find((j) => j.id === id)
      if (existing) return existing
      const allowed = new Set(documents.filter((d) => d.allowPublicAnswer).map((d) => d.id))
      state.allowed = [...allowed]
      // Full corpus replacement: withdrawing eligibility also masks the old active snapshot immediately.
      const allKnown = this.snapshotCache?.documents.map((d) => d.id) ?? []
      for (const d of documents) if (!d.allowPublicAnswer) state.revoked.push(d.id)
      for (const id of allKnown) if (!allowed.has(id)) state.revoked.push(id)
      state.revoked = [...new Set(state.revoked)]
      const now = new Date(this.now()).toISOString()
      const job: IngestionJob = {
        id,
        sequence: ++state.sequence,
        status: 'queued',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        nextAttemptAt: 0,
      }
      state.jobs.push(job)
      for (const older of state.jobs)
        if (older.id !== id && ['queued', 'processing'].includes(older.status))
          older.status = 'superseded'
      state.latest = id
      return job
    })
  }
  async claim(): Promise<({ job: IngestionJob } & Payload) | null> {
    const job = await this.update((state) => {
      const item = state.jobs.find((j) => j.id === state.latest)
      if (
        item?.status === 'processing' &&
        item.attempts >= 5 &&
        (item.leaseUntil ?? 0) <= this.now()
      ) {
        item.status = 'failed'
        item.error = 'rag_retry_exhausted'
        item.updatedAt = new Date(this.now()).toISOString()
      }
      if (
        !item ||
        item.status === 'ready' ||
        item.status === 'superseded' ||
        item.attempts >= 5 ||
        item.nextAttemptAt > this.now() ||
        (item.status === 'processing' && (item.leaseUntil ?? 0) > this.now())
      )
        return null
      Object.assign(item, {
        status: 'processing',
        attempts: item.attempts + 1,
        leaseToken: randomUUID(),
        leaseUntil: this.now() + this.leaseMs,
        updatedAt: new Date(this.now()).toISOString(),
      })
      return item
    })
    return job ? { job, ...(await this.readObject<Payload>(`job:${job.id}`)) } : null
  }
  private owns(state: State, job: IngestionJob) {
    const current = state.jobs.find((j) => j.id === job.id)
    return current &&
      state.latest === job.id &&
      current.status === 'processing' &&
      current.leaseToken === job.leaseToken &&
      (current.leaseUntil ?? 0) > this.now()
      ? current
      : undefined
  }
  async heartbeat(job: IngestionJob) {
    return this.update((state) => {
      const current = this.owns(state, job)
      if (!current) return false
      current.leaseUntil = this.now() + this.leaseMs
      return true
    })
  }
  async publish(
    job: IngestionJob,
    snapshot: RagSnapshot,
    usage: { tokens: number; costUsd: number },
    signal?: AbortSignal
  ) {
    validateSnapshot(snapshot)
    const progress = async () => {
      signal?.throwIfAborted()
      if (!(await this.heartbeat(job))) throw new Error('rag_job_superseded')
    }
    if (!(await this.heartbeat(job))) return false
    await this.writeObject(`snapshot:${snapshot.version}`, snapshot, progress)
    await progress()
    return this.update((state) => {
      const current = this.owns(state, job)
      if (!current) return false
      Object.assign(current, {
        status: 'ready',
        snapshotVersion: snapshot.version,
        updatedAt: new Date(this.now()).toISOString(),
        tokens: (current.tokens ?? 0) + usage.tokens,
        costUsd: (current.costUsd ?? 0) + usage.costUsd,
      })
      state.active = snapshot.version
      return true
    })
  }
  async fail(job: IngestionJob, code: string, usage = { tokens: 0, costUsd: 0 }) {
    await this.update((state) => {
      const current = this.owns(state, job)
      if (current)
        Object.assign(current, {
          status: 'failed',
          error: /^rag_[a-z0-9_]+$/.test(code) ? code : 'rag_ingestion_failed',
          tokens: (current.tokens ?? 0) + usage.tokens,
          costUsd: (current.costUsd ?? 0) + usage.costUsd,
          nextAttemptAt: this.now() + Math.min(300000, 1000 * 2 ** current.attempts),
          updatedAt: new Date(this.now()).toISOString(),
        })
    })
  }
  async status() {
    return (await this.backend.readState()).jobs.map(
      ({ leaseToken: _, ...job }) => job as IngestionJob
    )
  }
  async revoke(documentId: string) {
    await this.update((state) => {
      state.revoked = [...new Set([...state.revoked, documentId])]
    })
  }
  async loadActive(): Promise<RagSnapshot | null> {
    const state = await this.backend.readState()
    if (!state.active) return null
    if (this.snapshotCache?.version !== state.active) {
      const snapshot = await this.readObject<RagSnapshot>(`snapshot:${state.active}`)
      validateSnapshot(snapshot)
      this.snapshotCache = snapshot
    }
    const snapshot = this.snapshotCache!
    const parents = snapshot.parents.filter(
      (p) =>
        p.allowPublicAnswer &&
        !state.revoked.includes(p.documentId) &&
        (!state.allowed || state.allowed.includes(p.documentId))
    )
    const parentIds = new Set(parents.map((p) => p.id))
    return {
      ...snapshot,
      parents,
      children: snapshot.children.filter((c) => parentIds.has(c.parentId)),
    }
  }
  async getEmbedding(key: string) {
    return (await this.getEmbeddings([key]))[0]
  }
  async getEmbeddings(keys: string[]) {
    const values = await this.backend.getMany(keys.map((key) => `embedding:${key}`))
    return values.map((value) => {
      if (!value) return null
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? (parsed as number[]) : decodeVector(parsed)
    })
  }
  async putEmbeddings(entries: [string, number[]][]) {
    await this.backend.putMany(
      entries.map(([key, vector]) => [`embedding:${key}`, JSON.stringify(encodeVector(vector))])
    )
  }
  async putEmbedding(key: string, vector: number[]) {
    await this.putEmbeddings([[key, vector]])
  }
}

export function createRagStore(
  options: {
    directory?: string
    backend?: 'local' | 'redis'
    leaseMs?: number
    now?: () => number
  } = {}
) {
  const kind = options.backend ?? (process.env.RAG_STORE === 'redis' ? 'redis' : 'local')
  if (process.env.NODE_ENV === 'production' && kind !== 'redis' && !options.directory)
    throw new Error('rag_production_requires_redis')
  return new RagStore(
    kind === 'redis'
      ? new RedisBackend()
      : new LocalBackend(
          options.directory ?? process.env.RAG_LOCAL_DIR ?? path.join(process.cwd(), '.rag-private')
        ),
    options.leaseMs,
    options.now
  )
}
