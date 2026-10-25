# Tracker iOS (Native SwiftUI App)

A 100% native iPhone and iPad client for **Tracker**, built in Swift and SwiftUI for iOS 17+.

It connects securely to your Tracker server over Tailscale (`https://bailey-1.tailbcee98.ts.net:8443`) or local network Wi-Fi (`http://<PC-LAN-IP>:4317`).

---

## Features

- 🌅 **Today Focus Dashboard**:
  - Live progress ring showing tasks completed today vs due.
  - Interactive Focus list with tap-to-complete checkboxes and native haptics.
  - Active projects carousel with progress bars, color tags, and next steps.
  - "Waiting for You" section with inline answering of agent questions.
  - "With the Agent" hand-off list with recent agent replies.
  - Blocked tasks with reasons.
- 📁 **Projects & Workspaces**:
  - Full project catalog grouped by Area (Code, Music, School, etc.).
  - Search bar across projects, areas, and descriptions.
  - Filter by Active, Paused, or Archived status.
  - "+ New Project" sheet with custom color palette.
- 🎯 **Deep Project View**:
  - **Tasks**: Filter by Open, All, Done, or Agent; tap to view/edit; swipe-to-complete; "+ New Task" modal.
  - **Milestones**: Filter planned vs achieved releases, target dates, and achieved markdown bullets.
  - **Notes**: Formatted project notes with inline live editor and save.
  - **Resume in Chat Prompt**: One-tap copy button that fetches and copies a ready-to-paste prompt to your clipboard.
  - **Folder Path**: View configured folder with quick copy.
- 📝 **Task Details Sheet**:
  - Edit title, status, priority, owner (You / Agent), due date, and estimate (minutes).
  - Subtasks checklist with tap-to-toggle, inline add subtask, and swipe-to-delete.
  - Automatic blocked reason prompt when status is set to Blocked.
  - Delete task with safety confirmation.
- 📅 **Weekly Review**:
  - Summary metrics: completed tasks this week, slipped dates, and quiet projects (7+ days inactive).
  - Open agent questions with direct inline replies.
- ⚙️ **Settings & Networking**:
  - Configurable server URL (defaults to your secure Tailscale address).
  - Connection test tool with live millisecond latency check.
  - Remote "Back Up Database Now" trigger.

---

## Building and Running

### 1. Building via GitHub Actions (No Mac needed on your desk)
This repository includes `.github/workflows/ios.yml`.
When you push this repository to GitHub:
1. GitHub Actions spins up a macOS runner with Xcode.
2. It builds the native `Tracker.app` bundle automatically.
3. It packages and uploads `Tracker-iOS.zip` under the **Actions** tab artifacts.

### 2. Opening in Xcode (on macOS)
1. Open `ios/Tracker.xcodeproj` in Xcode 15 or 16.
2. Select your target device (any iPhone Simulator or your physical iPhone).
3. If deploying to a physical device:
   - In **Signing & Capabilities**, select your free or paid Apple Developer Team.
4. Press **Cmd + R** to run.

---

## Connecting to Your Server

1. **Away from home**:
   - Ensure Tailscale is active on your iPhone.
   - The app defaults to `https://bailey-1.tailbcee98.ts.net:8443`.
2. **On home Wi-Fi**:
   - In the app's **Settings** tab, you can also use your PC's local IP address: `http://192.168.1.X:4317`.
   - Tap **Test Connection** to verify connectivity and latency.
