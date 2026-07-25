from datetime import date

import pytest

pytest.importorskip("psycopg2")

import app


def test_bulk_day_dates_are_validated_and_deduplicated():
    result = app.normalize_bulk_expedition_day_dates(
        ["2026-07-25", "2026-07-24", "2026-07-25"]
    )

    assert result == [date(2026, 7, 25), date(2026, 7, 24)]


@pytest.mark.parametrize("values", [None, [], ["25.7.2026"], ["2026-02-31"]])
def test_bulk_day_dates_reject_invalid_input(values):
    with pytest.raises(ValueError):
        app.normalize_bulk_expedition_day_dates(values)
