// apps/scanner/src/main.ts
import { loginDoorDevice, getStoredSession, type DeviceSession } from "./login";
import { startCamera, parseQrPayload } from "./qr";
import { postScan } from "./api";
import { renderResult, clearResult } from "./states";

const loginScreen = document.getElementById("login-screen")!;
const scanScreen = document.getElementById("scan-screen")!;
const hubUrlInput = document.getElementById("hub-url") as HTMLInputElement;
const deviceIdInput = document.getElementById("device-id") as HTMLInputElement;
const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const loginBtn = document.getElementById("login-btn")!;
const loginError = document.getElementById("login-error")!;
const video = document.getElementById("camera") as HTMLVideoElement;
const overlay = document.getElementById("result-overlay")!;

let session: DeviceSession | null = getStoredSession();
let locked = false;

async function boot() {
  if (session) {
    hubUrlInput.value = session.hubLanUrl;
    await showScanScreen();
    return;
  }

  loginBtn.addEventListener("click", async () => {
    try {
      loginError.textContent = "";
      session = await loginDoorDevice(
        deviceIdInput.value.trim(),
        apiKeyInput.value.trim(),
        hubUrlInput.value.trim()
      );
      await showScanScreen();
    } catch {
      loginError.textContent = "Login failed. Check the hub URL and device credentials.";
    }
  });
}

async function showScanScreen() {
  loginScreen.classList.add("hidden");
  scanScreen.classList.remove("hidden");

  await startCamera(video, async (payload) => {
    if (locked) return;
    const parsed = parseQrPayload(payload);
    if (!parsed) {
      renderResult(overlay, "invalid_code", null);
      lockAndReset();
      return;
    }

    locked = true;
    const { state, detail } = await postScan(session!, parsed.ticketId, parsed.totpCode);
    renderResult(overlay, state, detail);
    lockAndReset();
  });
}

function lockAndReset() {
  setTimeout(() => {
    clearResult(overlay);
    locked = false;
  }, 2000);
}

boot();