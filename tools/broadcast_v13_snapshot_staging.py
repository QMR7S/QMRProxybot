"""Offline-only v13 recipient snapshot. Never open a production DB here.

Caller supplies a private SQLite connection to a disposable *staging* copy.
A transaction freezes eligible recipients and switches draft->sending atomically.
No bot messages, network operations, or Telegram credentials are used.
"""
import sqlite3

class SnapshotRejected(RuntimeError):
    pass

def prepare_recipient_snapshot(conn: sqlite3.Connection, broadcast_id: int,
                               expected_eligible: int) -> dict:
    if not isinstance(broadcast_id, int) or isinstance(broadcast_id, bool) or broadcast_id <= 0:
        raise ValueError("invalid broadcast id")
    if not isinstance(expected_eligible, int) or isinstance(expected_eligible, bool) or expected_eligible <= 0:
        raise ValueError("invalid expected count")
    if conn.in_transaction:
        raise SnapshotRejected("caller transaction already active")
    # One SQLite writer at a time; any failed validation rolls back ALL changes.
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(
            "SELECT state, owner_token FROM qmr_broadcast_jobs_v13 WHERE id=?",
            (broadcast_id,)).fetchone()
        if not row or row[0] != "draft" or row[1] is not None:
            raise SnapshotRejected("job must be unclaimed draft")
        prior = conn.execute(
            "SELECT COUNT(*) FROM qmr_broadcast_delivery_v13 WHERE broadcast_id=?",
            (broadcast_id,)).fetchone()[0]
        if prior != 0:
            raise SnapshotRejected("recipient journal already exists")
        # Invalid/missing blocked flags are a migration failure, not permission
        # to send. Users must be reviewed before a snapshot may be opened.
        invalid = conn.execute(
            "SELECT COUNT(*) FROM qmr_users_v6 "
            "WHERE user_id<=0 OR blocked IS NULL OR blocked NOT IN (0,1)"
        ).fetchone()[0]
        if invalid:
            raise SnapshotRejected("invalid migrated users; review before snapshot")
        eligible = conn.execute(
            "SELECT COUNT(*) FROM qmr_users_v6 WHERE blocked=0 AND user_id>0"
        ).fetchone()[0]
        if eligible != expected_eligible:
            raise SnapshotRejected("empty or mismatched eligible recipient count")
        conn.execute(
            """INSERT INTO qmr_broadcast_delivery_v13 (broadcast_id,user_id,state)
               SELECT ?, user_id, 'pending' FROM qmr_users_v6
               WHERE user_id>0 AND blocked=0 ORDER BY user_id""",
            (broadcast_id,))
        count = conn.execute(
            "SELECT COUNT(*) FROM qmr_broadcast_delivery_v13 WHERE broadcast_id=?",
            (broadcast_id,)).fetchone()[0]
        if count != eligible:
            raise SnapshotRejected("recipient count mismatch")
        updated = conn.execute(
            """UPDATE qmr_broadcast_jobs_v13 SET state='sending'
               WHERE id=? AND state='draft' AND owner_token IS NULL""",
            (broadcast_id,)).rowcount
        if updated != 1:
            raise SnapshotRejected("concurrent job transition")
        conn.commit()
        return {"broadcast_id":broadcast_id, "eligible":count, "status":"sending"}
    except BaseException:
        conn.rollback()
        raise
