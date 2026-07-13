from expedition_integrity import assess_integrity, build_batch_snapshot, compare_order_variants


def completion(order, number, code, quantity=1):
    return {
        "orderNumber": order,
        "expeditionNumber": number,
        "expeditionOrderCode": code,
        "quantity": quantity,
    }


def sorting(order, code, quantity=1, remaining=None):
    return {
        "orderNumber": order,
        "variantCode": code,
        "initialQuantity": quantity,
        "remaining": quantity if remaining is None else remaining,
    }


def test_snapshot_is_based_on_initial_sorting_quantity():
    rows = [completion("A", 1, "0.8", 3), completion("B", 2, "3", 5)]
    sorting_rows = [sorting("B", "SKU-1", 3, remaining=0)]
    snapshot = build_batch_snapshot(rows, sorting_rows)
    assert snapshot["orders"] == 2
    assert snapshot["pieces"] == 8
    assert snapshot["stockOrders"] == 1
    assert snapshot["stockPieces"] == 5


def test_confirmed_unpaid_payment_is_not_counted_as_attention():
    unpaid = completion("A", 1, "0.8")
    unpaid["paymentCheckStatus"] = "unpaid"
    unresolved = completion("B", 2, "1")
    unresolved["paymentCheckStatus"] = "unknown"

    snapshot = build_batch_snapshot([unpaid, unresolved], [])

    assert snapshot["paymentWarnings"] == 1


def test_same_variant_in_multiple_orders_is_not_ambiguous():
    result = assess_integrity(
        [completion("A", 1, "3"), completion("B", 2, "3")],
        [sorting("A", "SKU-1"), sorting("B", "SKU-1")],
        {"859000000001": [{"variantCode": "SKU-1"}, {"variantCode": "SKU-1"}]},
    )
    assert not [issue for issue in result["issues"] if issue["code"] == "ambiguous_ean"]


def test_ean_for_multiple_variants_is_ambiguous():
    result = assess_integrity(
        [completion("A", 1, "3")],
        [sorting("A", "SKU-1")],
        {"859000000001": [{"variantCode": "SKU-1"}, {"variantCode": "SKU-2"}]},
    )
    assert [issue for issue in result["issues"] if issue["code"] == "ambiguous_ean"]


def test_invalid_remaining_and_duplicate_number_are_errors():
    result = assess_integrity(
        [completion("A", 1, "3"), completion("B", 1, "3")],
        [sorting("A", "SKU-1", 1, remaining=2), sorting("B", "SKU-1")],
    )
    codes = {issue["code"] for issue in result["issues"]}
    assert "invalid_remaining" in codes
    assert "duplicate_expedition_number" in codes
    assert result["ok"] is False


def test_variant_comparison_reports_specific_quantity_difference():
    row = {
        "raw": {
            "items": [
                {"variantCode": "GBTW-3101-LXL-CERNA", "quantity": 2},
                {"variantCode": "GBTW-3101-LXL-RUZOVA", "quantity": 1},
            ]
        }
    }
    comparison = compare_order_variants(
        row,
        [
            sorting("A", "GBTW-3101-LXL-CERNA", 1),
            sorting("A", "GBTW-3101-LXL-RUZOVA", 1),
        ],
    )
    assert comparison["matches"] is False
    black = next(item for item in comparison["items"] if item["variantKey"] == "gbtw3101lxlcerna")
    assert black["expected"] == 2
    assert black["sortingInitial"] == 1
