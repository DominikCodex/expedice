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


def typo_address_data():
    return {
        "streetWithNumber": "Zákuští 420",
        "street": "Zákuští 420",
        "houseNumber": "",
        "city": "Zlín-Louky",
        "zipCode": "76302",
        "country": "CZ",
    }


def typo_mapy_item(name="Záluští 420", zip_code="763 02", location="763 02 Zlín - Louky, Česko"):
    return {
        "type": "regional.address",
        "name": name,
        "location": location,
        "zip": zip_code,
        "regionalStructure": [{"name": "Zlín"}],
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


def test_single_character_street_typo_is_applied_automatically():
    with patch.object(app, "mapy_lookup_with_retries", return_value=[typo_mapy_item()]):
        result = app.classify_post_upload_address("test-key", typo_address_data())

    assert result["status"] == "verified"
    assert result["valid"] is True
    assert result["appliedSingleCharacterCorrection"] is True
    assert result["safeAddress"]["streetWithNumber"] == "Záluští 420"


def test_ambiguous_single_character_matches_are_not_applied():
    candidates = [
        typo_mapy_item(name="Záluští 420"),
        typo_mapy_item(name="Zákuší 420"),
    ]
    with patch.object(app, "mapy_lookup_with_retries", return_value=candidates):
        result = app.classify_post_upload_address("test-key", typo_address_data())

    assert result["status"] == "suggestion"
    assert result["valid"] is False
    assert result["safeAddress"] is None


@pytest.mark.parametrize(
    "candidate",
    [
        typo_mapy_item(name="Záluští 421"),
        typo_mapy_item(zip_code="760 01"),
        typo_mapy_item(location="763 02 Zlín, Česko"),
        typo_mapy_item(location="763 02 Zlín - Louky, Slovensko"),
    ],
)
def test_single_character_typo_requires_matching_house_zip_city_and_country(candidate):
    with patch.object(app, "mapy_lookup_with_retries", return_value=[candidate]):
        result = app.classify_post_upload_address("test-key", typo_address_data())

    assert result["status"] == "suggestion"
    assert result["valid"] is False
    assert result["safeAddress"] is None


def test_more_than_one_character_difference_remains_a_suggestion():
    with patch.object(app, "mapy_lookup_with_retries", return_value=[typo_mapy_item(name="Zámostí 420")]):
        result = app.classify_post_upload_address("test-key", typo_address_data())

    assert result["status"] == "suggestion"
    assert result["valid"] is False


def test_same_normalized_address_uses_one_batch_key():
    first = {**address_data(), "streetWithNumber": "Václavské náměstí 1"}
    second = {**address_data(), "streetWithNumber": "  VÁCLAVSKÉ NÁMĚSTÍ 1  "}
    assert app.post_upload_address_key(first) == app.post_upload_address_key(second)
