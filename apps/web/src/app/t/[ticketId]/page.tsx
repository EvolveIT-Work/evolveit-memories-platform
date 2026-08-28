"use client";
import React, { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase-browser';

// Minimal client page for /t/[ticketId]
// Flow:
// 1. User enters phone OTP (stubbed)
// 2. POST to /api/live-ticket-session with ticket_id and x-phone-otp header
// 3. Receive session_token and secret_b64
// 4. Use Web Crypto to compute TOTP codes locally and display EV1.{session_token}.{code}

function base64ToUint8Array(b64: string) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function generateTotpCode(secretB64: string, forTimeMs = Date.now()) {
  const secret = base64ToUint8Array(secretB64);
  const step = 30;
  const counter = Math.floor(forTimeMs / 1000 / step);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  // big-endian
  const high = Math.floor(counter / 2 ** 32);
  const low = counter >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);

  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer));
  const offset = signature[signature.length - 1] & 0x0f;
  const code = ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  const otp = (code % 10 ** 6).toString().padStart(6, '0');
  return otp;
}

export default function LiveTicketPage({ params }: { params: { ticketId: string } }) {
  const ticketId = params.ticketId;
  const [otp, setOtp] = useState('');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [secretB64, setSecretB64] = useState<string | null>(null);
  const [currentCode, setCurrentCode] = useState('------');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!secretB64) return;
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      const code = await generateTotpCode(secretB64, Date.now());
      setCurrentCode(code);
    }

    tick();
    timerRef.current = window.setInterval(tick, 1000 * 30);

    return () => {
      cancelled = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [secretB64]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Call server route
    const res = await fetch('/api/live-ticket-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-phone-otp': otp },
      body: JSON.stringify({ ticket_id: ticketId })
    });
    const body = await res.json();
    if (res.ok && body.session_token && body.secret_b64) {
      setSessionToken(body.session_token);
      setSecretB64(body.secret_b64);
    } else {
      alert('failed to create session: ' + (body?.error ?? res.statusText));
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Live Ticket {ticketId}</h1>
      {!sessionToken ? (
        <form onSubmit={handleSubmit}>
          <label>
            Enter phone OTP (stub):
            <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="stub-otp" />
          </label>
          <button type="submit">Open Live Session</button>
        </form>
      ) : (
        <div>
          <p>Session: {sessionToken}</p>
          <p>QR (in-memory only):</p>
          <div style={{ fontFamily: 'monospace', fontSize: 18, padding: 10, border: '1px solid #ddd' }}>
            {`EV1.${ticketId}.${currentCode}`}
          </div>
          <p>Do not refresh — secret held in browser memory only.</p>
        </div>
      )}
    </div>
  );
}
