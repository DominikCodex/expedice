from unittest.mock import MagicMock

import pytest

import app


@pytest.fixture
def image_cache(monkeypatch):
    cache = {**app.PRODUCT_IMAGE_CACHE, "images": {}, "signature": "", "loadedAt": 0}
    monkeypatch.setattr(app, "PRODUCT_IMAGE_CACHE", cache)
    monkeypatch.setattr(app.time, "sleep", MagicMock())
    return cache


def test_cold_start_retries_settings_and_embeds_images(monkeypatch, image_cache):
    settings = {"productFeed": {"url": "https://example.invalid/feed.csv"}}
    read = MagicMock(side_effect=[app.psycopg2.OperationalError("private-host"), settings])
    monkeypatch.setattr(app, "read_settings", read)
    feed = MagicMock(return_value={
        "images": {"SKU": "https://example.invalid/photo.jpg"}, "loadedAt": app.time.time(),
        "rowsSeen": 1, "bytesRead": 100, "imageColumns": ["image"],
    })
    monkeypatch.setattr(app, "parse_product_image_feed", feed)
    response = app.app.test_client().post("/api/warehouse/render-print", json={"rows": [{
        "productCode": "P", "variantCode": "SKU", "quantity": "1", "sequence": "1x1",
    }]})
    assert response.status_code == 200
    assert "https://example.invalid/photo.jpg" in response.text
    assert read.call_count == 2
    feed.assert_called_once()
    app.time.sleep.assert_called_once_with(1)
    read.side_effect = None
    read.return_value = settings
    assert app.product_image_cache()["images"] == image_cache["images"]
    feed.assert_called_once()


@pytest.mark.parametrize("error", [app.psycopg2.OperationalError, app.psycopg2.InterfaceError])
def test_settings_outage_uses_last_successful_images(monkeypatch, image_cache, error):
    image_cache.update(images={"SKU": "https://example.invalid/photo.jpg"}, signature="old")
    monkeypatch.setattr(app, "read_settings", MagicMock(side_effect=error("private-host")))
    feed = MagicMock()
    monkeypatch.setattr(app, "parse_product_image_feed", feed)
    result = app.product_image_cache()
    assert result["images"] == image_cache["images"]
    assert result["configured"] and result["stale"]
    feed.assert_not_called()
    app.time.sleep.assert_not_called()


def test_cold_start_failure_has_bounded_retries(monkeypatch, image_cache):
    read = MagicMock(side_effect=app.psycopg2.OperationalError("private-host"))
    monkeypatch.setattr(app, "read_settings", read)
    with pytest.raises(app.ProductFeedError, match="dočasně nedostupné"):
        app.product_image_cache()
    assert read.call_count == 4
    assert [call.args[0] for call in app.time.sleep.call_args_list] == [1, 2, 4]
    assert image_cache["images"] == {}


def test_disabled_feed_does_not_reuse_old_images(monkeypatch, image_cache):
    image_cache["images"] = {"SKU": "https://example.invalid/photo.jpg"}
    monkeypatch.setattr(app, "read_settings", lambda **kwargs: {"productFeed": {"url": ""}})
    result = app.product_image_cache()
    assert not result["configured"]
    assert result["images"] == {}
