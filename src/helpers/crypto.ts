export function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const hashed = await sha256(verifier);
  return base64urlencode(hashed);
}

export function base64urlencode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buffer))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function encodedStringFromObject(
  obj: Record<string, string | number | boolean>,
  encoding: (value: string) => string = encodeURIComponent,
  separator = "&",
) {
  return Object.keys(obj)
    .map((key) => {
      return `${key}=${encoding(String(obj[key]))}`;
    })
    .join(separator);
}

export function generateRandomString(): string {
  const array = new Uint32Array(28);
  crypto.getRandomValues(array);
  return Array.from(array, (dec) => ("0" + dec.toString(16)).substr(-2)).join(
    "",
  );
}
