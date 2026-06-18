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


if __name__ == "__main__":
    unittest.main()
