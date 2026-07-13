from unittest.mock import patch

import pytest

pytest.importorskip("psycopg2")

import app


class PickupCursor:
    def __init__(self, point=None):
        self.point = point

    def execute(self, _query, _params):
        return None

    def fetchone(self):
        return self.point


def base_details(service):
    return {
        "firstName": "Žaneta",
        "lastName": "Černá",
        "phone": "+420 777 123 456",
        "email": "zaneta@example.cz",
        "streetWithNumber": "Václavské náměstí 1",
        "street": "Václavské náměstí",
        "houseNumber": "1",
        "city": "Praha",
        "zipCode": "11000",
        "country": "CZ",
        "deliveryService": service,
        "weight": "1,25",
        "codAmount": "0",
        "currency": "CZK",
    }


def test_verified_address_delivery_is_ready_for_shipment():
    mapy_item = {
        "type": "regional.address",
        "name": "Václavské náměstí 1",
        "location": "110 00 Praha, Česko",
        "zip": "11000",
        "regionalStructure": [{"name": "Praha"}],
    }
    with patch.object(app, "mapy_api_key", return_value="test"), patch.object(
        app, "mapy_geocode_items", return_value=[mapy_item]
    ):
        result = app.validate_expedition_details(base_details("dpd_courier"), PickupCursor())

    assert result["status"] == "verified"
    assert result["readyForShipment"] is True
    assert result["details"]["deliveryCarrier"] == "dpd"
    assert result["details"]["city"] == "Praha"


def test_pickup_delivery_requires_catalog_match():
    details = base_details("packeta_pickup")
    details["pickupPointId"] = "nenalezeno"
    result = app.validate_expedition_details(details, PickupCursor())

    assert result["status"] == "error"
    assert result["readyForShipment"] is False
    assert any(issue["category"] == "pickup" for issue in result["issues"])


def test_cod_is_blocked_when_pickup_point_does_not_support_it():
    details = base_details("dpd_pickup")
    details["pickupPointId"] = "DPD-101"
    details["codAmount"] = "499"
    point = {
        "carrier": "dpd",
        "country": "CZ",
        "external_id": "DPD-101",
        "name": "DPD box Praha",
        "address": "Praha 1",
        "city": "Praha",
        "zip_code": "11000",
        "cod_allowed": False,
        "active": True,
    }
    result = app.validate_expedition_details(details, PickupCursor(point))

    assert result["readyForShipment"] is False
    assert any(issue["category"] == "payment" for issue in result["issues"])


def test_existing_shipment_can_keep_pickup_point_from_original_label():
    details = base_details("dpd_pickup")
    details["pickupPointId"] = ""
    result = app.validate_expedition_details(details, PickupCursor(), accept_existing_shipment_pickup=True)

    assert result["readyForShipment"] is True
    assert not any(issue["category"] == "pickup" for issue in result["issues"])


def test_completion_problems_ignore_pickup_when_shipment_number_exists():
    row = {
        "deliveryService": "dpd_pickup",
        "pickupPointId": "",
        "dpdOrderAndPieces": "13835080503326",
        "addressValidationResult": {
            "issues": [{"category": "pickup", "message": "Chybí výdejní místo nebo box.", "severity": "error"}]
        },
        "paymentCheckStatus": "paid",
    }

    assert not any(issue["category"] == "pickup" for issue in app.completion_row_problems(row))
