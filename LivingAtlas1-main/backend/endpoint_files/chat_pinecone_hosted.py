"""
chat_pinecone_hosted.py  —  /chat-pinecone/ask endpoint (Pinecone hosted embeddings)

Drop-in replacement for chat_pinecone.py that uses Pinecone's integrated
inference: the query text is sent as-is and embedded server-side by the model
attached to the index, so no local embedding model (fastembed) is needed.
Generation: DeepSeek API (same as chat.py / chat_pinecone.py).

Required env vars:
  PINECONE_API_KEY       — your Pinecone API key
  DEEPSEEK_API           — DeepSeek API key (same as chat.py)

Optional env vars:
  PINECONE_INDEX_HOSTED  — index name (default: "living-atlas-docs-hosted")
  DEEPSEEK_MODEL         — model name (default: deepseek-v4-flash)
"""

import os
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from openai import APIConnectionError, APITimeoutError, OpenAI

chat_pinecone_hosted_router = APIRouter(prefix="/chat-pinecone", tags=["chat-pinecone-hosted"])

NAMESPACE = "__default__"

# ---------------------------------------------------------------------------
# System prompt (identical to chat.py / chat_pinecone.py)
# ---------------------------------------------------------------------------
SYSTEM_PROMPT_BASE = """You are the RWC Living Atlas Helper, an AI assistant for the
Regional Water Center (RWC) Living Atlas web application — an interactive map
that showcases environmental datasets, GIS layers, and research resources for
the Pacific Northwest (Idaho, Oregon, and Washington).

Answer the user's question using the reference documentation provided below.
If the documentation does not cover the question, say so honestly — do not invent information.
Be concise, friendly, and factual.
Do not answer questions unrelated to the Living Atlas or environmental/GIS topics.

⚠️ This feature is under development. Always verify critical information with the original data source.
"""


# ---------------------------------------------------------------------------
# Pinecone retrieval (hosted embeddings — text in, matches out)
# ---------------------------------------------------------------------------
def get_pinecone_index():
    """Return a Pinecone Index object. Raises RuntimeError if not configured."""
    api_key = os.environ.get("PINECONE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("PINECONE_API_KEY environment variable is not set.")

    index_name = os.environ.get("PINECONE_INDEX_HOSTED", "living-atlas-docs-hosted")

    from pinecone import Pinecone

    pc = Pinecone(api_key=api_key)
    return pc.Index(index_name)


def get_relevant_docs(question: str, top_k: int = 3) -> str:
    """Query Pinecone for the top-k most relevant chunks. Fails silently."""
    try:
        index = get_pinecone_index()

        result = index.search(
            namespace=NAMESPACE,
            top_k=top_k,
            inputs={"text": question},
        )

        hits = result["result"]["hits"]
        if not hits:
            return ""

        chunks = [
            hit["fields"]["content"]
            for hit in hits
            if hit.get("fields", {}).get("content")
        ]
        return "\n\n---\n\n".join(chunks)

    except Exception as exc:
        print(f"[chat_pinecone_hosted] Retrieval warning: {exc}")
        return ""


# ---------------------------------------------------------------------------
# Request / response schemas (identical to chat.py)
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    question: str
    history: list[dict[str, Any]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@chat_pinecone_hosted_router.post("/ask", response_model=ChatResponse)
def ask(payload: ChatRequest):
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty.")

    raw_api_key = os.environ.get("DEEPSEEK_API", "")
    api_key = raw_api_key.strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Chatbot is not configured (missing DEEPSEEK_API). Please contact the administrator.",
        )

    context = get_relevant_docs(question)
    if context:
        system_prompt = (
            SYSTEM_PROMPT_BASE
            + "\n\n=== REFERENCE DOCUMENTATION ===\n"
            + context
        )
    else:
        system_prompt = SYSTEM_PROMPT_BASE

    client = OpenAI(base_url="https://api.deepseek.com", api_key=api_key)
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")

    messages = [{"role": "system", "content": system_prompt}]

    for msg in payload.history[-6:]:
        role = msg.get("role") if isinstance(msg, dict) else None
        text = msg.get("text") if isinstance(msg, dict) else None
        if role in {"user", "assistant"} and isinstance(text, str) and text.strip():
            messages.append({"role": role, "content": text})

    messages.append({"role": "user", "content": question})

    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=600,
            temperature=0.4,
        )
        answer = response.choices[0].message.content.strip()
        return ChatResponse(answer=answer)

    except Exception as e:
        print(
            "[chat_pinecone_hosted] DeepSeek request failed:",
            f"type={type(e).__name__}",
            f"status={getattr(e, 'status_code', None)}",
            f"message={str(e)}",
        )

        err_str = str(e)
        lowered = err_str.lower()
        status_code = getattr(e, "status_code", None)

        if isinstance(e, (APIConnectionError, APITimeoutError)) or "connection error" in lowered:
            raise HTTPException(status_code=503, detail="AI service unreachable. Try again later.") from e
        if status_code == 402 or "insufficient_balance" in lowered:
            raise HTTPException(status_code=402, detail="DeepSeek API credits exhausted.") from e
        if status_code in {401, 403} or "authentication" in lowered:
            raise HTTPException(status_code=503, detail="DeepSeek API credentials invalid.") from e
        if status_code == 429 or "rate limit" in lowered:
            raise HTTPException(status_code=503, detail="DeepSeek rate limit reached. Try again later.") from e

        raise HTTPException(status_code=502, detail=f"AI service error: {err_str}") from e
