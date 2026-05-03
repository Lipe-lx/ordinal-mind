// AES-256-GCM at-rest encryption for sensitive data stored in localStorage.
// Used when the user connects Discord — LLM keys are encrypted before persistence.
//
// Security model:
//   - Device key: generated once per device, stored in localStorage as base64
//   - Encrypt: AES-256-GCM with random 12-byte IV per operation
//   - Stored format: JSON { ct: base64(ciphertext), iv: base64(IV) }
//
// Effective protection against:
//   - Physical dump of localStorage SQLite file
//   - Extensions that read raw localStorage values
//   - Casual DevTools inspection
//
// Honest limitation:
//   - Active XSS on same origin can call decryptConfig() — mitigate with CSP headers

const DEVICE_KEY_STORAGE = "ordinal-mind_device_key"

export interface EncryptedPayload {
  ct: string  // base64 ciphertext
  iv: string  // base64 IV (12 bytes)
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str)
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Get or create the device AES-256-GCM key.
 * The key material is persisted in localStorage as base64 raw bytes.
 */
async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  let rawBase64 = localStorage.getItem(DEVICE_KEY_STORAGE)

  if (!rawBase64) {
    // Generate new 256-bit AES key
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true, // extractable so we can persist it
      ["encrypt", "decrypt"]
    )
    const exported = await crypto.subtle.exportKey("raw", key)
    rawBase64 = toBase64(exported)
    localStorage.setItem(DEVICE_KEY_STORAGE, rawBase64)
    return key
  }

  // Import existing key
  return crypto.subtle.importKey(
    "raw",
    fromBase64(rawBase64).buffer as ArrayBuffer,
    { name: "AES-GCM", length: 256 },
    false, // not extractable after import (defense-in-depth)
    ["encrypt", "decrypt"]
  )
}

/**
 * Encrypt any serializable value using AES-256-GCM.
 * Returns an EncryptedPayload suitable for localStorage storage.
 */
export async function encryptValue<T>(value: T): Promise<EncryptedPayload> {
  const key = await getOrCreateDeviceKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(value))
  )
  return {
    ct: toBase64(ciphertext),
    iv: toBase64(iv.buffer as ArrayBuffer),
  }
}

/**
 * Decrypt an EncryptedPayload back to the original value.
 * Returns null if decryption fails (tampered data, wrong key, corrupted).
 */
export async function decryptValue<T>(payload: EncryptedPayload): Promise<T | null> {
  try {
    const key = await getOrCreateDeviceKey()
    const ivBuf = fromBase64(payload.iv)
    const ctBuf = fromBase64(payload.ct)
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBuf.buffer as ArrayBuffer },
      key,
      ctBuf.buffer as ArrayBuffer
    )
    const json = new TextDecoder().decode(plaintext)
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/**
 * Check if there is an existing device key (used to determine if encryption is initialized).
 */
export function hasDeviceKey(): boolean {
  return localStorage.getItem(DEVICE_KEY_STORAGE) !== null
}

/**
 * Remove the device key from localStorage.
 * WARNING: This permanently destroys any data encrypted with this key.
 * Only call this if the encrypted data has already been cleared.
 */
export function clearDeviceKey(): void {
  localStorage.removeItem(DEVICE_KEY_STORAGE)
}
