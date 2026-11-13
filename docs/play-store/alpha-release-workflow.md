# Google Play Alpha release workflow

Use this checklist for a future Patrol Radar release. It reuses the Android APK GitHub Actions workflow to build and test; Play Console remains the release control. No GitHub workflow in this process uploads or publishes to Google Play.

## Boundaries

- Target package: `io.github.missionaryj.patrolradar`.
- Target: **Closed testing → Alpha**, the existing track, not a new track or production.
- Check Publishing overview first for releases in review or ready to publish. If the intended version code is already uploaded or submitted, do not upload it again. Check its status and ask the owner what to do next.
- Obtain the owner's explicit approval for the specific release before submitting it for review or publishing it. Managed publishing can require a separate publish action after review; obtain approval for that action too.
- Do not change testers, track settings, subscription products, or production access as part of this procedure.

## Build and verify

1. Identify the exact approved source commit on `main` and the user-visible version in `package.json`. Review the changes and write accurate release notes.
2. In GitHub Actions open **Android APK**, select a successful run for that exact commit on `main`. If needed, use **Run workflow** on `main` and verify the resulting commit. The workflow also updates the rolling `android-latest` debug release on non-PR runs; do not confuse it with the Play release.
3. Wait for the **entire run** to succeed: the `apk` job runs JavaScript tests, the web build and Android unit tests; the independent `aab` job builds the signed bundle. Do not release an AAB from a run if the test job failed or was cancelled, even if the bundle artifact exists.
4. Download the `patrol-radar-release-aab` artifact and extract `patrol-radar-release.aab`. Never upload the debug APK. Record the run URL, commit SHA, artifact, version name and version code. Inspect the bundle metadata and signing certificate when tools are available; verify package, version and upload-key certificate against Play Console.
5. CI sets `VERSION_CODE` to the workflow run number, and Gradle takes the version name from `package.json`. Confirm the actual bundle's version code exceeds **every version code already uploaded** for this app, including pending and other tracks. Do not assume the run number is sufficient. A rerun retains its run number, so it cannot fix an already-used version code. If there is a collision or metadata/signature mismatch, stop and resolve it before creating a release. Do not reuse an old artifact.

## Review and release

1. Open Play Console for Patrol Radar. Inspect **Publishing overview** and **Test and release → Testing → Closed testing → Alpha**. Verify the intended release is not already in review, ready to publish, or available. Confirm the existing tester configuration and current version without changing them.
2. Only for a genuinely new version, create a release in the existing Alpha track, upload the verified AAB, enter accurate release notes, and inspect the resulting version code, target, rollout, warnings and any other pending changes. Save a draft for review where supported; do not submit or publish yet.
3. Present the owner with the exact source commit, Actions run, version name/code, Alpha target, release notes, rollout and Play warnings. Ask for explicit approval before sending this specific release for review. Check Publishing overview again immediately before action for intervening changes. If other changes are included, identify them and obtain approval for the complete set or stop.
4. After approval, send the Alpha release for review. Record the resulting status. With managed publishing on, approval by Google does not itself establish that the update is live: inspect **Changes ready to publish**, identify every included change, and obtain explicit approval before publishing. Never use a broad publish button without checking its full scope.
5. Verify and report the actual state: draft, in review, ready to publish, or available to selected Alpha testers. Provide the Play and Actions links, and note any remaining on-device testing. Do not claim availability from a successful upload or submission alone.

## Current reference

On November 7, 2026, Publishing overview showed Alpha release `1.0.25`, version code `58`, in review, with managed publishing on. It was already submitted and must not be duplicated. The previous Alpha release remained available to selected testers. This is a historical observation; always recheck the live console before acting.
