"""
cards_summary.py — GET /cards/summary

Internal endpoint consumed by the external RWC Living Atlas Helper Chatbot
service. Returns the compact card-context text block built by
chat.get_card_context: public, non-sensitive card data only (same fields the
public card endpoints already expose — no user identities or credentials).
"""

from fastapi import APIRouter, Query

from endpoint_files.chat import get_card_context

cards_summary_router = APIRouter(prefix="/cards", tags=["cards-summary"])


@cards_summary_router.get("/summary")
def cards_summary(q: str = Query("", max_length=500)):
    return {"context": get_card_context(q)}
