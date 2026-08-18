"""
Endpoint for multi-image support
Provides APIs to manage images in the CardImages table
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Form, Body
from fastapi.responses import Response
from database import conn, cur
from typing import Optional
import os
import uuid
import datetime
import base64
import tempfile
import requests as _requests
from pathlib import Path
from . import azure_storage

images_router = APIRouter()

# Configure image storage directory (used as local fallback only)
IMAGE_UPLOAD_DIR = "uploads/card_images"
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
# GCS_BUCKET_NAME = "cereo_atlas_storage"   # (GCS legacy — storage moved to Azure)
GCS_IMAGE_FOLDER = "card_images"           # folder prefix inside the Azure container


# ---- OLD GCS client helper (commented out — storage moved to Azure Blob) ----
# def _get_gcs_client():
#     """
#     Return a GCS storage client if credentials are available, else None.
#     """
#     try:
#         from google.cloud import storage as gcs
#
#         gcs_b64 = os.environ.get("GOOGLE_CREDENTIALS_BASE64")
#         if gcs_b64:
#             key_bytes = base64.b64decode(gcs_b64)
#             tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
#             tmp.write(key_bytes)
#             tmp.flush()
#             tmp.close()
#             os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tmp.name
#             return gcs.Client()
#
#         existing_credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
#         if existing_credentials_path and os.path.exists(existing_credentials_path):
#             return gcs.Client()
#
#         backend_root = os.path.dirname(os.path.dirname(__file__))
#         candidate_keys = [
#             os.path.join(os.path.dirname(__file__), "ServiceKey_GoogleCloud.json"),
#             os.path.join(backend_root, "ServiceKey_GoogleCloud.json"),
#             os.path.join(os.getcwd(), "ServiceKey_GoogleCloud.json"),
#         ]
#
#         for candidate in candidate_keys:
#             if os.path.exists(candidate):
#                 os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = candidate
#                 return gcs.Client()
#
#     except Exception as e:
#         print(f"[images] Unable to initialize GCS client: {e}")
#
#     return None


def ensure_upload_dir():
    """Ensure local upload directory exists"""
    Path(IMAGE_UPLOAD_DIR).mkdir(parents=True, exist_ok=True)


def allowed_file(filename: str) -> bool:
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def save_uploaded_file(file: UploadFile, require_gcs: bool = True) -> str:
    """
    Save uploaded file to Azure Blob Storage and return its public URL.
    (require_gcs is a legacy parameter kept for call-site compatibility; storage
    is now Azure, and upload failures always raise.)
    """
    if not allowed_file(file.filename):
        raise HTTPException(status_code=400, detail="File type not allowed")

    content = file.file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large")

    timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    file_ext = file.filename.rsplit('.', 1)[1].lower()
    unique_filename = f"{uuid.uuid4().hex}_{timestamp}.{file_ext}"
    content_type = f"image/{file_ext}" if file_ext != 'jpg' else "image/jpeg"

    # Azure Blob Storage upload (primary storage)
    blob_name = f"{GCS_IMAGE_FOLDER}/{unique_filename}"
    try:
        return azure_storage.upload_bytes(blob_name, content, content_type)
    except HTTPException:
        raise
    except Exception as az_err:
        raise HTTPException(status_code=500, detail=f"Azure upload failed: {az_err}")

    # ---- OLD GCS / local upload (commented out — storage moved to Azure) ----
    # gcs_client = _get_gcs_client()
    # if gcs_client is not None:
    #     try:
    #         bucket = gcs_client.bucket(GCS_BUCKET_NAME)
    #         blob_name = f"{GCS_IMAGE_FOLDER}/{unique_filename}"
    #         blob = bucket.blob(blob_name)
    #         content_type = f"image/{file_ext}" if file_ext != 'jpg' else "image/jpeg"
    #         blob.upload_from_string(content, content_type=content_type)
    #         return blob.public_url
    #     except Exception as gcs_err:
    #         if require_gcs:
    #             raise HTTPException(status_code=500, detail=f"GCS upload failed: {gcs_err}")
    #         print(f"[images] GCS upload failed, falling back to local storage: {gcs_err}")
    #
    # if require_gcs:
    #     raise HTTPException(status_code=500, detail="Image upload requires GCS credentials.")
    #
    # ensure_upload_dir()
    # filepath = os.path.join(IMAGE_UPLOAD_DIR, unique_filename)
    # with open(filepath, 'wb') as f:
    #     f.write(content)
    # return f"/uploads/card_images/{unique_filename}"


def _should_sync_thumbnail_with_gallery(card_id: int) -> bool:
    cur.execute("SELECT COALESCE(LocationType, 'point') FROM Cards WHERE CardID = %s", (card_id,))
    row = cur.fetchone()
    return not row or row[0] != 'image'

@images_router.post("/uploadCardImage")
async def upload_card_image(
    cardID: int = Form(...),
    altText: str = Form(default=""),
    image: UploadFile = File(...)
):
    """
    Upload a new image for a card
    
    Args:
        cardID: Card ID
        altText: Alternative text for the image
        image: Image file
    
    Returns:
        Created image record with ImageID and ImageURL
    """
    try:
        # Verify card exists
        cur.execute("SELECT CardID FROM Cards WHERE CardID = %s", (cardID,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Card not found")
        
        # Save file (persistent GCS storage required)
        image_url = save_uploaded_file(image, require_gcs=True)
        
        # Get next display order
        cur.execute(
            "SELECT COALESCE(MAX(DisplayOrder), -1) FROM CardImages WHERE CardID = %s",
            (cardID,)
        )
        next_order = cur.fetchone()[0] + 1
        
        # Insert into CardImages
        cur.execute("""
            INSERT INTO CardImages (CardID, ImageURL, DisplayOrder, AltText)
            VALUES (%s, %s, %s, %s)
            RETURNING ImageID
        """, (cardID, image_url, next_order, altText))
        
        image_id = cur.fetchone()[0]

        if _should_sync_thumbnail_with_gallery(cardID):
            # Keep legacy thumbnail field in sync for list/map endpoints that still read Cards.Thumbnail_Link
            cur.execute(
                "UPDATE Cards SET Thumbnail_Link = %s WHERE CardID = %s",
                (image_url, cardID)
            )
        conn.commit()
        
        return {
            "success": True,
            "imageID": image_id,
            "imageURL": image_url,
            "displayOrder": next_order,
            "altText": altText
        }
    
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@images_router.post("/uploadCardImages")
async def upload_card_images(
    cardID: int = Form(...),
    altTexts: Optional[str] = Form(None),
    images: list[UploadFile] = File(...)
):
    """
    Upload multiple images for a card in one request.

    Args:
        cardID: Card ID
        altTexts: Optional delimiter-separated alt text values ("||" delimiter)
        images: List of image files

    Returns:
        Created image records with ImageID and ImageURL
    """
    try:
        if not images:
            raise HTTPException(status_code=400, detail="No images provided")

        cur.execute("SELECT CardID FROM Cards WHERE CardID = %s", (cardID,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Card not found")

        alt_text_values = []
        if altTexts:
            alt_text_values = [text.strip() for text in altTexts.split("||")]

        cur.execute(
            "SELECT COALESCE(MAX(DisplayOrder), -1) FROM CardImages WHERE CardID = %s",
            (cardID,)
        )
        next_order = cur.fetchone()[0] + 1

        created_images = []
        for index, image in enumerate(images):
            image_url = save_uploaded_file(image, require_gcs=True)
            alt_text = alt_text_values[index] if index < len(alt_text_values) else ""

            cur.execute(
                """
                INSERT INTO CardImages (CardID, ImageURL, DisplayOrder, AltText)
                VALUES (%s, %s, %s, %s)
                RETURNING ImageID
                """,
                (cardID, image_url, next_order + index, alt_text)
            )
            image_id = cur.fetchone()[0]

            created_images.append({
                "imageID": image_id,
                "imageURL": image_url,
                "displayOrder": next_order + index,
                "altText": alt_text
            })

        if created_images and _should_sync_thumbnail_with_gallery(cardID):
            # Keep legacy thumbnail in sync to first newly uploaded image
            cur.execute(
                "UPDATE Cards SET Thumbnail_Link = %s WHERE CardID = %s",
                (created_images[0]["imageURL"], cardID)
            )
        conn.commit()

        return {
            "success": True,
            "cardID": cardID,
            "images": created_images
        }

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Batch upload failed: {str(e)}")


@images_router.delete("/deleteCardImage/{imageID}")
async def delete_card_image(imageID: int):
    """
    Delete an image by ID
    
    Args:
        imageID: Image ID to delete
    
    Returns:
        Success confirmation
    """
    try:
        # Get image details
        cur.execute("SELECT ImageURL, CardID FROM CardImages WHERE ImageID = %s", (imageID,))
        result = cur.fetchone()
        
        if not result:
            raise HTTPException(status_code=404, detail="Image not found")
        
        image_url, card_id = result
        
        # Delete from database
        cur.execute("DELETE FROM CardImages WHERE ImageID = %s", (imageID,))
        
        # Delete the backing file from Azure Blob Storage (non-fatal on failure)
        try:
            azure_storage.delete_from_url(image_url)
        except Exception as az_err:
            print(f"[images] Azure delete failed (non-fatal): {az_err}")

        # ---- OLD GCS / local delete (commented out — storage moved to Azure) ----
        # if image_url.startswith('https://storage.googleapis.com/'):
        #     try:
        #         gcs_client = _get_gcs_client()
        #         if gcs_client is not None:
        #             blob_name = '/'.join(image_url.split(f"/{GCS_BUCKET_NAME}/")[1:])
        #             gcs_client.bucket(GCS_BUCKET_NAME).blob(blob_name).delete()
        #     except Exception as gcs_err:
        #         print(f"[images] GCS delete failed (non-fatal): {gcs_err}")
        # elif image_url.startswith('/uploads/card_images/'):
        #     filepath = image_url.lstrip('/')
        #     if os.path.exists(filepath):
        #         os.remove(filepath)
        
        # Reorder remaining images
        cur.execute("""
            SELECT ImageID FROM CardImages 
            WHERE CardID = %s 
            ORDER BY DisplayOrder, ImageID
        """, (card_id,))        
        remaining_images = cur.fetchall()
        for idx, (img_id,) in enumerate(remaining_images):
            cur.execute(
                "UPDATE CardImages SET DisplayOrder = %s WHERE ImageID = %s",
                (idx, img_id)
            )

        if _should_sync_thumbnail_with_gallery(card_id):
            # After delete, reset thumbnail to first remaining image or default logo.
            cur.execute(
                """
                SELECT ImageURL
                FROM CardImages
                WHERE CardID = %s
                ORDER BY DisplayOrder ASC, ImageID ASC
                LIMIT 1
                """,
                (card_id,)
            )
            first_image = cur.fetchone()
            next_thumbnail = first_image[0] if first_image else "/CEREO-logo.png"
            cur.execute(
                "UPDATE Cards SET Thumbnail_Link = %s WHERE CardID = %s",
                (next_thumbnail, card_id)
            )
        
        conn.commit()
        
        return {
            "success": True,
            "deleteImageID": imageID,
            "cardID": card_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")

@images_router.put("/reorderCardImages")
async def reorder_card_images(cardID: int, imageOrder: list = Body(...)):
    """
    Reorder images for a card
    
    Args:
        cardID: Card ID (query parameter)
        imageOrder: List of ImageIDs in desired order (request body)
    
    Returns:
        Updated order confirmation
    """
    try:
        # Verify all images belong to this card
        placeholders = ','.join(['%s'] * len(imageOrder))
        cur.execute(f"""
            SELECT COUNT(*) FROM CardImages 
            WHERE CardID = %s AND ImageID = ANY(ARRAY[{placeholders}])
        """, [cardID] + imageOrder)
        
        if cur.fetchone()[0] != len(imageOrder):
            raise HTTPException(status_code=400, detail="Invalid image IDs for this card")
        
        # Update display order
        for display_idx, image_id in enumerate(imageOrder):
            cur.execute(
                "UPDATE CardImages SET DisplayOrder = %s WHERE ImageID = %s",
                (display_idx, image_id)
            )
        
        conn.commit()
        
        return {
            "success": True,
            "cardID": cardID,
            "newOrder": imageOrder
        }
    
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Reorder failed: {str(e)}")

@images_router.get("/cardImages/{cardID}")
async def get_card_images(cardID: int):
    """
    Get all images for a card
    
    Args:
        cardID: Card ID
    
    Returns:
        List of images sorted by DisplayOrder
    """
    try:
        cur.execute("""
            SELECT ImageID, ImageURL, DisplayOrder, AltText, DateAdded
            FROM CardImages
            WHERE CardID = %s
            ORDER BY DisplayOrder ASC
        """, (cardID,))
        
        rows = cur.fetchall()
        images = [
            {
                "imageID": row[0],
                "url": row[1],
                "displayOrder": row[2],
                "alt": row[3],
                "dateAdded": str(row[4]) if row[4] else None
            }
            for row in rows
        ]
        
        return {
            "cardID": cardID,
            "totalImages": len(images),
            "images": images
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


_MIME_MAP = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
}


@images_router.get("/cardImageProxy/{image_id}")
async def proxy_card_image(image_id: int):
    """Fetch a card image by ID and return its bytes, bypassing client CORS restrictions."""
    cur.execute("SELECT ImageURL FROM CardImages WHERE ImageID = %s", (image_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Image not found")

    image_url = row[0]

    if image_url.startswith("http://") or image_url.startswith("https://"):
        try:
            resp = _requests.get(image_url, timeout=15)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]
            return Response(content=resp.content, media_type=content_type)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to fetch image: {e}")
    else:
        filepath = image_url.lstrip("/")
        if not os.path.exists(filepath):
            raise HTTPException(status_code=404, detail="Image file not found")
        ext = filepath.rsplit(".", 1)[-1].lower()
        content_type = _MIME_MAP.get(ext, "image/jpeg")
        with open(filepath, "rb") as f:
            return Response(content=f.read(), media_type=content_type)


@images_router.get("/imageUrlProxy")
async def proxy_image_by_url(url: str):
    """Fetch an image from an arbitrary URL and return its bytes, bypassing client CORS restrictions."""
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="Invalid or missing url parameter")
    try:
        resp = _requests.get(url, timeout=15)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0]
        return Response(content=resp.content, media_type=content_type)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch image: {e}")
