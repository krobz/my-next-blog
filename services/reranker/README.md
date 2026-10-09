# BGE CrossEncoder service

This is the actual `sentence-transformers` CrossEncoder implementation for `BAAI/bge-reranker-v2-m3`, separate from the Next.js process. It ranks query/document pairs jointly, rather than comparing independent embeddings. The blog adapter validates returned candidate indices and never treats service-generated text as evidence.

Requires a Docker host, or Python with the packages in `requirements.txt`. The first startup downloads the model weights. Provide enough RAM for the model plus batches; CPU throughput and the blog's eight-second request timeout must be measured on the target host. No endpoint has been provisioned and no inference benchmark is claimed.

Example local launch (set the `RERANK_API_KEY` environment variable securely first):

```sh
docker build -t blog-bge services/reranker
docker run --rm -p 127.0.0.1:8080:8080 -e RERANK_API_KEY blog-bge
```

Configure the blog with `RAG_RERANK_PROVIDER=bge`, `RAG_RERANK_MODEL=BAAI/bge-reranker-v2-m3`, `RAG_RERANK_URL=http://127.0.0.1:8080/rerank`, and `RAG_RERANK_API_KEY` equal to that dedicated secret. For Vercel use an authenticated HTTPS endpoint reachable from the function; localhost refers to the function's own host. Do not reuse `OPENAI_API_KEY` as service authentication.

Requests accept at most 50 documents; responses contain only ranked indices and scores. Overlong tokenizer pairs are rejected instead of silently truncated. Concurrent inference returns 429 while the single model is busy. Access logs and interactive API documentation are disabled. Run behind a TLS proxy with body-size and timeout limits if exposed remotely. Pin the tested dependency/model revisions before production operation; the supplied dependency ranges are a starting point, not a reproducible model deployment lock.

Validate with `npm run rag -- query --text "your reviewed question"` and confirm the trace says `BAAI/bge-reranker-v2-m3` with no `rerank_unavailable`. Only then enable `RAG_REQUIRE_RERANK=true`. Model hosting is compute/storage/bandwidth cost even though this adapter has no per-request API fee.
