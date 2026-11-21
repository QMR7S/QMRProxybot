"""Isolated SQLite contract tests. No live database or Telegram calls."""
import pathlib
import sqlite3
import unittest

SCHEMA = pathlib.Path(__file__).with_name("broadcast_v13_review_schema.sql").read_text()

def claim(db, owner, now, duration=1000):
    cursor = db.execute("""UPDATE qmr_broadcast_jobs_v13
        SET owner_token=?,lease_until_ms=?,fence=fence+1
        WHERE id=1 AND state='sending'
          AND (owner_token IS NULL OR lease_until_ms<=?)""",
        (owner, now+duration, now))
    if cursor.rowcount != 1:
        return None
    return db.execute("SELECT fence FROM qmr_broadcast_jobs_v13 WHERE id=1").fetchone()[0]

def transition(db, user_id, before, after, owner, fence, now):
    return db.execute("""UPDATE qmr_broadcast_delivery_v13
        SET state=?,attempts=attempts+1,attempted_ms=?
        WHERE broadcast_id=1 AND user_id=? AND state=? AND EXISTS (
          SELECT 1 FROM qmr_broadcast_jobs_v13
          WHERE id=1 AND owner_token=? AND fence=? AND lease_until_ms>?)""",
        (after,now,user_id,before,owner,fence,now)).rowcount

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:", isolation_level=None)
        self.db.executescript(SCHEMA)
        self.db.execute("INSERT INTO qmr_broadcast_jobs_v13 (id,content,state,created_ms) VALUES (1,?,'sending',0)", ("synthetic",))
        self.db.execute("INSERT INTO qmr_broadcast_delivery_v13 (broadcast_id,user_id) VALUES (1,123)")

    def tearDown(self):
        self.db.close()

    def state(self):
        return self.db.execute("SELECT state FROM qmr_broadcast_delivery_v13 WHERE broadcast_id=1 AND user_id=123").fetchone()[0]

    def test_atomic_single_claim(self):
        self.assertEqual(claim(self.db, "a", 100), 1)
        self.assertIsNone(claim(self.db, "b", 100))

    def test_stale_owner_fenced_after_expiry(self):
        old = claim(self.db, "a", 100)
        new = claim(self.db, "b", 1101)
        self.assertEqual(new, old+1)
        self.assertEqual(transition(self.db,123,"pending","attempting","a",old,1102), 0)
        self.assertEqual(transition(self.db,123,"pending","attempting","b",new,1102), 1)

    def test_interrupted_attempt_is_not_requeued(self):
        old = claim(self.db, "a", 100)
        self.assertEqual(transition(self.db,123,"pending","attempting","a",old,105), 1)
        claim(self.db,"b",1101)
        self.assertEqual(self.state(), "attempting")
        self.assertEqual(self.db.execute("SELECT count(*) FROM qmr_broadcast_delivery_v13 WHERE state='pending'").fetchone()[0],0)

    def test_cancel_blocks_new_claim(self):
        self.db.execute("UPDATE qmr_broadcast_jobs_v13 SET state='cancelled' WHERE id=1")
        self.assertIsNone(claim(self.db,"a",100))

    def test_unique_recipient(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO qmr_broadcast_delivery_v13 (broadcast_id,user_id) VALUES (1,123)")

    def test_invalid_state_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE qmr_broadcast_delivery_v13 SET state='requeued' WHERE user_id=123")

    def test_expired_owner_cannot_write(self):
        fence = claim(self.db,"a",100)
        self.assertEqual(transition(self.db,123,"pending","attempting","a",fence,1101),0)
        self.assertEqual(self.state(),"pending")

if __name__ == "__main__":
    unittest.main()
