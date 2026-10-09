"""Private BGE CrossEncoder adapter. Documents are never written to logs."""
import os
import secrets
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import CrossEncoder

MODEL = "BAAI/bge-reranker-v2-m3"
model = None
lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    global model
    if not os.environ.get("RERANK_API_KEY"):
        raise RuntimeError("RERANK_API_KEY must be configured")
    model = CrossEncoder(MODEL, device=os.environ.get("RERANK_DEVICE", "cpu"))
    model.max_length = min(8192, model.tokenizer.model_max_length)
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


class RerankRequest(BaseModel):
    model: str = MODEL
    query: str = Field(min_length=1, max_length=2000)
    documents: list[str] = Field(min_length=1, max_length=50)
    top_n: int = Field(default=8, ge=1, le=50)


@app.post("/rerank")
def rerank(request: RerankRequest, authorization: str = Header(default="")):
    expected = "Bearer " + os.environ["RERANK_API_KEY"]
    if not secrets.compare_digest(authorization, expected):
        raise HTTPException(401, "Unauthorized")
    if request.model != MODEL or any(len(doc) > 24000 for doc in request.documents):
        raise HTTPException(400, "Unsupported model or document size")
    pairs = [[request.query, text] for text in request.documents]
    # Reject rather than silently truncate query/document pairs at a library default.
    for pair in pairs:
        if len(model.tokenizer(*pair, truncation=False)["input_ids"]) > model.max_length:
            raise HTTPException(422, "Pair exceeds tokenizer budget")
    if not lock.acquire(blocking=False):
        raise HTTPException(429, "Reranker busy")
    try:
        scores = model.predict(pairs, batch_size=4, show_progress_bar=False)
        ranked = sorted(enumerate(scores), key=lambda item: float(item[1]), reverse=True)
        return {"results": [{"index": i, "relevance_score": float(score)} for i, score in ranked[:request.top_n]]}
    except Exception:
        raise HTTPException(503, "Reranker unavailable") from None
    finally:
        lock.release()
