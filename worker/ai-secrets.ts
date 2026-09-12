export async function sealSecret(
  master: string,
  value: string,
  context: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(master), (c) => c.charCodeAt(0)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(value),
  );
  return {
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
  };
}
export async function openSecret(
  master: string,
  row: { iv: string; ciphertext: string },
  context: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(master), (c) => c.charCodeAt(0)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const bytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: Uint8Array.from(atob(row.iv), (c) => c.charCodeAt(0)),
      additionalData: new TextEncoder().encode(context),
    },
    key,
    Uint8Array.from(atob(row.ciphertext), (c) => c.charCodeAt(0)),
  );
  return new TextDecoder().decode(bytes);
}
