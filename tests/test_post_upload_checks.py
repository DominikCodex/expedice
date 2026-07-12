from unittest.mock import patch

import pytest

pytest.importorskip("psycopg2")

import app


def address_data():
    return {
        "streetWithNumber": "Václavské náměstí 1",
        "street": "Václavské náměstí",
        "houseNumber": "1",
        "city": "Praha",
        "zipCode": "11000",
        "country": "CZ",
    }


def mapy_item(name="Václavské náměstí 1"):
    return {
        "type": "regional.address",
        "name": name,
        "location": "110 00 Praha, Česko",
        "zip": "11000",
        "regionalStructure": [{"name": "Praha"}],
    }


def test_automation_settings_default_to_enabled():
    assert app.normalize_automation_settings({}) == {
        "postUploadPaymentCheck": True,
        "postUploadAddressCheck": True,
    }


def test_exact_mapy_match_is_safe_for_automatic_override():
    with patch.object(app, "mapy_lookup_with_retries", return_value=[mapy_item()]):
        result = app.classify_post_upload_address("test-key", address_data())

    assert result["status"] == "verified"
    assert result["valid"] is True
    assert result["safeAddress"]["city"] == "Praha"


def test_ambiguous_mapy_matches_are_only_a_suggestion():
    with patch.object(app, "mapy_lookup_with_retries", return_value=[mapy_item(), mapy_item()]):
        result = app.classify_post_upload_address("test-key", address_data())

    assert result["status"] == "suggestion"
    assert result["valid"] is False
    assert result["safeAddress"] is None
    assert result["suggestedAddress"] is not None


def test_same_normalized_address_uses_one_batch_key():
    first = {**address_data(), "streetWithNumber": "Václavské náměstí 1"}
    second = {**address_data(), "streetWithNumber": "  VÁCLAVSKÉ NÁMĚSTÍ 1  "}
    assert app.post_upload_address_key(first) == app.post_upload_address_key(second)
