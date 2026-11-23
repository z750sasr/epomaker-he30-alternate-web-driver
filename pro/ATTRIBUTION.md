The HE30 Pro workspace reuses the welcome and initialization screens, navigation markup, key-value picker, and styles from the user-provided Everglide AE64 Pro Webdriver revision c3c600e4b733375177bb4bcd5e5799755c30be55. The Nunito Sans assets include their SIL Open Font License in fonts/OFL.txt. Switch names, nominal travel and coefficients come from the AE64 catalog at that same revision. Those metadata records are provided for the user's HE30 port. No switch images or proprietary Wootility app code were included.

The HE30 application uses its own device protocol and editors. See the [firmware notes](../firmware/custom/he30-v0.11/README.md) for the calibration, scan, power and storage evidence.

The Gamepad studio styles and controller icons, and the Remap workspace and catalog interaction, were ported from the local Everglide AE64 Pro Webdriver. HE30 uses its 36-key layout, three layers and H3K11 protocol. The Remap catalog contains the keyboard and Fn outputs implemented by this firmware.

The v0.28 Gamepad, Remap and RGB workspaces follow the Reloaded layouts in Everglide AE64 Pro Webdriver `c3c600e4b733375177bb4bcd5e5799755c30be55`. The copied `assets/remap-icons.svg` retains the original Wootility glyph attribution and permission notice. The browser tester reads controller input through the [Gamepad API](https://www.w3.org/TR/gamepad/#dom-navigator-getgamepads).
