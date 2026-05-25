"""
pinecone_index_docs.py — Index backend/docs markdown files into Pinecone.

Mirrors index_docs.py but uses Pinecone as the vector store instead of pgvector.

Required env vars:
  PINECONE_API_KEY   — your Pinecone API key
  PINECONE_INDEX     — index name (default: "living-atlas-docs")

Optional env vars:
  LOCAL_EMBED_MODEL  — fastembed model (default: BAAI/bge-small-en-v1.5, dim=384)

Usage:
  python scripts/pinecone_index_docs.py
"""

import os
import sys
from pathlib import Path

print("=== pinecone_index_docs.py starting ===", flush=True)

# Load .env from backend/ directory if present (local development)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception as _e:
    print(f"[dotenv] Warning: {_e}", flush=True)

MAX_CHARS = 400
LOCAL_EMBED_MODEL = os.environ.get("LOCAL_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
EMBEDDING_DIM = 384  # matches BAAI/bge-small-en-v1.5
PINECONE_INDEX_NAME = os.environ.get("PINECONE_INDEX", "living-atlas-docs")


# ---------------------------------------------------------------------------
# Chunking (identical to index_docs.py)
# ---------------------------------------------------------------------------
def chunk_markdown(text: str, max_chars: int = MAX_CHARS) -> list[str]:
    """Split by paragraphs, merge short consecutive ones up to max_chars."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        if not current:
            current = paragraph
            continue
        candidate = f"{current}\n\n{paragraph}"
        if len(candidate) <= max_chars:
            current = candidate
        else:
            chunks.append(current)
            current = paragraph

    if current:
        chunks.append(current)

    return [c for c in chunks if c.strip()]


# ---------------------------------------------------------------------------
# Local embedder (same as index_docs.py)
# ---------------------------------------------------------------------------
def get_local_embedder():
    try:
        from fastembed import TextEmbedding
    except ImportError as exc:
        raise RuntimeError(
            "fastembed is required. Install it with: pip install fastembed"
        ) from exc
    return TextEmbedding(model_name=LOCAL_EMBED_MODEL)


def embed_text(embedder, text: str) -> list[float]:
    vector = next(embedder.embed([text]))
    return [float(v) for v in vector.tolist()]


# ---------------------------------------------------------------------------
# Pinecone helpers
# ---------------------------------------------------------------------------
def get_pinecone_index(api_key: str):
    """Connect to (or create) the Pinecone index and return it."""
    try:
        from pinecone import Pinecone, ServerlessSpec
    except ImportError as exc:
        raise RuntimeError(
            "pinecone is required. Install it with: pip install pinecone"
        ) from exc

    pc = Pinecone(api_key=api_key)

    existing = [idx.name for idx in pc.list_indexes()]
    if PINECONE_INDEX_NAME not in existing:
        print(f"Index '{PINECONE_INDEX_NAME}' not found — creating it...")
        pc.create_index(
            name=PINECONE_INDEX_NAME,
            dimension=EMBEDDING_DIM,
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
        print(f"✓ Index '{PINECONE_INDEX_NAME}' created.")
    else:
        print(f"✓ Using existing index '{PINECONE_INDEX_NAME}'.")

    return pc.Index(PINECONE_INDEX_NAME)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    api_key = os.environ.get("PINECONE_API_KEY", "").strip()
    if not api_key:
        print("Error: PINECONE_API_KEY environment variable is not set.")
        return 1

    docs_dir = Path(__file__).resolve().parents[1] / "docs"
    md_files = sorted(docs_dir.glob("*.md"))

    if not md_files:
        print(f"No markdown files found in {docs_dir}")
        return 0

    embedder = get_local_embedder()
    index = get_pinecone_index(api_key)

    # Clear existing vectors for a clean re-index
    # Use namespace="" for SDK v5+ compatibility with serverless indexes
    print("Clearing existing vectors from index...")
    try:
        index.delete(delete_all=True, namespace="")
    except Exception as e:
        print(f"  (Clear warning — continuing anyway: {e})")
    print("✓ Index cleared.")

    vectors = []
    total_chunks = 0

    for md_file in md_files:
        text = md_file.read_text(encoding="utf-8")
        chunks = chunk_markdown(text)

        for i, chunk in enumerate(chunks):
            embedding = embed_text(embedder, chunk)
            vector_id = f"{md_file.stem}-{i}"
            vectors.append({
                "id": vector_id,
                "values": embedding,
                "metadata": {
                    "source": md_file.name,
                    "content": chunk,
                },
            })
            total_chunks += 1

        print(f"✓ Prepared {md_file.name} — {len(chunks)} chunks")

    # Upsert in batches of 100 (Pinecone recommended batch size)
    BATCH_SIZE = 100
    for i in range(0, len(vectors), BATCH_SIZE):
        batch = vectors[i : i + BATCH_SIZE]
        index.upsert(vectors=batch)
        print(f"  Upserted batch {i // BATCH_SIZE + 1} ({len(batch)} vectors)")

    print(f"\nDone. Total chunks indexed into Pinecone: {total_chunks}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        import traceback
        print(f"\nIndexing failed: {exc}")
        traceback.print_exc()
        sys.exit(1)
