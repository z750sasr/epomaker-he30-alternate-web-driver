import { APP_PID, BOOT_PID, DONOR_PID, VID, modeOf, usbId } from './protocol.mjs';

// The lab observed a reset after one output report. An output-transfer result
// alone cannot distinguish a successful reset from an unplug or a wrong device.
export async function beginRecovery(hid, transport, transition, log = () => {}) {
  const application = transport.device;
  if (![APP_PID, DONOR_PID].includes(application.productId) || application.vendorId !== VID) {
    throw new Error('Select the HE30 application interface first.');
  }
  if ((await hid.getDevices()).some(device => modeOf(device) === 'recovery')) {
    throw new Error('An AF22 recovery device is already visible. Disconnect it before entering recovery on another keyboard.');
  }
  transition.application = application;
  transition.sent = true;
  log('Sending recovery report ID 0 to ' + usbId(application) + '.');
  try {
    await transport.enterRecovery();
  } catch (error) {
    // Windows may report a failed transfer when the application resets during
    // sendReport. Keep observing the USB transition and do not send again.
    log('The recovery report ended with ' + error.message + '. Checking for ' + usbId({vendorId: VID, productId: BOOT_PID}) + '.');
  }
}
