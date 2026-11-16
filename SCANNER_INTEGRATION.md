# CCASSO scanner integration

The app connects all three modes to the existing Admin-generated Kiosk API
token. The UniSystem backend must include the signed membership and Enrollment
receipt endpoints documented in its `SCANNER_QR_INTEGRATION.md`. The mobile
integration adds no tables or Neon migration. The earlier collections and
membership database migration must already be applied on the deployed backend.

## Connect and scan

1. In UniSystem Admin, generate an active Kiosk API token (or reuse the scanner's
   existing active token). Use a separate token per device when tracking devices.
2. In Scanner Setup, enter the deployed HTTPS base URL and token, plus a device
   ID, gate, and operator. Tap **Verify & continue** while connected.
3. Choose a mode from **Scanner modes**:
   - **Attendance**: choose an open session, scan the student's attendance QR.
   - **Membership**: scan the QR printed on the issued membership card.
   - **Enrollment Fee**: select the A.Y. being checked, then scan the receipt QR.
4. Review the returned student name and details. Use **Scan again** for the next
   card or receipt. Manual QR entry also accepts the complete signed payload.
5. Use Home / Modes to change mode. Inside the attendance camera, use
   **More → Choose scanner mode**. The attendance session PIN still applies.

Membership and receipt verification require internet access. A camera read
alone is not confirmation. A connection error, timeout, or expired/revoked API
token produces an unverified result; retry online or fix Scanner Setup.
Attendance's offline roster and queued scans retain their existing behavior.
Verification requests never enter that queue.

## Requests and result rules

Every request uses `Authorization: Bearer <token>` over HTTPS in production.
Use the base URL only in Setup, without an `/api/kiosk` suffix. Keep the backend
signing secret stable so existing printed cards and receipts remain verifiable.
The QR includes a signed record identifier; no API token or payment credential.

| Mode | QR format | Request | Confirmation |
| --- | --- | --- | --- |
| Attendance | `UQ1:` and supported legacy student codes | `POST /api/kiosk/scan` with `session_id`, `student_code`, device metadata | Server-confirmed attendance; offline scans remain pending |
| Membership | `UM1:` | `POST /api/kiosk/memberships/verify` with `qr_payload` | `success: true`, `valid: true`, `status: "VALID"` |
| Enrollment Fee | `UE1:` | `POST /api/kiosk/enrollment-receipts/verify` with `qr_payload`, `academic_year: "2026-2027"` | Authentic receipt, matching A.Y., `fee_status: "PAID_IN_FULL"`, and `can_confirm_enrollment_fee: true` |

Prefixes route the code to its intended mode. Only the server verifies the
signature, live payment status, and expiry. Membership renewal produces a new
card; an old expired/revoked card does not become valid because of that renewal.

Enrollment outcomes:

- **Fully paid**: this receipt's collection is settled for the selected A.Y.
  This does not imply that every other collection or clearance is complete.
- **Partial / unpaid**: an authentic receipt exists but the collection still
  has a balance. Review the current paid total and outstanding balance.
- **Different A.Y.**: receipt is authentic but belongs to another year.
- **Voided / invalid / not found**: cannot confirm payment with this QR.
- **Unverified**: no usable online confirmation. Retry; do not treat as paid.

Membership outcomes distinguish valid, expired, revoked, and invalid records.
Only valid membership and fully paid matching-year receipts use green success.

## Local validation and release

```cmd
npm test
npx expo export --platform android --output-dir output/expo-android-verification
npm run start:go -- --clear
```

For a local standalone test APK, use Java 17 and the Android SDK, then run:

```cmd
npm run android:apk:local
```

The output is `output/apk/CCASSO-Scanner-2.2.0-local-test.apk`, labeled
**CCASSO Scanner Test** with package `org.ccasso.kioskscanner.local`. It includes
the JavaScript bundle, needs neither Metro nor Expo Go, and uses the existing
Android debug/test signing key. It installs beside the original app. Configure
its own server URL and active Admin-generated API token in **Scanner Setup**;
its saved settings and attendance queue are separate. Synchronize pending scans
in the original app from that original app.

`npm run android:apk` still produces a development-client APK which loads
JavaScript from Metro. `npm run build:apk` still uses the EAS `preview` profile
for a standalone APK with the original app identity. The local test APK does
not update an existing EAS-signed installation.

Before distributing, test on the intended Android phone against the deployed
backend: valid/expired/voided membership, full/partial/voided receipt, wrong A.Y.,
wrong scanner mode, revoked API token, internet loss, and a normal attendance
scan followed by offline queue sync. Check camera permissions, torch, returning
from background, duplicate frames, and scanning again. Local bundle and automated
tests do not confirm physical camera behavior or production connectivity.
