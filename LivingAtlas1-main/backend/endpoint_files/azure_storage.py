"""
Azure Blob Storage helpers — replaces GCS for card image / thumbnail / file storage.

Requires AZURE_STORAGE_CONNECTION_STRING (set in backend/.env or Render env vars).
Blobs are stored in a single public container (default "images"), keeping GCS-like
relative paths (card_images/, thumbnails/, files/).
"""
import os
import re
from urllib.parse import urlparse

AZURE_CONTAINER = os.environ.get("AZURE_CONTAINER", "images")
BLOB_HOST_SUFFIX = ".blob.core.windows.net"


def get_connection_string() -> str:
    conn = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
    if not conn:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is not set.")
    return conn


def get_account_name() -> str:
    """Account name from the connection string, falling back to AZURE_ACCOUNT / default."""
    conn = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "")
    m = re.search(r"AccountName=([^;]+)", conn)
    if m:
        return m.group(1).strip()
    return os.environ.get("AZURE_ACCOUNT", "livingatlasimages")


def build_url(blob_name: str, container: str = AZURE_CONTAINER) -> str:
    """Construct the public URL for a blob (no SDK call / no credentials required)."""
    return f"https://{get_account_name()}.blob.core.windows.net/{container}/{blob_name}"


def is_azure_url(url: str) -> bool:
    return bool(url) and BLOB_HOST_SUFFIX in url


def _container_client(container: str = AZURE_CONTAINER):
    from azure.storage.blob import BlobServiceClient
    return BlobServiceClient.from_connection_string(get_connection_string()).get_container_client(container)


def upload_bytes(blob_name: str, data: bytes,
                 content_type: str = "application/octet-stream",
                 container: str = AZURE_CONTAINER) -> str:
    """Upload bytes to Azure Blob Storage and return the blob's public URL."""
    from azure.storage.blob import ContentSettings
    _container_client(container).upload_blob(
        blob_name,
        data,
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type),
    )
    return build_url(blob_name, container)


def delete_blob(blob_name: str, container: str = AZURE_CONTAINER) -> None:
    """Delete a blob by name from the given container."""
    _container_client(container).delete_blob(blob_name)


def delete_from_url(url: str) -> None:
    """Delete a blob given its full Azure URL. No-op for non-Azure URLs."""
    if not is_azure_url(url):
        return
    parts = urlparse(url).path.lstrip("/").split("/", 1)
    if len(parts) != 2:
        return
    container, blob_name = parts
    _container_client(container).delete_blob(blob_name)
