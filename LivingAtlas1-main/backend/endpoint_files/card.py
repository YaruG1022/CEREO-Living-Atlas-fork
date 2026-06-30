"""
card
    delete card
    download file      
    upload form         

"""

from fastapi import APIRouter, File, Form, UploadFile, HTTPException, Response
from database import conn, cur
from io import BytesIO
from typing import Optional
from fastapi.responses import FileResponse
from google.cloud import storage
import psycopg2
import os
import uuid
import json
import tempfile
from database import get_connection
from .file_utils import compress_file #importing my function that handles compressing files for use in /uploadForm


card_router = APIRouter()

import os, base64

# Decode the GCP credentials from the environment variable and write to file
# COMMENT OUT IF RUNNING LOCALLY

gcs_key = os.environ.get("GOOGLE_CREDENTIALS_BASE64")
if gcs_key:
    with open("ServiceKey_GoogleCloud.json", "wb") as f:
        f.write(base64.b64decode(gcs_key))
    os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = "ServiceKey_GoogleCloud.json"
# _______________________________________

# COMMENT OUT IF RUNNING ON RENDER
#os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = "ServiceKey_GoogleCloud.json"
# _______________________________________
        
storage_client = storage.Client()
bucket_name = "cereo_atlas_storage"
bucket = storage_client.bucket(bucket_name)
DEFAULT_THUMBNAIL_URL = "https://storage.googleapis.com/cereo_atlas_storage/thumbnails/default_cereo_thumbnail.png"


def ensure_polygon_vertex_style_columns(cursor):
    cursor.execute("""
        ALTER TABLE CardPolygonVertices
          ADD COLUMN IF NOT EXISTS FillColor VARCHAR(20),
          ADD COLUMN IF NOT EXISTS FillOpacity DOUBLE PRECISION,
          ADD COLUMN IF NOT EXISTS LineStyle VARCHAR(20)
    """)

# Function to delete files from Google Cloud
def delete_from_bucket(blob_name):
    try:
        bucket = storage_client.get_bucket(bucket_name)
        blob = bucket.blob(blob_name)
        blob.delete()
        print(f"File: {blob_name} deleted.")
    except Exception as e:
        print(e)
        return

# Function to upload files to Google Cloud
def upload_to_bucket(destination_path, local_path, file_type, bucket_name):
    try:
        # Always reopen the file to ensure readable stream
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(destination_path)

        with open(local_path, "rb") as f:
            blob.upload_from_file(f, content_type=file_type)

        
        print(f"[UPLOAD SUCCESS] {destination_path}")
        return True
    except Exception as e:
        print(f"[UPLOAD ERROR] {e}")
        return False
    
# Function to upload an image to Google Cloud Storage and return its URL
def upload_image(file: Optional[UploadFile]) -> str:
    if not file:
        return DEFAULT_THUMBNAIL_URL

    allowed_extensions = {"png", "jpg", "jpeg", "gif"}
    if '.' not in file.filename or file.filename.rsplit('.', 1)[1].lower() not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Invalid thumbnail file type. Allowed: PNG, JPG, JPEG, GIF")

    try:
        # Rewind the file pointer to ensure it's readable
        file.file.seek(0)

        # Generate unique filename
        unique_filename = f"{uuid.uuid4()}_{file.filename}"
        blob = bucket.blob(f"thumbnails/{unique_filename}")
        blob.upload_from_file(file.file, content_type=file.content_type)

        public_url = f"https://storage.googleapis.com/{bucket_name}/thumbnails/{unique_filename}"
        return public_url
    except Exception as e:
        print(f"Thumbnail upload error: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload thumbnail image.")


@card_router.post("/create-card")
async def create_card(
    title: str = Form(...),
    description: str = Form(...),
    thumbnail: UploadFile = File(None)
):
    thumbnail_link = upload_image(thumbnail) if thumbnail else DEFAULT_THUMBNAIL_URL
    cur.execute("INSERT INTO Cards (title, description, thumbnail_link) VALUES (%s, %s, %s)",
                (title, description, thumbnail_link))
    conn.commit()
    return {"message": "Card created successfully", "thumbnail_link": thumbnail_link}

@card_router.delete("/deleteCard")
async def deleteCard(username: str, title: str, requester_email: str = None):
    if username is None or title is None:
        raise HTTPException(status_code=422, detail="Username and title must not be None")
    if not isinstance(username, str) or not isinstance(title, str):
        raise HTTPException(status_code=422, detail="Username and title must be strings")

    try:
        cur.execute("""
            SELECT Cards.CardID, Cards.thumbnail_link, Users.Email
            FROM Users
            JOIN Cards ON Users.UserID = Cards.UserID
            WHERE Users.Username = %s AND Cards.Title = %s
        """, (username, title))
        result = cur.fetchone()
        print(f"Card fetch result: {result}")
        if result is None:
            raise HTTPException(status_code=404, detail="Card not found")
        cardID, thumbnail_link, card_owner_email = result

        if requester_email:
            cur.execute("SELECT Is_Admin FROM Users WHERE Email = %s", (requester_email,))
            requester_row = cur.fetchone()
            if requester_row is None:
                raise HTTPException(status_code=403, detail="Requester account not found")
            requester_is_admin = bool(requester_row[0])
            if not requester_is_admin and requester_email.lower() != card_owner_email.lower():
                raise HTTPException(status_code=403, detail="You do not have permission to delete this card")

        if thumbnail_link and thumbnail_link != DEFAULT_THUMBNAIL_URL:
            # Convert full URL to blob path by stripping bucket URL prefix:
            try:
                blob_path = thumbnail_link.replace(f"https://storage.googleapis.com/{bucket_name}/", "")
                delete_from_bucket(blob_path)
            except Exception as e:
                print(f"[WARN] Failed to parse/delete thumbnail: {e}")
        
        # Delete file in cloud service
        cur.execute("""
            SELECT file_link 
            FROM Files
            WHERE CardID = %s
        """, (cardID,))
        file_link = cur.fetchone()
        if file_link:
            try:
                blob_path = file_link[0].replace(f"https://storage.googleapis.com/{bucket_name}/", "")
                delete_from_bucket(blob_path)
            except Exception as e:
                print(f"[WARN] Failed to parse/delete file: {e}")

        cur.execute("DELETE FROM Favorites WHERE CardID = %s", (cardID,))
        cur.execute("DELETE FROM Files WHERE CardID = %s", (cardID,))
        cur.execute("DELETE FROM CardTags WHERE CardID = %s", (cardID,))
        cur.execute("DELETE FROM Cards WHERE CardID = %s", (cardID,))
        conn.commit()
        return {"Success": "The card is deleted"}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"Failed to delete card: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete card: {e}")

@card_router.delete("/deleteFile")
async def delete_file(fileID: int):
    """
    Deletes a file from both the database and Google Cloud Storage.
    """
    try:
        # Get file info
        cur.execute("SELECT file_link FROM Files WHERE fileid = %s", (fileID,))
        result = cur.fetchone()
        if not result:
            raise HTTPException(status_code=404, detail="File not found")

        file_link = result[0]
        blob_path = file_link.replace(f"https://storage.googleapis.com/{bucket_name}/", "")

        # Delete from GCS
        try:
            delete_from_bucket(blob_path)
            print(f"[FILE DELETE] Deleted from GCS: {blob_path}")
        except Exception as e:
            print(f"[WARN] Could not delete from GCS: {e}")

        # Delete from DB
        cur.execute("DELETE FROM Files WHERE fileid = %s", (fileID,))
        conn.commit()

        return {"success": True, "message": f"File {fileID} deleted successfully."}

    except Exception as e:
        conn.rollback()
        print(f"[DELETE FILE ERROR] {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting file: {e}")

@card_router.post("/bookmarkCard")
async def bookmark_card(username: str = Form(...), cardID: int = Form(...)):
    try:
        print(f"[BOOKMARK] Incoming request: username={username}, cardID={cardID}")
        cur.execute("""
            INSERT INTO Favorites (UserID, CardID)
            SELECT u.UserID, %s
            FROM Users u
            WHERE LOWER(u.Username) = LOWER(%s)
            ON CONFLICT DO NOTHING
        """, (cardID, username))
        conn.commit()
        return {"message": "Card bookmarked successfully"}
    except Exception as e:
        print(f"[BOOKMARK ERROR] {e}")
        raise HTTPException(status_code=500, detail=str(e))

@card_router.post("/unbookmarkCard")
async def unbookmark_card(username: str = Form(...), cardID: int = Form(...)):
    try:
        print(f"[UNBOOKMARK] Incoming request: username={username}, card_id={cardID}")
        cur.execute("""
            DELETE FROM Favorites
            WHERE UserID = (SELECT UserID FROM Users WHERE LOWER(Username) = LOWER(%s))
              AND CardID = %s
        """, (username, cardID))
        conn.commit()
        return {"message": "Card removed from bookmarks"}
    except Exception as e:
        print(f"[UNBOOKMARK ERROR] {e}")
        raise HTTPException(status_code=500, detail=str(e))

@card_router.get("/getBookmarkedCards")
def get_bookmarked_cards(username: str):
    try:
        username = username.strip()
        cur.execute("SELECT UserID FROM Users WHERE LOWER(Username) = LOWER(%s)", (username,))
        result = cur.fetchone()

        if not result:
            return {"bookmarkedCards": []}

        user_id = result[0]
        cur.execute("""
            SELECT c.CardID AS "cardID"
            FROM Favorites f
            JOIN Cards c ON f.CardID = c.CardID
            WHERE f.UserID = %s
        """, (user_id,))

        rows = cur.fetchall()
        columns = ["cardID"]
        data = [dict(zip(columns, row)) for row in rows]
        return {"bookmarkedCards": data}

    except Exception as e:
        print(f"[EXCEPTION] {e}")
        raise HTTPException(status_code=500, detail=str(e))

@card_router.get("/downloadFile")
async def downloadFile(fileID: int):
    """
    Return the public Google Cloud Storage link for a file by fileID,
    and include Content-Disposition headers so the browser downloads it cleanly.
    """
    cur.execute("SELECT filename, file_link FROM files WHERE fileid = %s", (fileID,))
    result = cur.fetchone()
    if result is None:
        raise HTTPException(status_code=422, detail="File not found in the database")

    filename, file_link = result

    # Option A: redirect to the public link
    # (preferred for large files; GCS handles it directly)
    return Response(
        content=f"Redirecting to {file_link}",
        media_type="text/plain",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}.zip"',
            "Location": file_link,
        },
        status_code=302,  # Redirect
    )
    # Option B: stream through backend (uncomment if you want proxying)
    # blob_name = file_link.replace(f"https://storage.googleapis.com/{bucket_name}/", "")
    # blob = bucket.blob(blob_name)
    # file_content = BytesIO()
    # blob.download_to_file(file_content)
    # file_content.seek(0)
    # return Response(
    #     file_content.read(),
    #     media_type="application/octet-stream",
    #     headers={"Content-Disposition": f"attachment; filename={filename}"}
    # )

@card_router.get("/card/{card_id}")
def get_card_by_id(card_id: int):
    """
    Fetch a single card's thumbnail_link by CardID.
    Called by the frontend when a card is rendered without a thumbnail.
    """
    try:
        # Use a request-local cursor to avoid cross-request result corruption.
        with conn.cursor() as local_cur:
            local_cur.execute("SELECT Thumbnail_Link FROM Cards WHERE CardID = %s", (card_id,))
            result = local_cur.fetchone()
        if result is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return {"thumbnail_link": result[0]}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[GET CARD] Error fetching card {card_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@card_router.get("/allCards")
def allCards(viewer_email: Optional[str] = None):
    """
    Fetch all cards and their associated data (tags, files, etc.),
    while cleaning up filenames to remove the '.zip' suffix for display.
    If viewer_email is provided, private cards from other users are excluded.
    """
    try:
        connection = get_connection()
        if connection is None:
            raise HTTPException(status_code=503, detail="Database connection unavailable")

        with connection.cursor() as local_cur:
            ensure_polygon_vertex_style_columns(local_cur)
            local_cur.execute("""
            SELECT
                u.Username,
                u.Email,
                COALESCE(c.Name, '') AS Name,
                c.Title,
                c.CardID,
                cat.CategoryLabel,
                COALESCE(c.DatePosted, CURRENT_DATE) AS DatePosted,
                c.Description,
                c.Organization,
                c.Funding,
                c.Link,
                COALESCE(c.LinkText, '') AS LinkText,
                STRING_AGG(DISTINCT t.TagLabel, ', ') AS TagLabels,
                c.Latitude,
                c.Longitude,
                c.Thumbnail_Link,
                COALESCE(c.LocationType, 'point') AS LocationType,
                COALESCE(c.PolygonFillColor, '#0077c0') AS PolygonFillColor,
                COALESCE(c.PolygonLineStyle, 'solid') AS PolygonLineStyle,
                COALESCE(
                    (
                        SELECT json_agg(
                            jsonb_build_object(
                                'imageID', ci.ImageID,
                                'url', ci.ImageURL,
                                'displayOrder', ci.DisplayOrder,
                                'alt', ci.AltText
                            )
                            ORDER BY ci.DisplayOrder ASC, ci.ImageID ASC
                        )
                        FROM CardImages ci
                        WHERE ci.CardID = c.CardID
                    ),
                    '[]'
                ) AS images,
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
                COALESCE(
                    (
                        SELECT json_agg(
                            jsonb_build_object(
                                'lat', pv.Latitude,
                                'lng', pv.Longitude,
                                'ring', COALESCE(pv.RingIndex, 0),
                                'fillColor', COALESCE(pv.FillColor, c.PolygonFillColor, '#0077c0'),
                                'fillOpacity', COALESCE(pv.FillOpacity, 0.2),
                                'lineStyle', COALESCE(pv.LineStyle, c.PolygonLineStyle, 'solid')
                            )
                            ORDER BY COALESCE(pv.RingIndex, 0) ASC, pv.VertexOrder ASC
                        )
                        FROM CardPolygonVertices pv
                        WHERE pv.CardID = c.CardID
                    ),
                    '[]'
                ) AS polygon_vertices,
                COALESCE(c.is_public, TRUE) AS is_public
            FROM Cards c
            INNER JOIN Categories cat ON c.CategoryID = cat.CategoryID
            LEFT JOIN Files f ON c.CardID = f.CardID
            LEFT JOIN CardTags ct ON c.CardID = ct.CardID
            LEFT JOIN Tags t ON ct.TagID = t.TagID
            INNER JOIN Users u ON c.UserID = u.UserID
            WHERE (COALESCE(c.is_public, TRUE) = TRUE OR u.Email = %(viewer_email)s)
            GROUP BY
                c.CardID,
                cat.CategoryLabel,
                u.Username,
                u.Email,
                c.Name
            ORDER BY c.CardID DESC;
        """, {"viewer_email": viewer_email})

            rows = local_cur.fetchall()

        columns = [
            "username", "email", "name", "title", "cardID", "category", "date", "description",
            "org", "funding", "link", "link_text", "tags", "latitude", "longitude", "thumbnail_link",
            "location_type", "polygon_fill_color", "polygon_line_style", "images", "files", "polygon_vertices",
            "is_public"
        ]

        data = [dict(zip(columns, row)) for row in rows]

        # Clean up filenames for display — remove .zip suffix
        for card in data:
            if isinstance(card.get("files"), list):
                for file in card["files"]:
                    if file.get("filename") and file["filename"].lower().endswith(".zip"):
                        file["filename"] = file["filename"][:-4]  # strip ".zip"

        return {"data": data}

    except HTTPException:
        raise
    except Exception as e:
        try:
            connection = get_connection()
            if connection:
                connection.rollback()
        except Exception:
            pass
        print(f"An error occurred while fetching all cards: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    
from .file_utils import compress_file
import tempfile

@card_router.post("/uploadForm")
async def upload_form(
    update: Optional[bool] = Form(False),
    title: str = Form(...),
    email: str = Form(...),
    username: str = Form(...),
    name: str = Form(...),
    original_username: Optional[str] = Form(None),
    original_email: Optional[str] = Form(None),
    original_title: Optional[str] = Form(None),
    requester_email: Optional[str] = Form(None),
    is_public: Optional[str] = Form("true"),
    category: Optional[str] = Form("None"),
    latitude: Optional[str] = Form(None),
    longitude: Optional[str] = Form(None),
    location_type: Optional[str] = Form("point"),
    polygon_coordinates: Optional[str] = Form(None),
    polygon_fill_color: Optional[str] = Form(None),
    polygon_fill_opacity: Optional[str] = Form(None),
    polygon_line_style: Optional[str] = Form(None),
    multipoint_coordinates: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    funding: Optional[str] = Form(None),
    org: Optional[str] = Form(None),
    link: Optional[str] = Form(None),
    link_text: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    files: Optional[list[UploadFile]] = File(None),
    thumbnail: Optional[UploadFile] = File(None),
    thumbnail_link: Optional[str] = Form(None),
    images: Optional[list[UploadFile]] = File(None)
):
    """
    Create or update a Card with metadata, thumbnail, and optional files.
    Ensures uploaded files are compressed, stored in GCS, and recorded in the database.
    """
    enable_commits = False
    print(f"[UPLOAD] username={username}, email={email}, orig_username={original_username or ''}, orig_email={original_email or ''}")
    print(f"[UPLOAD] location_type={location_type}, polygon_fill_color={polygon_fill_color!r}, polygon_line_style={polygon_line_style!r}")
    print(f"[UPLOAD] polygon_coordinates (first 200 chars): {str(polygon_coordinates)[:200] if polygon_coordinates else 'None'}")
    ensure_polygon_vertex_style_columns(cur)

    try:
        # --------------------------------------------------
        # Determine next CardID
        # --------------------------------------------------
        cur.execute("SELECT MAX(CardID) FROM Cards")
        maxcardid = cur.fetchone()
        nextcardid = (maxcardid[0] or 0) + 1

        # --------------------------------------------------
        # Identify user performing the operation
        # --------------------------------------------------
        if update:
            cur.execute(
                "SELECT userID FROM Users WHERE username = %s AND email = %s",
                (original_username, original_email)
            )
        else:
            cur.execute(
                "SELECT userID FROM Users WHERE username = %s AND email = %s",
                (username, email)
            )
        user_row = cur.fetchone()
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")
        userID = user_row[0]

        # --------------------------------------------------
        # Authorization check for updates
        # --------------------------------------------------
        if update and requester_email:
            cur.execute("SELECT Is_Admin FROM Users WHERE Email = %s", (requester_email,))
            req_row = cur.fetchone()
            if req_row is None:
                raise HTTPException(status_code=403, detail="Requester account not found")
            req_is_admin = bool(req_row[0])
            card_owner_email = original_email or email
            if not req_is_admin and requester_email.lower() != card_owner_email.lower():
                raise HTTPException(status_code=403, detail="You do not have permission to edit this card")

        # --------------------------------------------------
        # Map category name to ID
        # --------------------------------------------------
        category_map = {"River": 1, "Watershed": 2, "Places": 3, "None": 4, "Other": 5}
        if category not in category_map:
            raise HTTPException(status_code=400, detail="Invalid category")
        categoryID = category_map[category]

        # --------------------------------------------------
        # Validate inputs
        # --------------------------------------------------
        if len(title) > 255:
            raise HTTPException(status_code=400, detail="Title exceeds 255 characters")

        # For polygon/image overlays, compute centroid from vertices if lat/lng not provided
        if (location_type in ("polygon", "image")) and polygon_coordinates and (not latitude or not longitude):
            try:
                parsed_coords = json.loads(polygon_coordinates)
                # Handle envelope format: { vertices: [...], fillColor, lineStyle }
                if isinstance(parsed_coords, dict) and "vertices" in parsed_coords:
                    verts = parsed_coords["vertices"]
                else:
                    verts = parsed_coords
                if len(verts) >= 3:
                    latitude_val = sum(float(v["lat"]) for v in verts) / len(verts)
                    longitude_val = sum(float(v["lng"]) for v in verts) / len(verts)
                else:
                    raise HTTPException(status_code=400, detail="Polygon must have at least 3 vertices")
            except (json.JSONDecodeError, KeyError):
                raise HTTPException(status_code=400, detail="Invalid polygon_coordinates format")
        elif latitude and longitude:
            try:
                latitude_val = float(latitude)
                longitude_val = float(longitude)
            except ValueError:
                raise HTTPException(status_code=400, detail="Latitude/Longitude must be numeric")
            if not (-90 <= latitude_val <= 90):
                raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90")
            if not (-180 <= longitude_val <= 180):
                raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180")
        else:
            raise HTTPException(status_code=400, detail="Either lat/lng or polygon coordinates are required")

        print(f"[VALIDATED] CardID={nextcardid}, category={categoryID}")

        # --------------------------------------------------
        # Upload thumbnail (custom or default)
        # --------------------------------------------------
        if thumbnail is not None:
            # User uploaded a new file
            thumbnail_url = upload_image(thumbnail)
        elif thumbnail_link:
            # User kept the existing thumbnail
            thumbnail_url = thumbnail_link
        else:
            # No thumbnail provided at all — use default
            thumbnail_url = DEFAULT_THUMBNAIL_URL

        print(f"[THUMBNAIL HANDLING] Using thumbnail URL: {thumbnail_url}")

        # --------------------------------------------------
        # Insert or update card metadata
        # --------------------------------------------------
        enable_commits = False
        if update:
            lookup_title = original_title or title
            cur.execute("""
                SELECT Cards.CardID
                FROM Users
                JOIN Cards ON Users.UserID = Cards.UserID
                WHERE Users.UserID = %s AND Cards.Title = %s
            """, (userID, lookup_title))
            card = cur.fetchone()
            if not card:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        "Card not found for update. If you changed the Title, "
                        "the original card could not be located."
                    )
                )

            nextcardid = card[0]

            if original_username and username != original_username:
                cur.execute("SELECT UserID FROM Users WHERE username = %s AND email = %s", (username, email))
                new_user = cur.fetchone()
                if not new_user:
                    raise HTTPException(
                        status_code=404,
                        detail="Card Creator username does not exist. Please enter a valid existing username."
                    )
                userID = new_user[0]

            cur.execute("""
                UPDATE Cards
                SET Name=%s, Latitude=%s, Longitude=%s, CategoryID=%s,
                    Description=%s, Organization=%s, Funding=%s, Link=%s, LinkText=%s,
                    Thumbnail_Link=COALESCE(%s, Thumbnail_Link), UserID=%s,
                    LocationType=%s, PolygonFillColor=%s, PolygonLineStyle=%s,
                    is_public=%s
                WHERE CardID=%s
            """, (name, latitude_val, longitude_val, categoryID, description, org,
                  funding, link, link_text, thumbnail_url, userID, location_type or "point",
                  polygon_fill_color or '#0077c0', polygon_line_style or 'solid',
                  (is_public or 'true').lower() != 'false', nextcardid))
            cur.execute("DELETE FROM CardTags WHERE CardID=%s", (nextcardid,))
            # Delete old polygon vertices on update
            cur.execute("DELETE FROM CardPolygonVertices WHERE CardID=%s", (nextcardid,))
        else:
            cur.execute("""
                INSERT INTO Cards
                    (CardID, UserID, Name, Title, Latitude, Longitude, CategoryID,
                     Description, Organization, Funding, Link, LinkText, Thumbnail_Link, LocationType,
                     PolygonFillColor, PolygonLineStyle, is_public)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (nextcardid, userID, name, title, latitude_val, longitude_val,
                  categoryID, description, org, funding, link, link_text, thumbnail_url, location_type or "point",
                  polygon_fill_color or '#0077c0', polygon_line_style or 'solid',
                  (is_public or 'true').lower() != 'false'))

        # --------------------------------------------------
        # Handle overlay vertices (polygon/image)
        # --------------------------------------------------
        if location_type in ("polygon", "image") and polygon_coordinates:
            try:
                parsed = json.loads(polygon_coordinates)
                ring_styles = []
                # Support new envelope format: { vertices: [...], fillColor, lineStyle }
                # Extract style from JSON envelope when Form params are missing/default
                if isinstance(parsed, dict):
                    if not polygon_fill_color and parsed.get("fillColor"):
                        polygon_fill_color = parsed["fillColor"]
                    if not polygon_fill_opacity and parsed.get("fillOpacity") is not None:
                        polygon_fill_opacity = str(parsed["fillOpacity"])
                    if not polygon_line_style and parsed.get("lineStyle"):
                        polygon_line_style = parsed["lineStyle"]
                    if isinstance(parsed.get("ringStyles"), list):
                        ring_styles = parsed["ringStyles"]

                # Determine rings: new multi-ring format {rings: [[{lat,lng},...], ...]} or
                # legacy single-ring format {vertices: [{lat,lng},...]} or plain array
                if isinstance(parsed, dict) and "rings" in parsed:
                    rings = parsed["rings"]  # list of rings (each ring = list of vertices)
                elif isinstance(parsed, dict) and "vertices" in parsed:
                    rings = [parsed["vertices"]]  # single ring
                elif isinstance(parsed, list):
                    rings = [parsed]  # legacy plain array
                else:
                    rings = []

                if not polygon_fill_color and ring_styles and isinstance(ring_styles[0], dict):
                    polygon_fill_color = ring_styles[0].get("fillColor") or polygon_fill_color
                if not polygon_line_style and ring_styles and isinstance(ring_styles[0], dict):
                    polygon_line_style = ring_styles[0].get("lineStyle") or polygon_line_style

                minimum_vertices = 4 if location_type == "image" else 3
                # For polygon: require at least one ring with enough vertices
                all_vertices_flat = [v for ring in rings for v in ring]
                if not rings or len(all_vertices_flat) < minimum_vertices:
                    raise HTTPException(
                        status_code=400,
                        detail="Image overlay must have 4 vertices" if location_type == "image" else "Polygon must have at least 3 vertices"
                    )

                # Re-run UPDATE with the (possibly corrected) style values
                cur.execute("""
                    UPDATE Cards SET PolygonFillColor=%s, PolygonLineStyle=%s WHERE CardID=%s
                """, (polygon_fill_color or '#0077c0', polygon_line_style or 'solid', nextcardid))

                total_inserted = 0
                for ring_idx, ring in enumerate(rings):
                    ring_style = ring_styles[ring_idx] if ring_idx < len(ring_styles) and isinstance(ring_styles[ring_idx], dict) else {}
                    ring_fill_color = ring_style.get("fillColor") or polygon_fill_color or '#0077c0'
                    ring_line_style = ring_style.get("lineStyle") or polygon_line_style or 'solid'
                    ring_fill_opacity_raw = ring_style.get("fillOpacity", polygon_fill_opacity)
                    try:
                        ring_fill_opacity = float(ring_fill_opacity_raw) if ring_fill_opacity_raw is not None else 0.2
                    except (TypeError, ValueError):
                        ring_fill_opacity = 0.2
                    for vertex_order, vertex in enumerate(ring):
                        v_lat = float(vertex["lat"])
                        v_lng = float(vertex["lng"])
                        if not (-90 <= v_lat <= 90) or not (-180 <= v_lng <= 180):
                            raise HTTPException(status_code=400, detail=f"Vertex {vertex_order} in ring {ring_idx} has invalid coordinates")
                        cur.execute(
                            """
                            INSERT INTO CardPolygonVertices
                                (CardID, RingIndex, VertexOrder, Latitude, Longitude, FillColor, FillOpacity, LineStyle)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (nextcardid, ring_idx, vertex_order, v_lat, v_lng, ring_fill_color, ring_fill_opacity, ring_line_style)
                        )
                        total_inserted += 1
                print(f"[DB] Polygon vertices inserted: {total_inserted} points in {len(rings)} ring(s), fillColor={polygon_fill_color}, lineStyle={polygon_line_style}")
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid polygon_coordinates JSON format")

        # --------------------------------------------------
        # Handle multi-point cards (multiple markers, optional per-point icon)
        # --------------------------------------------------
        if location_type == "multipoint" and multipoint_coordinates:
            try:
                parsed_points = json.loads(multipoint_coordinates)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid multipoint_coordinates JSON format")

            if isinstance(parsed_points, dict) and isinstance(parsed_points.get("points"), list):
                parsed_points = parsed_points["points"]
            if not isinstance(parsed_points, list) or len(parsed_points) < 1:
                raise HTTPException(status_code=400, detail="Multi-point card must have at least one point")

            mp_inserted = 0
            for point_order, point in enumerate(parsed_points):
                p_lat = float(point["lat"])
                p_lng = float(point["lng"])
                if not (-90 <= p_lat <= 90) or not (-180 <= p_lng <= 180):
                    raise HTTPException(status_code=400, detail=f"Point {point_order} has invalid coordinates")
                p_icon = point.get("icon") if isinstance(point, dict) else None
                if isinstance(p_icon, str):
                    p_icon = p_icon[:60]
                cur.execute(
                    """
                    INSERT INTO CardPolygonVertices
                        (CardID, RingIndex, VertexOrder, Latitude, Longitude, Icon)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (nextcardid, 0, point_order, p_lat, p_lng, p_icon)
                )
                mp_inserted += 1
            print(f"[DB] Multi-point markers inserted: {mp_inserted} points")

        print("[DB] Card record inserted/updated")
        enable_commits = True

        # --------------------------------------------------
        # Handle Tags
        # --------------------------------------------------
        if tags:
            user_tags = [tag.strip() for tag in tags.split(",") if tag.strip()]
            cur.execute("SELECT TagLabel FROM Tags")
            all_tag_list = cur.fetchall()
            master_tags = set(tag[0] for tag in all_tag_list)
            new_tags = list(set(user_tags) - master_tags)
            existing_tags = list(set(user_tags) & master_tags)

            if new_tags:
                cur.execute("SELECT MAX(TagID) FROM Tags")
                maxtagid = cur.fetchone()
                start_id = (maxtagid[0] or 0) + 1
                new_tag_ids = [start_id + i for i in range(len(new_tags))]
                cur.executemany("INSERT INTO Tags (TagID, TagLabel) VALUES (%s, %s)",
                                list(zip(new_tag_ids, new_tags)))
                cur.executemany("INSERT INTO CardTags (CardID, TagID) VALUES (%s, %s)",
                                [(nextcardid, tag_id) for tag_id in new_tag_ids])

            if existing_tags:
                cur.execute("SELECT TagID FROM Tags WHERE TagLabel IN %s", (tuple(existing_tags),))
                results = cur.fetchall()
                cur.executemany("INSERT INTO CardTags (CardID, TagID) VALUES (%s, %s)",
                                [(nextcardid, tag_id[0]) for tag_id in results])

            print("[DB] Tags processed successfully")

        # --------------------------------------------------
        # Handle file uploads (compress → upload → record)
        # --------------------------------------------------
        if files:
            print("[FILES] Beginning upload process...")
            for file in files:
                try:
                    with tempfile.NamedTemporaryFile(delete=False) as tmp:
                        file.file.seek(0)
                        tmp.write(file.file.read())
                        tmp_path = tmp.name

                    zip_path = compress_file(tmp_path, original_name=file.filename)
                    zip_filename = os.path.basename(zip_path)
                    filesizeNEW = os.path.getsize(zip_path)

                    cur.execute("SELECT MAX(FileID) FROM Files")
                    maxFileid = cur.fetchone()
                    nextfileid = (maxFileid[0] or 0) + 1

                    safe_filename = os.path.splitext(os.path.basename(file.filename))[0]
                    destination_path = f"files/{username}/{safe_filename}.zip"

                    print(f"[UPLOAD] Uploading compressed file {zip_filename} → {destination_path}")
                    upload_ok = upload_to_bucket(destination_path, zip_path, "application/zip", bucket_name)
                    if not upload_ok:
                        raise Exception("Upload to GCS failed")

                    public_url = f"https://storage.googleapis.com/{bucket_name}/{destination_path}"

                    cur.execute(
                        'INSERT INTO Files (fileid, CardID, filename, file_link, filesize, fileextension) '
                        'VALUES (%s, %s, %s, %s, %s, %s)',
                        (nextfileid, nextcardid, safe_filename, public_url, filesizeNEW, ".zip")
                    )

                    print(f"[DB] File record added: {safe_filename}")
                    enable_commits = True

                except Exception as e:
                    conn.rollback()
                    print(f"[FILE ERROR] {e}")
                    raise HTTPException(status_code=500, detail=f"File upload failed: {e}")
                finally:
                    for path in [tmp_path, zip_path]:
                        if os.path.exists(path):
                            os.remove(path)
            print("[FILES] Upload process complete.")

        # --------------------------------------------------
        # Final commit
        # --------------------------------------------------
        if enable_commits:
            conn.commit()
            print("[COMMIT] All changes committed successfully")

        # --------------------------------------------------
        # Populate CardImages for newly created cards
        # --------------------------------------------------
        if not update and location_type == "image":
            try:
                from endpoint_files.images import save_uploaded_file as _save_img
                if images:
                    for idx, img_file in enumerate(images):
                        try:
                            img_url = _save_img(img_file, require_gcs=True)
                            cur.execute(
                                "INSERT INTO CardImages (CardID, ImageURL, DisplayOrder, AltText) VALUES (%s, %s, %s, '')",
                                (nextcardid, img_url, idx)
                            )
                        except Exception as img_err:
                            print(f"[IMAGE] Failed to upload image at index {idx}: {img_err}")
                conn.commit()
                print(f"[IMAGES] Inserted gallery CardImages for new image-overlay card {nextcardid}")
            except Exception as img_err:
                print(f"[IMAGE] Failed to insert CardImages: {img_err}")
                try:
                    conn.rollback()
                except Exception:
                    pass
        elif not update and thumbnail_url != DEFAULT_THUMBNAIL_URL:
            try:
                from endpoint_files.images import save_uploaded_file as _save_img
                # Use the already-uploaded thumbnail as the first gallery image
                cur.execute(
                    "INSERT INTO CardImages (CardID, ImageURL, DisplayOrder, AltText) VALUES (%s, %s, 0, '')",
                    (nextcardid, thumbnail_url)
                )
                # Upload and insert any additional images (index 1+ since index 0 == thumbnail)
                if images and len(images) > 1:
                    for idx, img_file in enumerate(images[1:], start=1):
                        try:
                            img_url = _save_img(img_file, require_gcs=True)
                            cur.execute(
                                "INSERT INTO CardImages (CardID, ImageURL, DisplayOrder, AltText) VALUES (%s, %s, %s, '')",
                                (nextcardid, img_url, idx)
                            )
                        except Exception as img_err:
                            print(f"[IMAGE] Failed to upload image at index {idx}: {img_err}")
                conn.commit()
                print(f"[IMAGES] Inserted CardImages for new card {nextcardid}")
            except Exception as img_err:
                print(f"[IMAGE] Failed to insert CardImages: {img_err}")
                try:
                    conn.rollback()
                except Exception:
                    pass

        return {"message": "Card uploaded successfully", "card_id": nextcardid}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        print(f"[UPLOADFORM ERROR] {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            conn.rollback()
        except:
            pass

# New API's to support edit card funtions for thumbnails and for attached files

# ------------------------------------------------------------
# DEPRECATED LOCAL FS EXAMPLES (kept for reference)
# ------------------------------------------------------------
"""
# THESE TWO ENDPOINTS UPLOAD AND DOWNLOAD ARE MADE FOR WHEN THE BACKEND HAS A LOCAL FILE SYSTEM TO USE. 
# WE HAVE SWITCHED TO USE A CLOUD SERVICE TO STORE OUR FILES SO THESE ARE NOW DEPRICATED

@card_router.post("/uploadFile")
async def uploadFile(file: UploadFile = File(...)):
    #Im using os.path.join to make it cross-platform compatible
    #This will use the correct path separator for the platform as well 
    pc_folder_path = os.path.dirname(os.path.abspath(__file__))
    innerfolder = "savedFiles"
    folder_path = os.path.join(pc_folder_path, innerfolder)
    print(pc_folder_path, folder_path, innerfolder)

    #Makes sure the file name and extension are formatted correctly
    file_name, file_ext = file.filename.split(".")

    #folder_path = "savedfiles"  # Specifies the folder where I want to save the files
    os.makedirs(folder_path, exist_ok=True)  # Creates the folder if it doesn't exist
    file_path = os.path.join(folder_path, f"{file_name}.{file_ext}")
    
    print(file_path)
    #Should probably write to folder in chunks for larger files but that will come in time
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    return {"success": True, "file path": file_path, "message": "File Uploaded Successfully"}

Im working on implementing google cloud storage functionality to fastAPI backend endpoints. One endpoint I have is called download_file. I want this endpoint to retieve the file from my google cloud bucket and send it to the user to download on my react frontend. I have inlcuded my endpoint that I want you to work off of, this endpoint downloadFile current downloads the selected file to the users local file system and the google cloud code that I have that can retirieve files from my bucket. The issue Im having is that my current google cloud code only works with local files systems. I need you to adjust this code to work with my fastAPI endpoint.

@card_router.get("/downloadFile")
async def downloadFile(fileTitle: str):
    #Im using os.path.join to make it cross-platform compatible
    #This will use the correct path separator for the platform as well 
    folder_path = os.path.dirname(os.path.abspath(__file__))
    innerfolder = "savedFiles/"
    file_path = os.path.join(folder_path, innerfolder, fileTitle)
    #print(folder_path, innerfolder)
    #print(file_path)
    if os.path.exists(file_path):
        return FileResponse(file_path)
    return {"error": "File doesn't exist"}
"""