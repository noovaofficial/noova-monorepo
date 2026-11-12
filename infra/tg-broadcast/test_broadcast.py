import unittest

from broadcast import pick_account, sent_today_by_account


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
