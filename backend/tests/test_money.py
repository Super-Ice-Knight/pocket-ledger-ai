from app.money import parse_yuan_to_cents, cents_to_yuan


def test_money_uses_integer_cents_without_float_error():
    assert parse_yuan_to_cents("0.1") + parse_yuan_to_cents("0.2") == 30


def test_common_amount_inputs():
    assert parse_yuan_to_cents("19.9") == 1990
    assert parse_yuan_to_cents("50元") == 5000
    assert parse_yuan_to_cents("今天花了 12.34 块") == 1234


def test_cents_formatting():
    assert cents_to_yuan(1990) == "19.90"

