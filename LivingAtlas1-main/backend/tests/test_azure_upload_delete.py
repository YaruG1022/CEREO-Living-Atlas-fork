"""
Tests for the Azure Blob Storage upload/delete logic used by the backend.

These are INTEGRATION tests: they hit the real Azure storage account using
AZURE_STORAGE_CONNECTION_STRING (read from backend/.env or the environment).
Each test creates a uniquely-named blob and deletes it afterwards, leaving no
trace on Azure.

Run from the backend directory:
    pytest tests/test_azure_upload_delete.py -v
"""
import io
import os
import sys
import uuid

import pytest
import requests

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_ROOT)


def _load_env():
    """Load backend/.env (gitignored) so AZURE_STORAGE_CONNECTION_STRING is available."""
    env_path = os.path.join(BACKEND_ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v


_load_env()

HAS_AZURE = bool(os.environ.get("AZURE_STORAGE_CONNECTION_STRING"))

pytestmark = pytest.mark.skipif(
    not HAS_AZURE,
    reason="AZURE_STORAGE_CONNECTION_STRING not set (see backend/.env)",
)

from endpoint_files import azure_storage
from endpoint_files.card import upload_image
from endpoint_files.images import save_uploaded_file
from starlette.datastructures import Headers, UploadFile


def _unique(prefix: str) -> str:
    return f"{prefix}/{uuid.uuid4().hex}.png"


def _http_get(url: str):
    return requests.get(url, timeout=15)


class TestAzureStorage:
    """Direct tests of the azure_storage helper module."""

    def test_build_url_shape(self):
        url = azure_storage.build_url("card_images/x.png")
        assert url.startswith("https://")
        assert ".blob.core.windows.net/" in url
        assert url.endswith("/images/card_images/x.png")

    def test_upload_get_delete_roundtrip(self):
        blob = _unique("card_images")
        url = azure_storage.upload_bytes(blob, b"hello-azure", "image/png")
        try:
            resp = _http_get(url)
            assert resp.status_code == 200
            assert resp.content == b"hello-azure"
        finally:
            azure_storage.delete_from_url(url)
        # after delete the blob should be gone
        assert _http_get(url).status_code == 404

    def test_delete_blob_by_name(self):
        blob = _unique("thumbnails")
        url = azure_storage.upload_bytes(blob, b"data", "image/png")
        assert _http_get(url).status_code == 200
        azure_storage.delete_blob(blob)
        assert _http_get(url).status_code == 404

    def test_delete_from_url_non_azure_is_noop(self):
        # Non-Azure URLs must be ignored without raising.
        azure_storage.delete_from_url("https://example.com/nope.png")


class TestBackendUpload:
    """Verify the backend upload paths return Azure URLs that are publicly readable."""

    @staticmethod
    def _make_image(name="test.png", data=b"fake-png", content_type="image/png"):
        return UploadFile(
            filename=name,
            file=io.BytesIO(data),
            headers=Headers({"content-type": content_type}),
        )

    def test_save_uploaded_file_returns_azure_url(self):
        url = save_uploaded_file(self._make_image())
        try:
            assert ".blob.core.windows.net/images/card_images/" in url
            assert _http_get(url).status_code == 200
        finally:
            azure_storage.delete_from_url(url)

    def test_card_upload_image_returns_azure_url(self):
        url = upload_image(self._make_image())
        try:
            assert ".blob.core.windows.net/images/thumbnails/" in url
            assert _http_get(url).status_code == 200
        finally:
            azure_storage.delete_from_url(url)
