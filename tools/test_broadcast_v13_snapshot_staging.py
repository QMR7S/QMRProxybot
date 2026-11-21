"""Tests run only on in-memory synthetic SQLite. No production files."""
import pathlib
import sqlite3
import unittest
from broadcast_v13_snapshot_staging import prepare_recipient_snapshot, SnapshotRejected

SCHEMA = pathlib.Path(__file__).with_name("broadcast_v13_review_schema.sql").read_text()

class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:", isolation_level=None)
        self.db.executescript(SCHEMA)
        self.db.execute("""CREATE TABLE qmr_users_v6 (
            user_id INTEGER PRIMARY KEY, blocked INTEGER)""")
        self.db.executemany("INSERT INTO qmr_users_v6 VALUES (?,?)",
                            [(101,0),(102,0),(103,1)])
        self.db.execute("""INSERT INTO qmr_broadcast_jobs_v13
            (id,content,state,created_ms) VALUES(1,'synthetic','draft',0)""")

    def tearDown(self):
        self.db.close()

    def state(self):
        return self.db.execute(
            "SELECT state FROM qmr_broadcast_jobs_v13 WHERE id=1").fetchone()[0]

    def recipients(self):
        return self.db.execute(
            "SELECT user_id FROM qmr_broadcast_delivery_v13 WHERE broadcast_id=1 "
            "ORDER BY user_id").fetchall()

    def test_freezes_only_eligible_recipients(self):
        result = prepare_recipient_snapshot(self.db,1,expected_eligible=2)
        self.assertEqual(result["eligible"],2)
        self.assertEqual(self.recipients(),[(101,),(102,)])
        self.assertEqual(self.state(),"sending")

    def test_snapshot_immutable_after_user_changes(self):
        prepare_recipient_snapshot(self.db,1)
        self.db.execute("INSERT INTO qmr_users_v6 VALUES(104,0)")
        self.db.execute("UPDATE qmr_users_v6 SET blocked=1 WHERE user_id=101")
        self.assertEqual(self.recipients(),[(101,),(102,)])
        # Dispatch adapter separately rechecks current blocked status.

    def test_repeat_rejected_without_changes(self):
        prepare_recipient_snapshot(self.db,1)
        with self.assertRaises(SnapshotRejected):
            prepare_recipient_snapshot(self.db,1)
        self.assertEqual(self.recipients(),[(101,),(102,)])

    def test_wrong_expected_count_rolls_back(self):
        with self.assertRaises(SnapshotRejected):
            prepare_recipient_snapshot(self.db,1,expected_eligible=3)
        self.assertEqual(self.recipients(),[])
        self.assertEqual(self.state(),"draft")

    def test_invalid_blocked_flag_rejects_entire_snapshot(self):
        self.db.execute("INSERT INTO qmr_users_v6 VALUES(104,5)")
        with self.assertRaises(SnapshotRejected):
            prepare_recipient_snapshot(self.db,1)
        self.assertEqual(self.recipients(),[])
        self.assertEqual(self.state(),"draft")

    def test_existing_journal_rejected_without_partial_writes(self):
        self.db.execute(
            "INSERT INTO qmr_broadcast_delivery_v13 VALUES (1,101,'pending',0,NULL,NULL,NULL)")
        with self.assertRaises(SnapshotRejected):
            prepare_recipient_snapshot(self.db,1)
        self.assertEqual(self.recipients(),[(101,)])
        self.assertEqual(self.state(),"draft")

    def test_cancelled_job_rejected(self):
        self.db.execute("UPDATE qmr_broadcast_jobs_v13 SET state='cancelled' WHERE id=1")
        with self.assertRaises(SnapshotRejected):
            prepare_recipient_snapshot(self.db,1)
        self.assertEqual(self.recipients(),[])

    def test_empty_eligible_rejected(self):
        self.db.execute("UPDATE qmr_users_v6 SET blocked=1")
        with self.assertRaises(SnapshotRejected):
            prepare_recipient_snapshot(self.db,1)
        self.assertEqual(self.state(),"draft")

    def test_no_nested_transaction(self):
        self.db.execute("BEGIN")
        try:
            with self.assertRaises(SnapshotRejected):
                prepare_recipient_snapshot(self.db,1)
        finally:
            self.db.rollback()

    def test_invalid_ids_rejected(self):
        for invalid in (0,-1,True,1.1):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    prepare_recipient_snapshot(self.db,invalid)

if __name__=="__main__":
    unittest.main()
