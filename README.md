https://z750sasr.github.io/epomaker-he30-alternate-web-driver/

|![EPOMAKER HE30 BLACK](images/EPOMAKERHE30_black.webp)|![EPOMAKER HE30 WHITE](images/EPOMAKERHE30_white.webp)|

# HE30 Control

A dependency-free, local-first configuration studio for supported Epomaker HE30-family Hall-effect keyboards. It runs as static files, so it can be hosted directly on GitHub Pages. The main route is dedicated to live hardware configuration; `/json_editor/` is the separate offline backup editor.

## Included

- Direct WebHID connection for normal configuration mode
- Complete JSON profile import and export on the dedicated `/json_editor/` route
- Twelve remap layers across three profiles, with FN/FN1–FN11 targets, F1–F24, media, mouse, and internal functions
- Per-key Hall actuation, Rapid Trigger, supported travel resolution, and top/bottom dead zones
- Mouse, pen, and touch box-selection for tuning groups of Hall-effect keys together
- Live Hall travel monitor with per-key fill animation, switch cutaway, actuation marker, and millimeter readout
- Polling rate, tick rate, debounce, Windows/macOS mode, filtering, Tachyon, and shortcut locks
- All 24 original main-key lighting presets, all 5 light-strip effects, and their effect-specific controls
- Main-key lighting, the small light-strip zone, and saved colors for all 36 physical keys
- Live RGB framebuffer preview for all 36 keys, including onboard animated effects
- Onboard profile switching on multi-profile models
- Live profile and layer tracking: onboard profile-key presses automatically refresh every workspace page
- DKS, Mod-Tap, Toggle, Rappy Snappy, SOCD, combination keys, and macros
- Staged edits, explicit write confirmation, byte-for-byte read-back verification, and an in-browser recovery backup
- Local diagnostics and session-log export
- Automatic return to the connection screen when a connected keyboard is unplugged
- Browser keyboard-action suppression while hardware is connected, so Space, arrows, and remapped keys do not scroll or activate the page during testing

Firmware update and bootloader flashing are intentionally not included.

## Capture-derived compatibility notes

- The original driver exposes travel resolution only for device types `101`, `102`, `103`, and `105`. Type `104` keeps its stored precision bits but does not expose an editor in either the original interface or this app.
- The available resolution steps are `0.01 mm`, `0.005 mm`, and `0.001 mm` for types `102`, `103`, and `105`; type `101` omits `0.001 mm`.
- Config byte 7 bit 0 is read under the internal name `tachyonMode`, while its unused setter is named `setBerserkMode`. The captured production interface does not call that setter, so HE30 Control preserves the bit without offering a toggle.
- Live travel uses the original software's Dynamic Display mechanism: config byte 7 bit 3 enables `0xA0` diagnostic reports. Starting the monitor enables that bit in the active profile's 64-byte config bank when necessary; stopping it restores the same profile bank. The stream is unavailable in JSON and demo workspaces.
- The same temporary Dynamic Display flag exposes command `0xDE`, a 384-byte RGB framebuffer. Its first 108 bytes are the live RGB triplets for the HE30's 36 physical keys; the remaining slots are zero. The light strip is configured separately and is not present in this live frame.
- The original factory-reset flow sends subcommand `0xEE` with the active profile index (`0`–`2`), or `0xFF` for every onboard profile; the all-profile operation also clears macros. HE30 Control includes typed protocol helpers for these two scopes, but its reset controls remain disabled until a matching default-profile JSON file is bundled and its schema is validated.

## Supported captured devices

| Model | VID:PID | Profiles |
| --- | --- | --- |
| HE30 | `19F5:FB27` | One |
| HE30 | `19F5:FB4C` | Three, with four layers each |
| GT60 | `19F5:FB79` | One |

Only the normal configuration interfaces are requested. Firmware-updater device IDs are not present in the application.

## Run locally

WebHID works in a secure context. Use `localhost` in desktop Chrome or Edge rather than opening `index.html` directly. For example, from this directory:

```powershell
python -m http.server 4173
```

Then open `http://localhost:4173` for live keyboard control, or `http://localhost:4173/json_editor/` for offline JSON editing.

JSON-only and demo modes do not require WebHID and work in other modern browsers.

## Safe workflow

1. Connect the keyboard and allow the complete active profile to be read.
2. Export a backup before tuning unfamiliar settings.
3. Make changes. Controls update only the local workspace.
4. Select **Apply to keyboard**, review the affected sections, and confirm.
5. Keep the keyboard connected while each changed bank is written and read back.

When a key mapped to Profile 1, Profile 2, or Profile 3 changes the onboard profile, the app listens for the keyboard's profile event and reloads that profile without requiring a reconnect. The current page stays open while its keymap, Hall settings, lighting, overview, and other profile-backed controls refresh. If the previous profile had staged edits, a recovery snapshot is stored in the browser before the live workspace changes profiles.

If a write or verification fails, the process stops and reports the failing section. The previously exported JSON remains available for recovery.

## Development checks

Run the dependency-free smoke test with Node.js:

```powershell
node smoke-test.cjs
```

The test validates syntax, protocol codec round trips, device filters, requested mappings, advanced-bank limits, static asset links, and the deliberate absence of firmware functionality.
