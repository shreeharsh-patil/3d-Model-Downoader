# 3D Model Downloader Privacy Policy

_Last updated: September 2026_

3D Model Downloader is an independent browser extension that assists users in detecting and downloading legitimately accessible 3D models generated on supported web-based 3D generation platforms (Meshy, Tripo3D, Luma AI, and Rodin / Hyper3D).

3D Model Downloader is an independent project and is not affiliated with, endorsed by, or connected to Meshy.ai, Tripo3D.ai, Luma AI, or Deemos / Rodin.

## Core Privacy Principles

1. **Zero Telemetry / Zero Analytics**: We do not collect, track, or transmit any analytics, metrics, or telemetry.
2. **Zero Remote Servers / Zero Cloud Backend**: All operations—model detection, GLB validation, dequantization, meshopt decompression, texture embedding, and packaging—occur 100% locally inside your browser sandbox.
3. **Zero Credential Persistence**: We do not collect, store, transmit, or log passwords, session tokens, authorization signatures, or cookies.
4. **Zero Data Monetization**: We never sell, rent, monetize, or share user data or browsing activity with any third party.
5. **Legitimate Access Only**: The extension only detects and processes assets that the underlying platform has already made available to your currently active session.

## Data Processed Locally

The extension processes limited technical data entirely on your device:

- **Active Tab URL**: Used solely by the background service worker to determine whether the current browser tab is visiting a supported 3D platform.
- **In-Memory 3D Assets**: Binary GLB files and textures loaded by the webpage are buffered in local browser memory during the active session to prepare the file for download.
- **Local Extension Storage**:
  - User configuration preferences (e.g., texture conversion format, auto-ask prompt toggle).
  - Optional local download history (retains up to 20 recent items: model name, provider, filename, timestamp, file size). This history never stores signed URLs, tokens, or binary data. You can clear this history at any time with a single click.

## Permissions Rationale

- `tabs`: Required to identify the active provider tab, isolate model state per tab, detect SPA route changes (to discard stale model state), and clean up state when a tab is closed.
- `storage`: Required to save user preferences (such as preferred texture format) and local download history strictly on your device.
- `activeTab`: Grants temporary elevated access to the active tab only when you interact with the extension popup.
- `host_permissions`: Narrowly restricted to the official domains and asset CDNs of supported providers to detect assets and perform model processing.

## Third-Party Services and Platforms

The extension runs within pages hosted by third-party services (Meshy, Tripo3D, Luma AI, and Rodin). We do not control and are not responsible for the privacy practices, terms of service, or cookies utilized by those platforms. Please consult their respective privacy policies.

## Open Source and Auditing

The extension's complete source code is open source under the Mozilla Public License 2.0. Users are welcome to inspect and verify that no telemetry, credential harvesting, or unauthorized network calls are present.