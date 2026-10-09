# Blog RAG v2: private sources, public answers

Design and implementation record, 2026-10-09. This document is the implementation contract; measured quality and latency are reported separately. Source documents, embeddings and reference answers must never be committed or placed in public assets.

## Scope and architecture

Keep the existing GPT-6 Luna agent, public post cards and timeline. Add structured ingestion and a server-only retrieval tool:

```
Local source pack / Markdown
  -> explicit public-answer eligibility
  -> durable job + immutable source version
  -> Markdown AST / XMind paths / reviewed PDF text
  -> child + parent chunks -> OpenAI embeddings -> validated snapshot
  -> atomic active-version publication

Visitor query (+ optional English lexical keywords)
  -> multilingual dense 40 | BM25 40 | exact identifiers <=10
  -> canonical deduplication + weighted RRF -> <=50
  -> BGE CrossEncoder endpoint (or Cohere adapter) -> <=8
  -> authorized parent windows, <=6 / <=6000 tokens
  -> model-only evidence + stable request-local citations
  -> public text, approved citation labels, public widgets, numeric trace
```

Trigram, learned query routing, semantic splitting and GraphRAG are outside this implementation. No new paid infrastructure is provisioned. Reranking is a separate service; including an adapter does not mean a model endpoint is running.

## Source and chunk contract

`RagDocument` contains an immutable version, explicit `allowPublicAnswer`, source kind, claim status, attribution, and verified source units. Import defaults to no private documents eligible until IDs are explicitly selected. PDF units with formula/table review flags are excluded; figure-only flags permit the extracted prose but provide no evidence about the image itself. XMind placeholders are excluded. Existing translations/variants are not silently merged. Original files remain unchanged.

`remark` + GFM parse headings, fenced code, lists and tables. Prose targets 384 tokens, bounded below 640; code/table units may reach 1000. Long code is split at line boundaries with repeated fences, tables with repeated headers; oversized individual rows/lines fail ingestion for review instead of truncating. Parents are bounded at 1600 tokens. Initial implementation uses zero overlap; parent expansion restores adjacent context. Optional 48-token prose overlap remains an evaluation experiment.

Token counts use `cl100k_base` for embedding preparation. The BGE service uses its own tokenizer and rejects overlong pairs instead of silently applying a 512-token cutoff. Generator context allocation counts evidence plus labels/status. Retrieval prefixes are metadata, not attributed original prose. `sourceSpans` are UTF-16 offsets into named source units; evaluation adapters must convert Unicode code-point offsets where needed.

## Storage, worker and publication

Use local ignored `.rag-private/` for development and a Redis adapter for remote operation. This refines the earlier private-object-snapshot design: reuse the project's Redis for a small corpus instead of provisioning another service. Snapshots store float32 vectors in gzip-compressed payloads, with 48,000-character transport pages batched 20 at a time. Content-addressed parts prevent retries from mixing partial payload versions; publication renews the job lease between batches. The reader still supports the original JSON snapshots. At larger scale, move payloads to private object storage behind the same store interface; Redis retains jobs/manifests. Retain artifacts for recovery; pruning is an explicit maintenance operation, not automatic deletion of source data. Cold reads still load the complete snapshot: compression reduces transfer, but does not turn Redis into a vector database.

Enqueue is full-corpus replacement. The payload includes document contents and index configuration; content hashing makes identical enqueue operations idempotent. Jobs have monotonically increasing sequence numbers, status, attempt count, next retry, and expiring lease tokens. A crashed worker can be recovered after lease expiry. A newer request supersedes older publication, even when an old network request finishes later. Workers renew leases around embedding batches and use content-addressed embedding caches to resume without rebilling completed batches.

Build all parents/children/vectors first, validate, write immutable snapshot payload, then compare-and-swap the active pointer. Partial embeddings never become active. The previous valid snapshot remains available during ordinary updates. Explicit revocation and removing eligibility immediately filter the old snapshot as well; stale jobs cannot restore access. `status` exposes lifecycle metadata only, not source text or provider error bodies.

Local state uses immutable revision records and exclusive atomic publication, avoiding in-place partial JSON writes. Redis uses Lua CAS for metadata. In-memory snapshot reuse is per process only; each load still reads current authorization/publication metadata. Different Vercel instances load independently.

Run a persistent CLI worker for automatic consumption. A watch mode re-enqueues changed local source files. An authenticated bounded HTTP worker can be invoked by an existing scheduler; writing the handler does not provision a scheduler. Do not rely on a detached promise after an HTTP response. Production requires Redis when using the remote adapter; never use the read-only Vercel filesystem as durable queue storage.

## Retrieval and failure behavior

Use original query for embedding and BGE; optional English keywords only enrich BM25. Preserve camelCase, snake_case, annotations and API path identifiers. BM25 indexes title/path terms as well as body. Fuse the lexical variants inside that route before cross-route fusion, so additional rewrites do not create extra votes. Initial route weights are dense=1, lexical=1, identifier=0.5, RRF k=60. These are tuning parameters, not confidence values.

Query vectors must match the snapshot's model and dimensions. Embedding defaults to `text-embedding-3-large`, 3072 dimensions; index changes require rebuilding. Dense search is exact normalized dot product. Reranking only sees bounded child text + title/path and returns validated candidate indices; no output text from the reranker is trusted as evidence. Optional BGE endpoint uses `BAAI/bge-reranker-v2-m3`; Cohere uses its own key and explicit provider selection. A missing endpoint is visibly degraded, never reported as successful CrossEncoder inference.

Parent expansion rechecks eligibility, merges the same parent once, and respects the total context budget. Unanswered or conflicting facts are disclosed; source claims are not independently verified truths. There is no universal similarity threshold guaranteeing correctness. API failures may fall back to lexical/fused ranking with machine-readable degradation codes; `RAG_REQUIRE_RERANK=true` instead refuses evidence when reranking is unavailable.

## Public stream boundary

Evidence lives only in request-local server tool results. Private input deltas, results, paths, provider metadata, error details and reasoning never pass through to the client. Public widget output is reconstructed from server-owned post/timeline data rather than forwarded blindly. Request history is text-only, including the `originalMessages` passed to the SDK. The stream uses a deny-by-default event projection and only emits allowlisted citation labels, public URLs, numeric metadata and safe status summaries. Citation IDs are allocated once per request and checked against that registry.

This boundary protects raw source objects and operational fields, not the secrecy of facts explicitly approved for public answers. Repeated answers can reveal those approved facts. Genuine secrets must not enter the public-answer index.

## Cost and configuration

Reuse existing `OPENAI_API_KEY`; do not copy it into code. At the checked standard rates, Luna input/output cost $0.10/$0.50 per million tokens; large embeddings cost $0.13 per million. Example: aggregate 8000 input + 1000 output tokens costs $0.0013 for generation; 100,000 embedding tokens cost $0.013. Multi-step totals, reasoning output, cache pricing, retries, reranking and infrastructure change the bill. These are estimates, not a spend guarantee.

Ingestion prints token and embedding cost estimates before live processing and enforces a per-run budget. Online embedding/rerank estimates join the existing daily usage accounting. The existing application budget remains a soft concurrent circuit breaker, not a vendor hard cap. BGE has compute/hosting costs; no paid service is purchased by this implementation. A configured per-call rerank estimate is required for accurate hosted-cost reporting.

Sources: [Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), [embedding pricing](https://developers.openai.com/api/docs/models/text-embedding-3-large).

## Evaluation and release gates

Keep private human-reviewed JSONL separate from the public repo. Candidate seeds prepared earlier remain unreviewed. Gold labels bind source spans/evidence groups, not generated chunk IDs. Group translations/paraphrases into the same dev/test split.

Tests cover AST boundaries, long code/table limits, explicit eligibility, hybrid exact identifiers, RRF dedup, fixed-pool rerank, token budgets, ingestion retries/cache, stale publishers/revocation, malformed provider outputs, and sentinel leakage through HTTP/SSE events. Synthetic fixtures contain no real private documents.

Offline compare BM25 -> hybrid -> rerank -> parent expansion on the same eligible corpus. Report evidence Recall@K, all-required coverage, MRR/nDCG where applicable, final context coverage, citation/claim correctness and abstention. Ragas is an optional offline judge adapter; it is not imported into the website. Faithfulness is context support, not source truth. Expensive model evaluations are separate from deterministic CI. No 90%/350ms claims are considered achieved without recorded runs.

Deployment gate: passing build/type/lint/tests, a verified private snapshot, a working reranker or explicit degraded policy, stream sentinel checks, and live smoke verification. Installing code alone does not mean the production site or external worker has been deployed.

## Operator runbook

Run commands from this repository with Node 22. The CLI loads `.env.local`; reuse its existing `OPENAI_API_KEY`. Never paste credentials into commands. Keep the source JSON outside `public/` and outside the repository, or inside ignored `.rag-private/`. `.vercelignore`, Next output tracing exclusions and a postbuild manifest filter keep development stores/evaluation datasets out of deployment artifacts. The postbuild filter handles the installed Next 15 Windows glob mismatch; `npm run check:rag-artifacts` independently checks the result. Use `npm run build`, including its postbuild step, for deployment.

Start with a dry plan, then explicitly enqueue the full desired corpus. Omitting an existing document from a replacement withdraws its eligibility immediately, before the next snapshot is ready.

```sh
npm run rag -- plan --source /private/source-documents.json --public-ids es,dtcc,ebm,datagate,garment --blogs
npm run rag -- enqueue --source /private/source-documents.json --public-ids es,dtcc,ebm,datagate,garment --blogs
npm run rag -- run --max-usd 0.05
npm run rag -- status
npm run rag -- query --text "How does the DTCC pipeline control backpressure?"
```

Include every approved TRPG document ID as well when building the complete corpus. `plan` prints a full embedding estimate; actual ingestion reuses unchanged cached vectors. The per-run budget uses estimated provider prices and cannot prevent charges already incurred by an in-flight batch. Failures retry up to five attempts with backoff; `worker` keeps consuming until interrupted. `watch` takes the same source flags and detects changes every five seconds. After fixing a permanently failed job, use `enqueue --force` to create a new attempt without discarding the cache.

For remote publication, set `RAG_STORE=redis` in the trusted ingestion environment and the Vercel server environment, reusing the existing Upstash credentials. Run the same enqueue/worker commands there; a local snapshot is not automatically uploaded. First validate a remote index, then set `RAG_ENABLED=true`. The embedding model/dimensions must match between ingestion and serving. No remote index, scheduler or environment changes have been made by adding this code.

When the complete corpus is already indexed locally, `npm run rag -- publish` with the same source flags validates the local chunks against current source versions, transfers the snapshot and embedding cache to Redis, and publishes atomically with no embedding calls. It requires `RAG_STORE=redis`, reads the local `.rag-private/` store (or `RAG_LOCAL_DIR`), and refuses a stale or filtered local snapshot. Use `--force` only when deliberately republishing an older corpus as a new version.

Prefer a persistent trusted ingestion worker for larger updates. Optional `POST /api/internal/rag/worker` requires `Authorization: Bearer <RAG_WORKER_TOKEN>` with a random token of at least 32 characters. Each invocation is bounded to 45 seconds and $0.25 estimated embedding spend; arrange a scheduler with retries separately. A stopped invocation may require lease expiry before another worker resumes. CLI `status` records completed-attempt usage; a hard process crash or provider response lost in transit can leave billed usage unrecorded.

`revoke --id document-id` immediately blocks future retrieval across instances. Revocations persist across re-enqueue; there is intentionally no automatic restore command. Requests already in progress cannot retract evidence already delivered to a provider. To disable the feature, set `RAG_ENABLED=false`; this preserves the public blog tools. Content rollback is a reviewed re-enqueue of the previous full source pack with `--force`, followed by successful publication; it does not bypass revocations.

For BGE, see [the service runbook](../services/reranker/README.md). Set `RAG_RERANK_URL` to the private authenticated endpoint and set `RAG_RERANK_API_KEY` to its dedicated secret, never the OpenAI key. Use `RAG_REQUIRE_RERANK=true` once it is healthy to require CrossEncoder evidence. A timeout produces no private evidence under that setting; it is an availability policy, not a guarantee of correct answers. With the default `false`, fused retrieval continues and the UI shows a degraded status. Hosted Cohere is an optional adapter with a separate key/model/cost estimate; it is not configured automatically.

## Evaluation commands and remaining work

`npm run test:rag` runs deterministic synthetic regression checks in GitHub CI without any key or private corpus. For a real benchmark, create an ignored JSONL file with one human-reviewed item per line:

```json
{
  "id": "q1",
  "intentGroupId": "pipeline-backpressure",
  "humanReviewed": true,
  "query": "How is backpressure controlled?",
  "language": "en",
  "answerable": true,
  "evidenceGroups": [[{ "documentId": "sample", "unitId": "text", "start": 0, "end": 42 }]]
}
```

Each outer evidence group is a required fact; inner anchors are acceptable alternatives. Replace the example offsets with reviewed UTF-16 spans in the imported source units. The runner rejects `humanReviewed: false`. Prepared candidate questions are not benchmark ground truth until reviewed.

```sh
npm run test:eval -- --dataset .rag-evals/reviewed.jsonl
npm run test:eval -- --dataset .rag-evals/reviewed.jsonl --live
npm run test:eval -- --dataset .rag-evals/reviewed.jsonl --live --rerank
```

The current runner reports per-question candidate/selected evidence coverage, hit and reciprocal rank, degradation and index version. It does not yet score generated answers, final expanded-context coverage, nDCG, or aggregate confidence intervals. A Ragas answer-faithfulness/relevance adapter remains follow-up work after the reviewed dataset and recorded answer/context schema exist. Do not treat synthetic test success or a successful smoke question as measured corpus-wide RAG quality.

## Local validation record — 2026-10-09

- Indexed 20 documents: 13 private source documents/variants and 7 published posts, producing 346 parents and 486 children. Seventeen source units remain excluded for review; this is not a claim that every diagram, formula and table is searchable.
- Active pipeline is `structural-v2-cl100k`. The compressed float32 snapshot uses 168 transport pages, under 8.064 MB encoded, compared with approximately 33.5 MB in the earlier JSON snapshot. Remote Redis publication/cold-start performance has not been measured.
- Three ingestion passes consumed 155,453 returned embedding tokens in total, including implementation changes. At $0.13 per million this is $0.02020889 estimated embedding spend, excluding query embeddings and answer generation. Cache reuse was verified; this is not an account invoice.
- Real Luna HTTP smoke returned a completed answer with six approved source labels, an in-text citation and no private protocol fields. Latest sample: 50 candidates, 4,996 total model tokens and 7.21 seconds server generation duration. These are single observations, not P95 or quality benchmarks. An earlier run logged recoverable SDK stream errors; a repeat completed without those errors, and production logs now retain only error class names for diagnosis.
- All 21 deterministic regression tests, TypeScript checking, focused ESLint and Next production build passed. Final postbuild check inspected 21 deployment traces with no private RAG state remaining. CI includes regression and artifact checks.
- BGE service code and both rerank adapters are present; Python syntax and mocked HTTP response validation passed. BGE weights/inference, a hosted reranker, scheduler deployment and a reviewed Ragas evaluation run are **not** verified. Live retrieval correctly reports `rerank_unavailable` and uses RRF under the current default policy.

## Initial release configuration — 2026-10-09

The existing production Redis received snapshot `19600b6fe4e231f6d66aa19f2e0594010f8e81e1ce254784485521c4b84d899e` using the prepared-publication path. Snapshot and embedding cache transfer incurred zero new embedding tokens. A real read-back and Chinese query returned six evidence windows, including the DTCC project, with 47 fused candidates. The observed first retrieval from this machine took 10.5 seconds including cold snapshot loading; target-region latency remains a deployment measurement, not an SLA.

Production and Preview are configured with `RAG_STORE=redis`, `RAG_ENABLED=true`, and `RAG_REQUIRE_RERANK=false`. The initial release deliberately uses hybrid recall plus RRF until a reranker endpoint is provisioned and measured. The publication regression test increases the deterministic suite to 22 tests. Follow the GitHub checks and Vercel deployment status for release completion; changing environment variables does not update a deployment already running.
