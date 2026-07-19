# HE30 Control

A dependency-free, local-first configuration studio for supported Epomaker HE30-family Hall-effect keyboards. It runs as static files, so it can be hosted directly on GitHub Pages. The main route is dedicated to live hardware configuration; `/json_editor/` is the separate offline backup editor.

## Included

- Direct WebHID connection for normal configuration mode
- Complete JSON profile import and export on the dedicated `/json_editor/` route
- Four remap layers with F1–F24, Fn1–Fn3, profiles, media, mouse, and internal functions
- Per-key Hall actuation, Rapid Trigger, supported travel resolution, and top/bottom dead zones
- Mouse, pen, and touch drag-selection for tuning groups of Hall-effect keys together
- Live Hall travel monitor with per-key fill animation, switch cutaway, actuation marker, and millimeter readout
- Polling rate, tick rate, debounce, Windows/macOS mode, filtering, Tachyon, and shortcut locks
- Main/logo lighting plus per-key colors
- Onboard profile switching on multi-profile models
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
- Live travel uses the original software's Dynamic Display mechanism: config byte 7 bit 3 enables `0xA0` diagnostic reports. Starting the monitor explicitly enables that bit when necessary; stopping it restores the previous value. The stream is unavailable in JSON and demo workspaces.

## Supported captured devices

| Model | VID:PID | Profiles |
| --- | --- | --- |
| HE30 | `19F5:FB27` | One |
| HE30 | `19F5:FB4C` | Four |
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

If a write or verification fails, the process stops and reports the failing section. The previously exported JSON remains available for recovery.

## Development checks

Run the dependency-free smoke test with Node.js:

```powershell
node smoke-test.cjs
```

The test validates syntax, protocol codec round trips, device filters, requested mappings, advanced-bank limits, static asset links, and the deliberate absence of firmware functionality.
