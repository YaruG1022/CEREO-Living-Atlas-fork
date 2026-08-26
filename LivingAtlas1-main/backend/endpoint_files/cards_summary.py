"""
cards_summary.py — GET /cards/summary

Internal endpoint consumed by the external RWC Living Atlas Helper Chatbot
service. Returns a compact card-context text block: public, non-sensitive
card data only (same fields the public card endpoints already expose — no
user identities or credentials).

The card-context logic previously lived in the chatbot's chat.py; it moved
here when the chatbot was extracted into its own service and the in-app chat
endpoints were removed.
"""

import re
from typing import Any

import psycopg2
from fastapi import APIRouter, Query

cards_summary_router = APIRouter(prefix="/cards", tags=["cards-summary"])


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
                desc = desc[:200].rstrip() + "…"
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
        print(f"[cards_summary] Card context warning: {exc}")
        return ""
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@cards_summary_router.get("/summary")
def cards_summary(q: str = Query("", max_length=500)):
    return {"context": get_card_context(q)}
