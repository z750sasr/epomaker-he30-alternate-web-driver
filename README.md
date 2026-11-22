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

## HE30 Pro firmware and driver

The [HE30 Pro workspace](pro/) configures four onboard profiles, Main/Fn1/Fn2, Hall tuning, advanced actions and RGB for the keyboard and lightbar. [HE30 Pro v0.26](firmware/custom/he30-v0.26/README.md) seeds the captured profiles, corrects USB routing, and adds media keys, animation speed, and RGB sleep. Load it from [Recovery & firmware](flasher/). Open [Gamepad Mode](pro/?page=gamepad) to enable the Xbox-compatible controller and assign physical keys.

The [v0.20 test build](firmware/custom/he30-v0.20/README.md) adds onboard profile shortcuts and finer dead zones while retaining the v0.19 Save path. The updated Pro workspace also works with v0.19 for Advanced Keys, Remap, selection and distance display. See the [Zuoya V115 settings analysis](docs/zuoya-v115-stability.md) for the comparison with its scanner.

The [v0.21 test build](firmware/custom/he30-v0.21/README.md) adds NKRO with automatic 6KRO when the host requests HID Boot Protocol. See the [libhmk comparison](docs/libhmk-comparison.md) for the report layout and advanced feature differences.

Set the repository's **Settings → Pages → Source** to **GitHub Actions**. The Pages workflow publishes each push to `main` with commit-versioned JavaScript and CSS. Open tabs check the published version on first load, when visible again, and every 30 seconds while visible. The flasher defers a reload during a firmware update. Driver edits and preferences stay in the current tab. Use **Save changes** for onboard persistence or export a profile JSON.

# 20th Nov 26: custom firmware development in progress! jajajajaja
# 16th Nov 2026: This project has not been updated for 2 months, read my excuse below and I have some hopeful news for you guys
- I am still using this keyboard daily, just got 25k Red ratings on CS2 (dying game haha). I have no intention stop development of this project.
- Right now I am shifting development towards the Everglide AE64 Pro magnetic keyboard - yes I own both of them, play games using the HE30, typing using the Everglide AE64 Pro. Checkout [**Everglide AE64 Pro webdriver GitHub page**](https://github.com/tuk3kCS/everglide-ae64-pro-webdriver)
- All of the factory stock features of this keyboards are fully implemented (with additional thingy to). So the only thing I can improve on this project is the UI/UX - not worth it right now.

## **Hopeful news**: 
Before telling you guys the good news, I will tell you sad news first (:cry:):

- It is very likely that the OEM of this keyboard (the guys behind the epomaker.keybord web driver) dropped support for this keyboard, same like the other keyboards they made (Drunkdeer A75 series).
- This keyboard has no new firmware update since its release, still rocking the old factory firmware 0x0109, build Mar 29 2026,14:42:21
- For now, there is no way to extract the keyboard's firmware - OEM's webdriver gives out 404 when I tried to get the keyboard on their website - which means I cannot create a custom firmware for this keyboard. If you check out the AE64 Pro GitHub link I mention above, I was able to reverse AE64's firmware and created custom firmware that supports gamepad/controller mode and lighting settings that matches Wooting's features.

**Here comes the good news (hopefully):**

<table>
  <tr>
    <td><img src="images/WCHLinkE.jpg" alt="Black Epomaker HE30 keyboard" width="300"></td>
    <td><img src="images\W_Debug_pin.jpg" alt="White Epomaker HE30 keyboard" width="300"></td>
  </tr>
</table>

I have ordered this WCH-LinkE and the prob pins. Theoretically, if I can pull out some magic, I will be able to **read/extract the keyboard's firmware directly**. And finally, I can develop custom firmware for this keyboard, yippe! 
- I dream of many things haha - gamepad/controller mode, FN layers's custom lighting same as Wooting, multi-point trigger (One physical switch can emit two or three different key values as it travels deeper), end key (emit one output on press and another when the key reaches its end state).
- The processing power of the keyboard is superior to Wooting's offerings - so these features should be feasible.

Bonus: here is the picture of the HE30's pcb: 
<table><tr><img src="images\W_pcb.jpg" alt="White Epomaker HE30 keyboard" width="60%"></tr></table>

> [!IMPORTANT]
> The stock workspace edits profiles. Use [Recovery & firmware](flasher/) for application firmware updates.

## Open the Driver

Open the web driver here:

[**Launch HE30 Control**](https://z750sasr.github.io/epomaker-he30-alternate-web-driver/)

For live keyboard configuration, use a desktop version of:

* Google Chrome
* Microsoft Edge
* Another Chromium-based browser with WebHID support

Firefox and Safari do not currently support WebHID, but they can still be used with the offline JSON editor and demo mode.

## WHy do I make this when we already have the manufacturer's driver?

- Added (experimental) settings that are not displayed.
- Added new features, QoLs.
- Added new key map: MacOS's Siri and Launchpad keys, additional F13 to F24 keys for those nerds.
- Maybe better UX/UI interface? (subjective)
- Maybe one day, the manufacturer will end the suppport for this keyboard and shut the website down, but this project is deployed on GitHub, so maybe this would stay forever (unless the world is coming to and end or some god-level hacker vaporizes GitHub.
- Miscs

## Let's be real, who wants to read AI generated stuff? If you are, then read the part below.

- Direct WebHID connection for normal configuration mode
- Complete JSON profile import and export on the dedicated `/json_editor/` route
- Twelve remap layers across three profiles, with FN/FN1–FN11 targets, F1–F24, media, mouse, and internal functions
- Per-key Hall actuation, Rapid Trigger, supported travel resolution, and top/bottom dead zones
- Mouse, pen, and touch box-selection for tuning groups of Hall-effect keys together
- Live Hall travel monitor with per-key fill animation, switch cutaway, actuation marker, and millimeter readout
- Polling rate, tick rate, debounce, Windows/macOS mode, filtering, Tachyon, and shortcut locks
- All 24 original main-key lighting presets, all 5 light-strip effects, and their effect-specific controls
- Main-key lighting, the small light-strip zone, and saved colors for all 36 physical keys
- Live RGB framebuffer preview for all 36 keys, plus a live multi-segment light-strip preview synchronized from its onboard effect settings
- Onboard profile switching on multi-profile models
- Optional private MongoDB profile backup keyed by a server-side HMAC of the connected keyboard serial and protected by a separate passphrase
- Live profile and layer tracking: onboard profile-key presses automatically refresh every workspace page
- DKS, Mod-Tap, Toggle, Rappy Snappy, SOCD, combination keys, and macros
- Staged edits, explicit write confirmation, byte-for-byte read-back verification, and an in-browser recovery backup
- Local diagnostics and session-log export
- Automatic return to the connection screen when a connected keyboard is unplugged
- Browser keyboard-action suppression while hardware is connected, so Space, arrows, and remapped keys do not scroll or activate the page during testing

## Capture-derived compatibility notes

The separate [Recovery & firmware page](flasher/) supports the verified HE30 recovery-entry request and an experimental OEM-style firmware update sequence. It retains the selected image across USB re-enumeration, supports recovery-device authorization without refreshing, and saves logs. Read [flashing notes](docs/flashing.md) before use. Full live flashing and recovery after an incompatible image remain unvalidated; profile JSON is not a firmware/calibration backup.

Earlier diagnostic images are available for board and RGB work, including [v0.6 RGB foundation](firmware/custom/he30-v0.6/README.md), [v0.5 without RGB](firmware/custom/he30-v0.5/README.md) and [v0.4 hardware diagnostics](firmware/custom/he30-v0.4/README.md). Export profiles before a full-image reflash, which clears the journal.

- The original driver exposes travel resolution only for device types `101`, `102`, `103`, and `105`. Type `104` keeps its stored precision bits but does not expose an editor in either the original interface or this app.
- The available resolution steps are `0.01 mm`, `0.005 mm`, and `0.001 mm` for types `102`, `103`, and `105`; type `101` omits `0.001 mm`.
- Config byte 7 bit 0 is read under the internal name `tachyonMode`, while its unused setter is named `setBerserkMode`. The captured production interface does not call that setter, so HE30 Control preserves the bit without offering a toggle.
- Live travel uses the original software's Dynamic Display mechanism: config byte 7 bit 3 enables `0xA0` diagnostic reports. Starting the monitor enables that bit in the active profile's 64-byte config bank when necessary; stopping it restores the same profile bank. The stream is unavailable in JSON and demo workspaces.
- The same temporary Dynamic Display flag exposes command `0xDE`, a 384-byte RGB framebuffer. Its first 108 bytes are the live RGB triplets for the HE30's 36 physical keys. Captured HE30 firmware leaves the remaining slots zero, but the app watches the first 12 spare RGB slots for firmware variants that expose strip pixels there. Otherwise it refreshes the strip's real onboard effect settings from the profile config and renders a synchronized effect preview without writing to the device.
- The captured firmware layout exposes one saved per-key RGB bank per profile through commands `0x0A`/`0x0B`, while each profile has four separate key-mapping layers. `0xDE` has only been observed as a framebuffer read. Without a volatile RGB-frame write command or an onboard layer-to-lighting link, switching four static RGB banks on Fn press is not safe to implement; rewriting the saved bank on every press/release would be slow and could wear flash.
- The original factory-reset flow sends subcommand `0xEE` with the active profile index (`0`–`2`), or `0xFF` for every onboard profile; the all-profile operation also clears macros. HE30 Control includes typed protocol helpers for these two scopes, but its reset controls remain disabled until a matching default-profile JSON file is bundled and its schema is validated.

## Supported Devices

| Model         | VID:PID     | Supported Profiles                    |
| ------------- | ----------- | ------------------------------------- |
| Epomaker HE30 | `19F5:FB4C` | Three profiles, with four layers each |

Based on AI Analysis, the original driver site https://epomaker.keybord.net.cn/ also supports 2 more models:
| Epomaker GT60 | `19F5:FB79` | One profile                           |
| Epomaker HE30 | `19F5:FB27` | One profile                           |

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

## Optional MongoDB Cloud Backup

GitHub Pages cannot run a database server or safely keep a MongoDB connection
string. The optional cloud panel therefore talks to a separate Node.js API in
[`server/`](server/README.md). Deploy that folder, configure its MongoDB and
CORS environment variables, then set the `he30-cloud-api` meta tag in
`index.html` to the API's HTTPS URL. Until that URL is configured, the cloud
panel remains visible in setup mode and its upload/restore buttons stay disabled.

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

New contributors should read [the architecture guide](docs/ARCHITECTURE.md). It
explains the source-module load order, staged editing model, profile/layer data,
protocol codecs, WebHID verification flow, and where each type of change belongs.

The test checks:

* JavaScript syntax
* Protocol-codec round trips
* Device filters
* Requested mappings
* Advanced-bank limits
* Static asset links
* The intentional absence of firmware-update functionality
