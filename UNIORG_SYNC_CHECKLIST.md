# UniOrg Sync Verification Checklist

Use this checklist after installing a new APK.

1. Connect the scanner to UniOrg and confirm the Sessions screen shows `LIVE`.
2. Tap **Roster** and confirm the downloaded student count appears in the
   success message and Cached roster metric.
3. Disconnect from the internet, search for a downloaded student, and confirm
   the name is still resolved from the offline roster.
4. Open one test attendance session.
5. Scan one student QR and verify the student appears once in UniOrg.
6. Keep the same QR in the camera frame for five seconds. The scanner must not
   show a second false result or create another attendance row.
7. Enable Offline Mode, scan a different student, and confirm the result says
   `QUEUED` rather than `PRESENT`.
8. Return to Online Mode and open Sync Center. Sync the pending row.
9. Verify it disappears from Pending and appears in the correct UniOrg session.
10. Scan an invalid or ineligible QR. It must show an error or move to Needs
   Review; it must never be shown as Present.
11. Disconnect during a sync attempt. The row must remain Pending for retry.
12. Test two scanner devices on the same session and confirm session-wide stats
    update after synchronization.
