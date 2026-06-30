"""
map
    get markers
    update boundry
"""

from fastapi import APIRouter, HTTPException
from database import get_connection
from pydantic import BaseModel

map_router = APIRouter()


def ensure_polygon_vertex_style_columns(cursor):
    cursor.execute("""
        ALTER TABLE CardPolygonVertices
          ADD COLUMN IF NOT EXISTS FillColor VARCHAR(20),
          ADD COLUMN IF NOT EXISTS FillOpacity DOUBLE PRECISION,
          ADD COLUMN IF NOT EXISTS LineStyle VARCHAR(20),
          ADD COLUMN IF NOT EXISTS Icon VARCHAR(60)
    """)

class Point(BaseModel):
    lat: float
    long: float

# GET ALL MARKERS
@map_router.get("/getMarkers")
def getMarkers():
    try:
        connection = get_connection()
        if connection is None:
            raise HTTPException(status_code=503, detail="Database connection unavailable")
        with connection.cursor() as local_cur:
            ensure_polygon_vertex_style_columns(local_cur)
            local_cur.execute("""
                SELECT
                    c.CardID,
                    c.Title,
                    c.Latitude,
                    c.Longitude,
                    cat.CategoryLabel AS Category,
                    COALESCE(c.Name, '') AS Name,
                    u.Username,
                    u.Email,
                    c.Description,
                    c.Organization,
                    c.Funding,
                    c.Link,
                    COALESCE(
                        (
                            SELECT ci2.ImageURL
                            FROM CardImages ci2
                            WHERE ci2.CardID = c.CardID
                            ORDER BY ci2.DisplayOrder ASC, ci2.ImageID ASC
                            LIMIT 1
                        ),
                        c.Thumbnail_Link
                    ) AS Thumbnail_Link,
                    STRING_AGG(DISTINCT t.TagLabel, ', ') AS Tags,
                    COALESCE(
                        json_agg(
                            DISTINCT jsonb_build_object(
                                'fileid', f.fileid,
                                'filename', f.filename,
                                'file_link', f.file_link,
                                'fileextension', f.fileextension
                            )
                        ) FILTER (WHERE f.fileid IS NOT NULL),
                        '[]'
                    ) AS files,
                    COALESCE(c.LocationType, 'point') AS LocationType,
                    COALESCE(c.PolygonFillColor, '#0077c0') AS PolygonFillColor,
                    COALESCE(c.PolygonLineStyle, 'solid') AS PolygonLineStyle,
                    COALESCE(
                        (
                            SELECT json_agg(
                                jsonb_build_object(
                                    'lat', pv.Latitude,
                                    'lng', pv.Longitude,
                                    'ring', COALESCE(pv.RingIndex, 0),
                                    'fillColor', COALESCE(pv.FillColor, c.PolygonFillColor, '#0077c0'),
                                    'fillOpacity', COALESCE(pv.FillOpacity, 0.2),
                                    'lineStyle', COALESCE(pv.LineStyle, c.PolygonLineStyle, 'solid'),
                                    'icon', pv.Icon
                                )
                                ORDER BY COALESCE(pv.RingIndex, 0) ASC, pv.VertexOrder ASC
                            )
                            FROM CardPolygonVertices pv
                            WHERE pv.CardID = c.CardID
                        ),
                        '[]'
                    ) AS polygon_vertices
                FROM Cards c
                LEFT JOIN Categories cat ON c.CategoryID = cat.CategoryID
                LEFT JOIN CardTags ct ON c.CardID = ct.CardID
                LEFT JOIN Tags t ON ct.TagID = t.TagID
                LEFT JOIN Users u ON c.UserID = u.UserID
                LEFT JOIN Files f ON c.CardID = f.CardID
                GROUP BY
                    c.CardID,
                    c.Title,
                    c.Latitude,
                    c.Longitude,
                    c.LocationType,
                    c.PolygonFillColor,
                    c.PolygonLineStyle,
                    cat.CategoryLabel,
                    c.Name,
                    u.Username,
                    u.Email,
                    c.Description,
                    c.Organization,
                    c.Funding,
                    c.Link,
                    c.Thumbnail_Link
                ORDER BY c.CardID DESC
            """)
            rows = local_cur.fetchall() if local_cur.description else []
        columns = [
            "cardID", "title", "latitude", "longitude", "category", "name", "username", "email",
            "description", "org", "funding", "link", "thumbnail_link", "tags", "files",
            "location_type", "polygon_fill_color", "polygon_line_style", "polygon_vertices"
        ]
        data = [dict(zip(columns, row)) for row in rows]
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        connection = get_connection()
        if connection:
            connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# GET MARKERS WITHIN BOUNDS
@map_router.post("/updateBoundry")
def updateBoundry(NEpoint: Point, SWpoint: Point):
    try:
        connection = get_connection()
        if connection is None:
            raise HTTPException(status_code=503, detail="Database connection unavailable")
        with connection.cursor() as local_cur:
            local_cur.execute("""
                SELECT 
                    c.CardID,
                    u.Username,
                    u.Email,
                    c.Title,
                    cat.CategoryLabel,
                    c.DatePosted,
                    c.Description,
                    c.Organization,
                    c.Funding,
                    c.Link,
                    STRING_AGG(DISTINCT t.TagLabel, ', ') AS TagLabels,
                    c.Latitude,
                    c.Longitude,
                    COALESCE(
                        (
                            SELECT ci2.ImageURL
                            FROM CardImages ci2
                            WHERE ci2.CardID = c.CardID
                            ORDER BY ci2.DisplayOrder ASC, ci2.ImageID ASC
                            LIMIT 1
                        ),
                        c.Thumbnail_Link
                    ) AS Thumbnail_Link,
                    COALESCE(
                        json_agg(
                            DISTINCT jsonb_build_object(
                                'fileid', f.fileid,
                                'filename', f.filename,
                                'filelink', f.file_link,
                                'fileextension', f.filextension
                            )
                        ) FILTER (WHERE f.FileID IS NOT NULL),
                        '[]'
                    ) AS files
                FROM Cards c
                INNER JOIN Categories cat ON c.CategoryID = cat.CategoryID
                LEFT JOIN Files f ON c.CardID = f.CardID
                LEFT JOIN CardTags ct ON c.CardID = ct.CardID
                LEFT JOIN Tags t ON ct.TagID = t.TagID
                INNER JOIN Users u ON c.UserID = u.UserID
                WHERE c.Latitude BETWEEN %s AND %s
                  AND c.Longitude BETWEEN %s AND %s
                                GROUP BY c.CardID, cat.CategoryLabel, u.Username, u.Email, c.Thumbnail_Link
                ORDER BY c.CardID DESC;
            """, (SWpoint.lat, NEpoint.lat, SWpoint.long, NEpoint.long))

            rows = local_cur.fetchall() if local_cur.description else []
        columns = [
            "cardID", "username", "email", "title", "category", "date", "description", "org",
            "funding", "link", "tags", "latitude", "longitude", "thumbnail_link", "files"
        ]
        data = [dict(zip(columns, row)) for row in rows]
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:
        connection = get_connection()
        if connection:
            connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))