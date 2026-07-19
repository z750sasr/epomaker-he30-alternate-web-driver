https://z750sasr.github.io/epomaker-he30-alternate-web-driver/

<table>
  <tr>
    <td><img src="images/EPOMAKERHE30_black.webp" alt="Black Epomaker HE30 keyboard" width="300"></td>
    <td><img src="images/EPOMAKERHE30_white.webp" alt="White Epomaker HE30 keyboard" width="300"></td>
  </tr>
</table>

# Custom Web Driver for EPOMAKER HE30 Keyboard

A simple web-based configuration tool for supported Epomaker HE30-family Hall-effect keyboards.

Use it to change key mappings, Hall-effect settings, lighting, profiles, macros, and other keyboard options directly from your browser. Nothing needs to be installed, and your keyboard data stays on your computer.

> [!WARNING]
>
> ## Lighting Settings Are Still Under Development
>
> LED-related settings are currently still under development. The **Lighting** tab may be buggy, and some controls may not work as expected.
>
> Export a configuration backup before changing lighting settings. Avoid disconnecting the keyboard while changes are being applied.

> [!IMPORTANT]
> Firmware updates and bootloader flashing are not supported.

## Open the Driver

Open the web driver here:

[**Launch HE30 Control**](https://z750sasr.github.io/epomaker-he30-alternate-web-driver/)

For live keyboard configuration, use a desktop version of:

* Google Chrome
* Microsoft Edge
* Another Chromium-based browser with WebHID support

Firefox and Safari do not currently support WebHID, but they can still be used with the offline JSON editor and demo mode.

## Getting Started

1. Connect your keyboard to your computer with a USB cable.
2. Open the web driver in Chrome or Edge.
3. Click **Connect keyboard**.
4. Select your keyboard in the browser permission window.
5. Wait for the current keyboard profile to finish loading.
6. Export a backup before changing unfamiliar settings.
7. Make your changes.
8. Click **Apply to keyboard**.
9. Review the changes and confirm the write.

> [!WARNING]
> Keep the keyboard connected until the write and verification process is complete.

Changes made in the interface are staged locally first. They are not written to the keyboard until you click **Apply to keyboard** and confirm.

## Features

### Key Remapping

Configure up to twelve layers across supported profiles.

Available mappings include:

* Standard keyboard keys
* FN and FN1–FN11 functions
* F1–F24
* Media controls
* Mouse controls
* Internal keyboard functions
* Profile-switching keys
* Macros

### Hall-Effect Settings

Configure Hall-effect behavior for individual keys or groups of keys:

* Actuation distance
* Rapid Trigger
* Top dead zone
* Bottom dead zone
* Supported travel-resolution settings
* Drag-selection using a mouse, pen, or touchscreen

### Live Travel Monitor

View switch movement in real time, including:

* Per-key travel animation
* Switch cutaway view
* Current travel distance in millimeters
* Actuation-point marker

The live monitor is available only while a supported keyboard is connected.

### Advanced Key Functions

Configure supported advanced behaviors:

* Dynamic Keystroke, or DKS
* Mod-Tap
* Toggle keys
* Rappy Snappy
* SOCD
* Combination keys
* Macros

### Keyboard Settings

Depending on the connected model, you can configure:

* Polling rate
* Tick rate
* Debounce
* Windows or macOS mode
* Input filtering
* Shortcut locks
* Main lighting
* Logo lighting
* Per-key colors
* Onboard profiles

## Automatic Profile Tracking

On models with multiple onboard profiles, pressing a profile-switching key on the keyboard automatically updates the driver.

The current page stays open while the following information refreshes:

* Key mappings
* Hall settings
* Lighting
* Profile overview
* Other profile-specific controls

If you have unsaved changes when switching profiles, the driver stores a recovery snapshot in your browser before loading the new profile.

## Backup and Recovery

Before making major changes, export a backup of your keyboard configuration.

The driver provides:

* Complete JSON profile export
* Complete JSON profile import
* An offline JSON editor
* In-browser recovery snapshots
* Read-back verification after writing
* Local diagnostic information
* Session-log export

Open the offline JSON editor here:

[**Open JSON Editor**](https://z750sasr.github.io/epomaker-he30-alternate-web-driver/json_editor/)

The JSON editor does not require a connected keyboard and can be used in browsers without WebHID support.

## Recommended Safe Workflow

1. Connect the keyboard and allow the complete active profile to load.
2. Export a JSON backup.
3. Make your changes.
4. Click **Apply to keyboard**.
5. Review the affected configuration sections.
6. Confirm the write.
7. Keep the keyboard connected until verification finishes.

After writing each changed configuration bank, the driver reads it back and verifies it byte for byte.

If a write or verification fails, the process stops and reports which section failed. Your exported JSON backup can then be used for recovery.

## Supported Devices

| Model         | VID:PID     | Supported Profiles                    |
| ------------- | ----------- | ------------------------------------- |
| Epomaker HE30 | `19F5:FB27` | One profile                           |
| Epomaker HE30 | `19F5:FB4C` | Three profiles, with four layers each |
| Epomaker GT60 | `19F5:FB79` | One profile                           |

Only normal keyboard-configuration interfaces are requested.

Firmware-updater and bootloader device IDs are not included in the application.

## Disconnect and Testing Behavior

If the keyboard is unplugged while connected, the driver automatically returns to the connection screen.

While the keyboard is connected, the webpage also suppresses normal browser actions caused by keyboard input. This prevents keys such as Space, arrow keys, or remapped keys from scrolling the page or activating webpage controls while you test them.

## Running Locally

The hosted version is recommended for most users.

To run the driver locally, WebHID requires a secure context. Use `localhost` instead of opening `index.html` directly.

From the project directory, run:

```powershell
python -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

For the offline JSON editor, open:

```text
http://localhost:4173/json_editor/
```

JSON-only mode and demo mode do not require WebHID.

## Technical Compatibility Notes

These details are mainly useful for developers and advanced users.

* The original driver exposes travel-resolution controls only for device types `101`, `102`, `103`, and `105`.
* Device type `104` retains its stored precision bits, but neither the original driver nor this application exposes a resolution editor for it.
* Device types `102`, `103`, and `105` support `0.01 mm`, `0.005 mm`, and `0.001 mm` resolution options.
* Device type `101` supports `0.01 mm` and `0.005 mm`, but not `0.001 mm`.
* Config byte 7, bit 0 is read internally as `tachyonMode`.
* The unused setter for that bit is named `setBerserkMode`.
* The captured production interface does not use that setter, so this driver preserves the stored value without exposing a separate toggle.
* The live travel monitor uses the original software's Dynamic Display mechanism.
* Config byte 7, bit 3 enables `0xA0` diagnostic reports.
* Starting the live monitor enables that bit in the active profile's 64-byte configuration bank when required.
* Stopping the monitor restores the same profile bank.
* Live diagnostic travel data is not available in JSON-only or demo workspaces.

## Development Checks

Developers can run the dependency-free smoke test using Node.js:

```powershell
node smoke-test.cjs
```

The test checks:

* JavaScript syntax
* Protocol-codec round trips
* Device filters
* Requested mappings
* Advanced-bank limits
* Static asset links
* The intentional absence of firmware-update functionality
