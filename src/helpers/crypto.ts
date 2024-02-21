export function sha256(plain: any) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

export async function pkceChallengeFromVerifier(v: any) {
  const hashed = await sha256(v);
  return base64urlencode(hashed);
}

export function base64urlencode(str: any): string {
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(str))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function encodedStringFromObject(
  o: any,
  encoding: (arg0: string) => string = encodeURIComponent,
  seperator = "&",
) {
  return Object.keys(o)
    .map((key) => {
      return `${key}=${encoding(o[key])}`;
    })
    .join(seperator);
}

export function generateRandomString(): string {
  const array = new Uint32Array(28);
  crypto.getRandomValues(array);
  return Array.from(array, (dec) => ("0" + dec.toString(16)).substr(-2)).join(
    "",
  );
}
