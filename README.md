<div align="center">

# Steins;Keys

**Zero-Jitter Mouse Axis Inverter, HID Button Remapper & Sub-2ms WASAPI Acoustic Synthesizer for Windows**

[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011%20(x64)-09090B?style=flat-square&logo=windows&logoColor=white)](https://github.com/)
[![Backend](https://img.shields.io/badge/Core-Rust%20(Lock--Free%208KHz)-09090B?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Framework](https://img.shields.io/badge/Desktop-Tauri%20v2-09090B?style=flat-square&logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![License](https://img.shields.io/badge/License-MIT-09090B?style=flat-square)](./LICENSE)

</div>

---

## Overview

**Steins;Keys** is an open-source, ultra-low-latency mouse utility engineered for competitive FPS players and power users on Windows who rely on **inverted axes (Pitch/Yaw)**, **sensor angle rotation**, **physical button remapping**, and **tactile acoustic click feedback** with zero input lag.

Designed around a strict **Monochrome Editorial Noir** interface (inspired by Linear, Vercel Geist, and Wootility), Steins;Keys eliminates bloated background processes and garbage-collector pauses, supporting high-polling-rate mice from **1000Hz up to 8000Hz**.

---

## Key Features

### 1. Dual-Mode Low-Level Interception Engine (`THREAD_PRIORITY_TIME_CRITICAL`)
- **Mode 01 — User-Mode Hook (`WH_MOUSE_LL`):** Uses native Win32 hooks (`SetWindowsHookExW` + `GetCursorPos`/`SetCursorPos` & `SendInput`). 100% safe with kernel-level anti-cheats (Vanguard, FACEIT, EasyAntiCheat) for desktop usage and standard games.
- **Mode 02 — Raw Input Kernel Bridge (`Interception`):** Optional integration with the Interception HID filter driver to invert $(dx, dy)$ hardware packets directly below Windows Raw Input for modern FPS titles.
- **Wait-Free Hot Path:** Built with `ArcSwap` and atomic operations — zero heap allocations and zero mutex locks inside the mouse callback.

### 2. Full 2D Vector Matrix Transformation
- **Independent Axis Inversion:** Invert **Y-Axis** ($dy = -dy$, vertical pitch) and **X-Axis** ($dx = -dx$, horizontal yaw) independently.
- **Axis Transpose (`Swap X ↔ Y`):** Orthogonal axis permutation.
- **Sub-Pixel Sensor Rotation ($\theta \in [-180^\circ, +180^\circ]$):** Custom sensor angle offset with a thread-local IEEE-754 fractional error accumulator to prevent pixel skipping during micro-adjustments.
- **Interactive Dot-Matrix Playground:** Test axis transformations live inside the application at 60 FPS before entering a match.

### 3. Sub-2ms RAM-Preloaded WASAPI Acoustic Engine
- Pre-synthesizes and loads 16-bit 44.1kHz PCM `.wav` buffers directly into RAM at boot.
- Triggered asynchronously via a bounded lock-free `crossbeam-channel` (`try_send`) so the mouse capture thread never waits for audio playback.
- Includes four acoustic profiles: **Noir Typewriter**, **Heavy Mechanical**, **Soft Tactile**, and **Retro Beep**.

### 4. Executable Auto-Profiler (`Game Watcher`)
- Monitors active foreground windows via `SetWinEventHook` (`EVENT_SYSTEM_FOREGROUND`) with zero polling overhead.
- Automatically switches mouse rules when target executables (`cs2.exe`, `valorant.exe`, `r5apex.exe`, etc.) gain focus and restores desktop defaults when returning to `explorer.exe`.

### 5. Zero-RAM System Tray Lifecycle & Emergency Kill Switch
- **WebView Destruction on Close:** Closing the main window destroys the `msedgewebview2.exe` UI process completely, keeping only the native Rust daemon running in the Windows System Tray (**< 8 MB RAM** and **0% idle CPU**).
- **Emergency Kill Switch:** Press `Ctrl + Shift + I` (or `Ctrl + Shift + Alt + I`) anywhere in Windows—or double-click the System Tray icon—to bypass all mouse interception instantaneously.

---

## Project Architecture

```text
SteinsKeys/
├── .github/workflows/
│   └── release.yml               # Automated cloud build & GitHub Release pipeline
├── src/
│   ├── main.tsx                  # React 18 entrypoint
│   ├── index.css                 # Monochrome Editorial Noir theme & custom controls
│   └── App.tsx                   # 5-tab Control Surface (Axes, Buttons, Acoustics, Profiles, System)
└── src-tauri/
    ├── Cargo.toml                # Rust dependencies & release LTO optimizations
    ├── tauri.conf.json           # Tauri v2 window & bundle configuration
    └── src/
        ├── main.rs               # IPC handlers & Zero-RAM WebView lifecycle
        ├── input_engine.rs       # Lock-free WH_MOUSE_LL hook & Kernel HID bridge
        ├── tray.rs               # Native Win32 System Tray & Global Kill Switch
        ├── audio_engine.rs       # In-memory WASAPI PCM synthesizer & player
        └── game_watcher.rs       # Win32 EVENT_SYSTEM_FOREGROUND process watcher
```

---

## Getting Started (Local Development)

### Prerequisites
- **Windows 10 / 11 (x64)**
- **[Node.js](https://nodejs.org/)** (v18+ or v20+)
- **[Rust Toolchain](https://rustup.rs/)** (`stable-x86_64-pc-windows-msvc` with C++ Build Tools & Windows SDK)

### Installation & Development

1. **Clone the repository:**
   ```powershell
   git clone https://github.com/YOUR-USERNAME/SteinsKeys.git
   cd SteinsKeys
   ```

2. **Install frontend dependencies:**
   ```powershell
   npm install
   ```

3. **Run in Tauri development mode:**
   ```powershell
   npm run tauri dev
   ```
   *(Optional: To enable the Interception kernel driver bridge for Raw Input FPS games, run `npm run tauri dev -- --features kernel-interception`)*.

### Building Production Installers (`.exe` / `.msi`)

```powershell
npm run tauri build
```
Compiled artifacts will be generated under `src-tauri/target/release/bundle/`.

---

## Automated Cloud Builds (GitHub Actions)

This repository includes a pre-configured GitHub Actions workflow ([`.github/workflows/release.yml`](./.github/workflows/release.yml)).
- **Manual Trigger:** Go to the **Actions** tab on GitHub $\rightarrow$ **Build & Release Steins;Keys (Windows x64)** $\rightarrow$ **Run workflow**.
- **Tag Trigger:** Pushing any version tag (`git tag v1.0.0 && git push origin v1.0.0`) automatically compiles the Windows `.exe` and `.msi` installers on GitHub's servers and publishes a new **GitHub Release**.

---

## Emergency Shortcuts

| Action | Shortcut / Trigger |
| :--- | :--- |
| **Toggle Master Interceptor (Kill Switch)** | `Ctrl + Shift + I` or `Ctrl + Shift + Alt + I` |
| **Tray Quick Bypass** | **Double-Click** the Steins;Keys System Tray icon |
| **Restore UI from System Tray** | **Single Left-Click** or **Right-Click $\rightarrow$ Open Panel** |

---

## License

Distributed under the **MIT License**.