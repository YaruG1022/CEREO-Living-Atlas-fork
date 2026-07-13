"""
chat.py  —  /chat/ask endpoint

Embedding: local fastembed (BAAI/bge-small-en-v1.5), runs in-process.
Generation: DeepSeek API (OpenAI-compatible). Set DEEPSEEK_API on Render.
  Model is configured via DEEPSEEK_MODEL env var (default: deepseek-v4-flash).
"""

import os
from typing import Any

import psycopg2
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from openai import APIConnectionError, APITimeoutError, OpenAI, OpenAIError
from endpoint_files.chat_agent import build_default_chat_agent

chat_router = APIRouter(prefix="/chat", tags=["chat"])
_LOCAL_EMBEDDER = None
_LOCAL_EMBEDDER_NAME = None
_CHAT_AGENT = build_default_chat_agent()

# ---------------------------------------------------------------------------
# System prompt: gives the model context about the Living Atlas project
# ---------------------------------------------------------------------------
SYSTEM_PROMPT_BASE = """You are the RWC Living Atlas Helper, an AI assistant for the
Regional Water Center (RWC) Living Atlas web application — an interactive map
that showcases environmental datasets, GIS layers, and research resources for
the Pacific Northwest (Idaho, Oregon, and Washington).

Answer the user's question using the reference documentation, live card data, and skill outputs provided below.
If the documentation does not cover the question, say so honestly — do not invent information.
Be concise, friendly, and factual.
Do not answer questions unrelated to the Living Atlas or environmental/GIS topics.

PRIVACY (strict): The card data you receive contains only public, non-sensitive fields.
It never includes usernames, emails, passwords, or any account/identity information.
Never reveal, guess, or discuss who created or uploaded a card, and never disclose any
user's username, email, password, or contact details. If asked who made a card or for any
user's personal or login information, politely decline and explain that contributor
identities and account data are private and not accessible to this assistant.

⚠️ This feature is under development. Always verify critical information with the original data source.
"""


def get_db_connection():
    """Use the same Azure PostgreSQL connection pattern as backend/database.py."""
    return psycopg2.connect(
        dbname="postgres",
        user="CereoAtlas",
        password="LivingAtlas25$",
        host="cereo-livingatlas-db.postgres.database.azure.com",
        port="5432",
        sslmode="require",
        connect_timeout=10,
    )


def get_local_embedder():
    """Create/reuse local embedding model."""
    global _LOCAL_EMBEDDER, _LOCAL_EMBEDDER_NAME
    model_name = os.environ.get("LOCAL_EMBED_MODEL", "BAAI/bge-small-en-v1.5")

    if _LOCAL_EMBEDDER is not None and _LOCAL_EMBEDDER_NAME == model_name:
        return _LOCAL_EMBEDDER

    from fastembed import TextEmbedding

    _LOCAL_EMBEDDER = TextEmbedding(model_name=model_name)
    _LOCAL_EMBEDDER_NAME = model_name
    return _LOCAL_EMBEDDER


def embed_query_local(text: str) -> list[float]:
    embedder = get_local_embedder()
    vector = next(embedder.embed([text]))
    return [float(value) for value in vector.tolist()]


def get_relevant_docs(question: str, top_k: int = 3) -> str:
    """Fetch top-k relevant chunks by cosine distance. Fail silently."""
    conn = None
    cur = None
    try:
        embedding = embed_query_local(question)
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute(
            """
            SELECT content
            FROM doc_chunks
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (str(embedding), top_k),
        )
        rows = cur.fetchall()
        if not rows:
            return ""
        return "\n\n---\n\n".join(row[0] for row in rows if row and row[0])
    except Exception as exc:
        print(f"[chat] Retrieval warning: {exc}")
        return ""
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# Live card data (non-sensitive)
# ---------------------------------------------------------------------------
# Lets the assistant answer questions about the cards currently in the database
# WITHOUT ever exposing user identities or credentials. Only safe, public
# columns are queried; the Users table is never joined, and uploader-only
# (private) cards are excluded.
# ---------------------------------------------------------------------------
_CARD_QUERY_KEYWORDS = (
    "card", "cards", "dataset", "datasets", "data point", "datapoint",
    "marker", "markers", "pin", "pins", "monitoring", "station", "stations",
    "how many", "count", "list", "show me", "what data", "which data",
    "uploaded", "contributed", "category", "categories", "tag", "tags",
    "river", "watershed", "places", "water quality", "organization",
)

_CARD_SEARCH_STOPWORDS = {
    "the", "and", "for", "are", "what", "which", "how", "many", "show",
    "you", "your", "list", "card", "cards", "data", "about", "with",
    "that", "this", "have", "has", "any", "all", "from", "into", "near",
    "does", "there", "please", "tell", "give",
}


def _looks_like_card_question(question: str) -> bool:
    lowered = question.lower()
    return any(keyword in lowered for keyword in _CARD_QUERY_KEYWORDS)


def _extract_search_terms(question: str) -> list[str]:
    import re

    words = re.findall(r"[a-zA-Z]{3,}", question.lower())
    terms: list[str] = []
    for word in words:
        if word not in _CARD_SEARCH_STOPWORDS and word not in terms:
            terms.append(word)
        if len(terms) >= 6:
            break
    return terms


def get_card_context(question: str, max_cards: int = 12) -> str:
    """Return a compact, non-sensitive summary of matching cards. Fail silently.

    Security: queries only public card columns (no username/email/password and no
    Users join) and excludes uploader-only (private) cards.
    """
    if not _looks_like_card_question(question):
        return ""

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Category breakdown (public cards only)
        cur.execute(
            """
            SELECT COALESCE(cat.CategoryLabel, 'None') AS category, COUNT(*)
            FROM Cards c
            LEFT JOIN Categories cat ON c.CategoryID = cat.CategoryID
            WHERE c.is_public IS NOT FALSE
            GROUP BY COALESCE(cat.CategoryLabel, 'None')
            ORDER BY COUNT(*) DESC
            """
        )
        category_rows = cur.fetchall()
        total = sum(count for _, count in category_rows)
        if total == 0:
            return ""

        summary_lines = [
            f"Total public cards: {total}",
            "By category: "
            + ", ".join(f"{label} ({count})" for label, count in category_rows),
        ]

        # Matching cards by keyword, else most recent
        terms = _extract_search_terms(question)
        params: list[Any] = []
        where_match = ""
        if terms:
            patterns = [f"%{term}%" for term in terms]
            where_match = """
                AND (
                    c.Title ILIKE ANY(%s)
                    OR c.Description ILIKE ANY(%s)
                    OR c.Organization ILIKE ANY(%s)
                    OR EXISTS (
                        SELECT 1 FROM CardTags ct2
                        JOIN Tags t2 ON ct2.TagID = t2.TagID
                        WHERE ct2.CardID = c.CardID AND t2.TagLabel ILIKE ANY(%s)
                    )
                )
            """
            params = [patterns, patterns, patterns, patterns]

        query = f"""
            SELECT
                c.Title,
                COALESCE(cat.CategoryLabel, 'None') AS category,
                c.DatePosted,
                c.Description,
                c.Organization,
                c.Funding,
                c.Link,
                c.Latitude,
                c.Longitude,
                COALESCE(c.LocationType, 'point') AS location_type,
                STRING_AGG(DISTINCT t.TagLabel, ', ') AS tags
            FROM Cards c
            LEFT JOIN Categories cat ON c.CategoryID = cat.CategoryID
            LEFT JOIN CardTags ct ON c.CardID = ct.CardID
            LEFT JOIN Tags t ON ct.TagID = t.TagID
            WHERE c.is_public IS NOT FALSE
            {where_match}
            GROUP BY c.CardID, c.Title, cat.CategoryLabel, c.DatePosted,
                     c.Description, c.Organization, c.Funding, c.Link,
                     c.Latitude, c.Longitude, c.LocationType
            ORDER BY c.DatePosted DESC NULLS LAST, c.CardID DESC
            LIMIT %s
        """
        params.append(max_cards)
        cur.execute(query, params)
        rows = cur.fetchall()

        card_lines: list[str] = []
        for row in rows:
            (title, category, date_posted, description, organization,
             funding, link, lat, lng, location_type, tags) = row
            desc = (description or "").strip().replace("\n", " ")
            if len(desc) > 200:
                desc = desc[:200].rstrip() + "\u2026"
            parts = [f"- {title} [{category}]"]
            if organization:
                parts.append(f"org: {organization}")
            if tags:
                parts.append(f"tags: {tags}")
            if location_type and location_type != "point":
                parts.append(f"type: {location_type}")
            if lat is not None and lng is not None:
                parts.append(f"location: {float(lat):.4f}, {float(lng):.4f}")
            if date_posted:
                parts.append(f"posted: {date_posted}")
            if funding:
                parts.append(f"funding: {funding}")
            if link:
                parts.append(f"link: {link}")
            if desc:
                parts.append(f"desc: {desc}")
            card_lines.append(" | ".join(parts))

        block = "Card database summary (public, non-sensitive data only):\n"
        block += "\n".join(summary_lines)
        if card_lines:
            label = "Matching cards" if terms else "Most recent cards"
            block += f"\n\n{label}:\n" + "\n".join(card_lines)
        return block
    except Exception as exc:
        print(f"[chat] Card context warning: {exc}")
        return ""
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    question: str
    history: list[dict[str, Any]] = Field(default_factory=list)

class ChatResponse(BaseModel):
    answer: str

# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@chat_router.post("/ask", response_model=ChatResponse)
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
    if raw_api_key != api_key:
        # Render env vars sometimes include trailing newline/space from copy-paste.
        print("[chat] Warning: DEEPSEEK_API contained leading/trailing whitespace; sanitized automatically.")

    doc_context = get_relevant_docs(question)
    card_context = get_card_context(question)
    skill_context = _CHAT_AGENT.build_skill_context(question)

    context_sections = []
    if doc_context:
        context_sections.append("=== REFERENCE DOCUMENTATION ===\n" + doc_context)
    if card_context:
        context_sections.append(
            "=== LIVE CARD DATA (PUBLIC, NON-SENSITIVE) ===\n" + card_context
        )
    if skill_context:
        context_sections.append("=== LIVE SKILL OUTPUTS ===\n" + skill_context)

    if context_sections:
        system_prompt = SYSTEM_PROMPT_BASE + "\n\n" + "\n\n".join(context_sections)
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
        # Print safe diagnostics for Render logs (no API key content).
        print(
            "[chat] DeepSeek request failed:",
            f"type={type(e).__name__}",
            f"status={getattr(e, 'status_code', None)}",
            f"message={str(e)}",
        )
        if getattr(e, "__cause__", None):
            print(f"[chat] DeepSeek cause type: {type(e.__cause__).__name__}")

        err_str = str(e)
        lowered = err_str.lower()
        status_code = getattr(e, "status_code", None)

        if "illegal header value" in lowered:
            raise HTTPException(
                status_code=503,
                detail=(
                    "The chatbot is temporarily unavailable because the DeepSeek API key format is invalid "
                    "(it may contain whitespace/newline). Please contact the administrator."
                ),
            ) from e

        if isinstance(e, (APIConnectionError, APITimeoutError)) or "connection error" in lowered or "timed out" in lowered:
            raise HTTPException(
                status_code=503,
                detail=(
                    "The chatbot is temporarily unavailable because the DeepSeek API "
                    "could not be reached. Please try again later or contact the administrator."
                ),
            ) from e

        if status_code == 402 or "insufficient_balance" in lowered or "402" in err_str:
            raise HTTPException(
                status_code=402,
                detail=(
                    "The chatbot is temporarily unavailable because the DeepSeek API credits "
                    "have been exhausted. Please contact the administrator."
                ),
            ) from e

        if status_code in {401, 403} or "authentication" in lowered or "permission" in lowered:
            raise HTTPException(
                status_code=503,
                detail=(
                    "The chatbot is temporarily unavailable because the DeepSeek API "
                    "credentials are invalid or unauthorized. Please contact the administrator."
                ),
            ) from e

        if status_code == 429 or "rate limit" in lowered:
            raise HTTPException(
                status_code=503,
                detail=(
                    "The chatbot is temporarily unavailable because the DeepSeek API "
                    "rate limit was reached. Please try again later."
                ),
            ) from e

        raise HTTPException(status_code=502, detail=f"AI service error: {err_str}") from e

