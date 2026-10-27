# Closed test checklist (new personal accounts: 12+ testers opted in for 14 continuous days)
1. Wait for identity + phone verification in Play Console.
2. Create app: name "Patrol Radar", App, Free, accept declarations.
3. Setup → App signing: keep **Play App Signing** (default). The upload key is our keystore; the first AAB upload registers it.
4. Download the signed AAB: GitHub → Actions → "Android APK" latest run → artifact `patrol-radar-release-aab` (unzip → `patrol-radar-release.aab`).
5. Testing → Closed testing → Create track (e.g. "Alpha") → Testers: create an email list with **at least 12–15 Google accounts** (add a few spares; testers who drop out don't count).
6. Create release → upload the AAB → release notes "First test build" → Review → Start rollout.
7. Fill App content (Policy → App content): privacy policy URL, ads (no), app access (no login), content rating (content-rating.md), target audience 18+, data safety (data-safety.md), foreground service declaration (permissions.md, include a short screen video link, e.g. unlisted YouTube).
8. Store listing: paste listing.md text, upload icon-512.png, feature-graphic-1024x500.png and screenshots/*.png (2–8).
9. Send testers the opt-in link (Closed testing → Testers → "Copy link"). Each must open it, tap **Become a tester**, then install from Play.
10. Keep ≥12 testers opted in for 14 days straight; ask them to open the app a few times (Google looks at engagement).
11. After day 14: Dashboard → **Apply for production** and answer the questionnaire about the test (how testers were recruited, feedback, changes made).
12. Every new upload needs a higher versionCode — CI uses the workflow run number automatically.
