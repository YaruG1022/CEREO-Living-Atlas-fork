from fastapi import APIRouter, HTTPException, Query
from database import conn
from pydantic import BaseModel
from typing import Optional

card_arcgis_links_router = APIRouter()


def _ensure_table():
    with conn.cursor() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS CardArcGISLinks (
                id SERIAL PRIMARY KEY,
                card_id INTEGER NOT NULL REFERENCES Cards(CardID) ON DELETE CASCADE,
                service_key TEXT NOT NULL,
                layer_id INTEGER,
                sublayer_index INTEGER,
                display_name TEXT NOT NULL,
                item_type TEXT NOT NULL,
                state_code TEXT NOT NULL,
                folder_name TEXT NOT NULL
            )
        """)
        c.execute("ALTER TABLE CardArcGISLinks ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT FALSE")
        conn.commit()


try:
    _ensure_table()
except Exception as e:
    print(f"[CardArcGISLinks] Failed to ensure table: {e}")


class LinkCreate(BaseModel):
    card_id: int
    service_key: str
    layer_id: Optional[int] = None
    sublayer_index: Optional[int] = None
    display_name: str
    item_type: str
    state_code: str
    folder_name: str


@card_arcgis_links_router.get("/cardArcGISLinks")
def get_card_arcgis_links(card_id: int = Query(...)):
    try:
        with conn.cursor() as c:
            c.execute("""
                SELECT id, card_id, service_key, layer_id, sublayer_index,
                       display_name, item_type, state_code, folder_name, is_visible
                FROM CardArcGISLinks
                WHERE card_id = %s
                ORDER BY id ASC
            """, (card_id,))
            rows = c.fetchall()
        columns = ["id", "card_id", "service_key", "layer_id", "sublayer_index",
                   "display_name", "item_type", "state_code", "folder_name", "is_visible"]
        return {"data": [dict(zip(columns, row)) for row in rows]}
    except Exception as e:
        print(f"[CardArcGISLinks] GET error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@card_arcgis_links_router.post("/cardArcGISLinks")
def create_card_arcgis_link(link: LinkCreate):
    try:
        with conn.cursor() as c:
            c.execute("""
                INSERT INTO CardArcGISLinks
                    (card_id, service_key, layer_id, sublayer_index,
                     display_name, item_type, state_code, folder_name)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (link.card_id, link.service_key, link.layer_id, link.sublayer_index,
                  link.display_name, link.item_type, link.state_code, link.folder_name))
            new_id = c.fetchone()[0]
            conn.commit()
        return {"id": new_id}
    except Exception as e:
        print(f"[CardArcGISLinks] POST error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


class LinkVisibilityUpdate(BaseModel):
    is_visible: bool


@card_arcgis_links_router.patch("/cardArcGISLinks/{link_id}")
def update_card_arcgis_link_visibility(link_id: int, update: LinkVisibilityUpdate):
    try:
        with conn.cursor() as c:
            c.execute(
                "UPDATE CardArcGISLinks SET is_visible = %s WHERE id = %s",
                (update.is_visible, link_id),
            )
            conn.commit()
        return {"success": True}
    except Exception as e:
        print(f"[CardArcGISLinks] PATCH error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@card_arcgis_links_router.delete("/cardArcGISLinks/{link_id}")
def delete_card_arcgis_link(link_id: int):
    try:
        with conn.cursor() as c:
            c.execute("DELETE FROM CardArcGISLinks WHERE id = %s", (link_id,))
            conn.commit()
        return {"success": True}
    except Exception as e:
        print(f"[CardArcGISLinks] DELETE error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
