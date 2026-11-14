import unittest

import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import broadcast
from broadcast import check_proxies, parse_proxy, load_accounts, mark_flood_wait, mark_peer_flood, pick_account, sent_today_by_account


class PickAccountTest(unittest.TestCase):
    NAMES = ['a', 'b', 'c', 'd']

    def run_plan(self, total, cap=100, blocked=()):
        sent, last, order = {}, None, []
        for _ in range(total):
            name = pick_account(self.NAMES, sent, cap, set(blocked), last)
            if name is None:
                break
            sent[name] = sent.get(name, 0) + 1
            last = name
            order.append(name)
        return order, sent

    def test_spreads_evenly(self):
        _, sent = self.run_plan(10)
        self.assertEqual(sorted(sent.values()), [2, 2, 3, 3])

    def test_goes_round_robin(self):
        order, _ = self.run_plan(8)
        self.assertEqual(order, ['a', 'b', 'c', 'd'] * 2)

    def test_skips_blocked(self):
        order, sent = self.run_plan(6, blocked={'b'})
        self.assertNotIn('b', order)
        self.assertEqual(sum(sent.values()), 6)

    def test_respects_cap_and_stops(self):
        order, sent = self.run_plan(50, cap=2)
        self.assertEqual(len(order), 8)
        self.assertTrue(all(v == 2 for v in sent.values()))

    def test_all_blocked(self):
        self.assertIsNone(pick_account(self.NAMES, {}, 5, set(self.NAMES), None))

    def test_counts_today_per_account_with_legacy_entries(self):
        log = [
            {'status': 'sent', 'at': '2026-11-12T10:00:00+00:00', 'account': 'a'},
            {'status': 'sent', 'at': '2026-11-12T11:00:00+00:00'},  # старая запись без account
            {'status': 'sent', 'at': '2026-11-11T11:00:00+00:00', 'account': 'a'},
            {'status': 'privacy', 'at': '2026-11-12T12:00:00+00:00', 'account': 'a'},
        ]
        self.assertEqual(sent_today_by_account(log, '2026-11-12'), {'a': 1, 'noova-company': 1})


if __name__ == '__main__':
    unittest.main()


class PeerFloodTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / 'accounts.json'
        self.addCleanup(self.dir.cleanup)

    def write(self, items):
        self.path.write_text(json.dumps(items), encoding='utf-8')

    def names(self):
        return [a['name'] for a in load_accounts(self.path)]

    def ago(self, hours):
        return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    def test_skips_within_24h(self):
        self.write([{'name': 'a', 'peerFlood': self.ago(2)}, {'name': 'b'}])
        self.assertEqual(self.names(), ['b'])

    def test_returns_after_24h(self):
        self.write([{'name': 'a', 'peerFlood': self.ago(25)}, {'name': 'b'}])
        self.assertEqual(self.names(), ['a', 'b'])

    def test_mark_writes_flag_and_skips(self):
        self.write([{'name': 'a'}, {'name': 'b', 'api_id': 1}])
        mark_peer_flood(self.path, 'a')
        data = json.loads(self.path.read_text(encoding='utf-8'))
        self.assertIn('peerFlood', data[0])
        self.assertEqual(data[1], {'name': 'b', 'api_id': 1})
        self.assertEqual(self.names(), ['b'])

    def test_flood_wait_skips_until_expiry(self):
        future = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        self.write([{'name': 'a', 'floodWait': future}, {'name': 'b', 'floodWait': self.ago(1)}])
        self.assertEqual(self.names(), ['b'])

    def test_mark_flood_wait_sets_future_time(self):
        self.write([{'name': 'a'}])
        mark_flood_wait(self.path, 'a', 600)
        self.assertEqual(self.names(), [])


class ProxyTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(parse_proxy('socks5://u:p%40@1.2.3.4:1080', 'x'),
                         ('socks5', '1.2.3.4', 1080, True, 'u', 'p@'))
        self.assertEqual(parse_proxy('socks5://1.2.3.4:1080', 'x')[4:], (None, None))

    def test_parse_rejects_garbage(self):
        for bad in ('1.2.3.4:1080', 'socks5://host', 'ftp://h:1'):
            with self.assertRaises(SystemExit):
                parse_proxy(bad, 'x')

    def test_require_proxy_blocks_missing_and_shared(self):
        ok = [{'name': 'a', 'proxy_url': 'socks5://h:1'}, {'name': 'b', 'proxy_url': 'socks5://h:2'}]
        check_proxies(ok, True)
        with self.assertRaises(SystemExit):
            check_proxies(ok + [{'name': 'c'}], True)
        with self.assertRaises(SystemExit):
            check_proxies([ok[0], {'name': 'd', 'proxy_url': 'socks5://h:1'}], True)
