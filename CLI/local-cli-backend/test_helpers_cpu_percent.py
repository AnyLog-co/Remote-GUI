import os
import sys
import types
import unittest
from unittest.mock import patch

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

anylog_api = types.ModuleType("anylog_api")
anylog_connector = types.ModuleType("anylog_api.anylog_connector")
anylog_connector.AnyLogConnector = object
anylog_api.anylog_connector = anylog_connector
sys.modules.setdefault("anylog_api", anylog_api)
sys.modules.setdefault("anylog_api.anylog_connector", anylog_connector)

import helpers


class FakeAnyLogConnector:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, command, destination=None):
        self.calls.append((command, destination))
        return self.responses.pop(0)


class FakeCommandConnector:
    def __init__(self, get_response="file contents"):
        self.get_response = get_response
        self.get_calls = []
        self.post_calls = []

    def get(self, command, destination=None):
        self.get_calls.append((command, destination))
        return self.get_response

    def post(self, command, topic=None, destination=None, payload=None):
        self.post_calls.append((command, topic, destination, payload))
        return True


class CpuPercentRetryTests(unittest.TestCase):
    def test_retries_zero_cpu_percent_until_non_zero_sample(self):
        connector = FakeAnyLogConnector([0.0, 0.0, 6.6])

        with patch.object(helpers.time, "sleep", return_value=None):
            response = helpers._get_with_cpu_percent_retry(
                connector,
                "get node info cpu_percent",
                destination=None,
            )

        self.assertEqual(response, 6.6)
        self.assertEqual(len(connector.calls), 3)

    def test_does_not_retry_other_zero_scalar_commands(self):
        connector = FakeAnyLogConnector([0.0])

        with patch.object(helpers.time, "sleep", return_value=None):
            response = helpers._get_with_cpu_percent_retry(
                connector,
                "get node info getloadavg",
                destination=None,
            )

        self.assertEqual(response, 0.0)
        self.assertEqual(len(connector.calls), 1)

    def test_command_match_allows_extra_whitespace_and_case(self):
        self.assertTrue(
            helpers._is_node_cpu_percent_command("  GET   NODE info   cpu_percent  ")
        )

    def test_system_command_match_allows_extra_whitespace_and_case(self):
        self.assertTrue(
            helpers._is_system_command("  SYSTEM   CAT   !local_scripts/setup.cfg  ")
        )
        self.assertTrue(
            helpers._is_system_command("  SYSTEM   LS   !local_scripts  ")
        )

    def test_system_command_uses_temp_variable_and_returns_text(self):
        connector = FakeCommandConnector(get_response="[metadata]\nversion = 1.2.0\n")

        with patch.object(helpers, "_create_anylog_connector", return_value=connector):
            result = helpers.make_request(
                "127.0.0.1:32149",
                "GET",
                "system cat !local_scripts/setup.cfg",
            )

        self.assertEqual(result, "[metadata]\nversion = 1.2.0\n")
        self.assertEqual(len(connector.post_calls), 2)
        self.assertTrue(connector.post_calls[0][0].endswith(" = system cat !local_scripts/setup.cfg"))
        self.assertTrue(connector.post_calls[1][0].endswith(' = ""'))
        self.assertEqual(len(connector.get_calls), 1)
        self.assertTrue(connector.get_calls[0][0].startswith("get !remote_gui_system_"))


if __name__ == "__main__":
    unittest.main()
