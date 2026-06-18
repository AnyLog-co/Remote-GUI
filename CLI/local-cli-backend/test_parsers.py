import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from parsers import parse_response


def test_parse_response_accepts_float_scalar():
    assert parse_response(32.5) == {"type": "string", "data": "32.5"}


def test_parse_response_accepts_zero_float_scalar():
    assert parse_response(0.0) == {"type": "string", "data": "0.0"}


def test_parse_response_accepts_none_scalar():
    assert parse_response(None) == {"type": "string", "data": ""}


def test_parse_response_preserves_json_list():
    payload = [{"node": "alpha", "cpu_percent": 12.25}]
    assert parse_response(payload) == {"type": "json", "data": payload}


def test_parse_response_still_parses_pipe_table():
    raw = "Name | CPU |\n-----|-----|\nn1   | 1.5 |"
    parsed = parse_response(raw)

    assert parsed["type"] == "table"
    assert parsed["data"]
    assert list(parsed["data"][0].values()) == ["n1", "1.5"]
