const { Notification } = require("electron");

/** Generic desktop adapter inventory. Capability IDs never appear here. */
function adapterInventory() {
  return [
    available("file", "File selection and explicit export"),
    available("evidence", "SHA-256 hashing and proof packaging"),
    available("network", "User-initiated HTTPS requests"),
    Notification.isSupported() ? available("notification", "Native desktop notifications") : unavailable("notification", "Native notifications are unavailable on this platform"),
    unavailable("secureStore", "Keychain / Credential Manager integration has not been installed"),
    unavailable("capture.camera", "Webcam adapter has not been installed"),
    unavailable("capture.microphone", "Microphone adapter has not been installed"),
    unavailable("location", "Desktop location adapter has not been installed"),
    unavailable("device.bluetooth", "Bluetooth adapter has not been installed"),
    unavailable("device.usb", "USB adapter has not been installed"),
    unavailable("device.serial", "Serial adapter has not been installed")
  ];
}
function available(id, detail) { return { id, available: true, detail }; }
function unavailable(id, detail) { return { id, available: false, detail }; }
module.exports = { adapterInventory };
