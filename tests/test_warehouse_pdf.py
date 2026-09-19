import os
from io import BytesIO
from unittest.mock import MagicMock

import pytest

import app
from PIL import Image
from warehouse_pdf import allowed_image_url, thumbnail_jpeg


def payload():
    return {"rows": [{"productCode": "MODEL", "variantCode": "MODEL-SM", "quantity": "2",
                      "sequence": "1x1, 1x2", "info": "České ľô"}]}


def test_pdf_uses_same_template_defaults_without_database_writes(monkeypatch):
    monkeypatch.setattr(app, "product_image_cache", lambda: {"configured": True, "images": {}})
    monkeypatch.setattr(app, "db_conn", MagicMock(side_effect=AssertionError("No database")))
    render = MagicMock(return_value=(b"%PDF-test", 1))
    monkeypatch.setattr(app, "generate_pdf", render)
    response = app.app.test_client().post("/api/warehouse/render-pdf", json=payload())
    assert response.status_code == 200
    assert response.mimetype == "application/pdf"
    assert response.data == b"%PDF-test"
    assert response.headers["X-Warehouse-Missing-Images"] == "1"
    assert response.headers["Cache-Control"] == "no-store"
    html = render.call_args.args[0]
    for field, value in [("orientation", "portrait"), ("density", "compact"), ("priority", "split")]:
        assert f'name="{field}" value="{value}" checked' in html
    assert "warehouse-print-data" in html and "priority-page-start" in html


def test_invalid_pdf_upload_never_launches_browser(monkeypatch):
    render = MagicMock()
    monkeypatch.setattr(app, "generate_pdf", render)
    assert app.app.test_client().post("/api/warehouse/render-pdf", json={}).status_code == 400
    render.assert_not_called()
    assert not app.WAREHOUSE_PDF_LOCK.locked()


def test_pdf_failure_does_not_expose_internal_details_and_releases_lock(monkeypatch):
    monkeypatch.setattr(app, "product_image_cache", lambda: {"images": {}})
    monkeypatch.setattr(app, "generate_pdf", MagicMock(side_effect=RuntimeError("private-details")))
    response = app.app.test_client().post("/api/warehouse/render-pdf", json=payload())
    assert response.status_code == 503
    assert "private-details" not in response.text
    assert not app.WAREHOUSE_PDF_LOCK.locked()


def test_parallel_pdf_requests_do_not_launch_unbounded_browsers(monkeypatch):
    render = MagicMock()
    monkeypatch.setattr(app, "generate_pdf", render)
    with app.WAREHOUSE_PDF_LOCK:
        response = app.app.test_client().post("/api/warehouse/render-pdf", json=payload())
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "5"
    render.assert_not_called()


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "file:///etc/passwd", "https://other.test/a.png",
    "https://cdn.myshoptet.com.evil.test/a", "https://cdn.myshoptet.com:8000/a", "https://user@cdn.myshoptet.com/a",
    "https://cdn.myshoptet.com:bad/a", "data:text/html,test"])
def test_pdf_browser_blocks_unrelated_and_local_resources(url):
    assert not allowed_image_url(url)


def test_pdf_browser_allows_product_cdn_images():
    assert allowed_image_url("https://cdn.myshoptet.com/usr/shop.test/user/shop/detail/a.jpg")


def test_pdf_thumbnail_is_small_and_preserves_proportions():
    source = BytesIO()
    Image.new("RGBA", (1000, 1500), (20, 40, 80, 180)).save(source, format="PNG")
    result = thumbnail_jpeg(source.getvalue())
    with Image.open(BytesIO(result)) as thumbnail:
        assert thumbnail.size == (267, 400)
        assert thumbnail.mode == "RGB"
    assert len(result) < 30000


def test_pdf_rejects_non_image_response():
    with pytest.raises(Exception):
        thumbnail_jpeg(b"<html>Error</html>")


@pytest.mark.skipif(os.environ.get("RUN_PDF_BROWSER_TESTS") != "1", reason="Requires installed Playwright Chromium")
def test_real_pdf_renderer_without_images_or_database(monkeypatch, tmp_path):
    monkeypatch.setattr(app, "product_image_cache", lambda: {"images": {}})
    monkeypatch.setattr(app, "db_conn", MagicMock(side_effect=AssertionError("No database")))
    response = app.app.test_client().post("/api/warehouse/render-pdf", json=payload())
    assert response.status_code == 200, response.text
    assert response.data.startswith(b"%PDF-")
    assert len(response.data) > 10000
    assert response.headers["X-Warehouse-Missing-Images"] == "1"
    (tmp_path / "warehouse.pdf").write_bytes(response.data)
