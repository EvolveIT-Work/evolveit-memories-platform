// apps/scanner/src/qr.ts
import jsQR from "jsqr";

export interface ParsedTicket {
  ticketId: string;
  totpCode: string;
}

const QR_PATTERN = /^EV1\.([^.]+)\.(\d{6})$/;

export function parseQrPayload(raw: string): ParsedTicket | null {
  const match = QR_PATTERN.exec(raw.trim());
  if (!match) return null;
  return { ticketId: match[1], totpCode: match[2] };
}

export async function startCamera(
  video: HTMLVideoElement,
  onDecode: (payload: string) => void
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });
  video.srcObject = stream;
  await video.play();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  let active = true;

  function tick() {
    if (!active) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) onDecode(code.data);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return () => {
    active = false;
    stream.getTracks().forEach((t) => t.stop());
  };
}