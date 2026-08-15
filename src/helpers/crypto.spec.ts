import {
  base64urlencode,
  encodedStringFromObject,
  generateRandomString,
  pkceChallengeFromVerifier,
  sha256,
} from "./crypto";

describe("crypto helpers", () => {
  it("sha256 returns the SHA-256 digest", async () => {
    const digest = await sha256("abc");
    expect(digest.byteLength).toBe(32);
    // Well-known SHA-256 test vector for "abc"
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(hex).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("pkceChallengeFromVerifier matches the RFC 7636 appendix B test vector", async () => {
    const challenge = await pkceChallengeFromVerifier(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    );
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("base64urlencode strips padding from the output", () => {
    const buffer = new TextEncoder().encode("hello world").buffer;
    // btoa("hello world") === "aGVsbG8gd29ybGQ="
    expect(base64urlencode(buffer)).toBe("aGVsbG8gd29ybGQ");
  });

  it("base64urlencode produces URL-safe output", () => {
    // Bytes chosen to produce '+', '/' and padding in standard base64
    const buffer = new Uint8Array([251, 255, 190]).buffer;
    const encoded = base64urlencode(buffer);
    expect(encoded).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("encodedStringFromObject URL-encodes values and joins with '&'", () => {
    expect(
      encodedStringFromObject({ a: "hello world", b: "x=y", c: 1 })
    ).toBe("a=hello%20world&b=x%3Dy&c=1");
  });

  it("encodedStringFromObject supports a custom separator", () => {
    expect(
      encodedStringFromObject({ a: "1", b: "2" }, encodeURIComponent, ";")
    ).toBe("a=1;b=2");
  });

  it("generateRandomString returns a 56 character lowercase hex string", () => {
    const value = generateRandomString();
    expect(value.length).toBe(56);
    expect(/^[0-9a-f]+$/.test(value)).toBeTrue();
  });

  it("generateRandomString generates unique values", () => {
    expect(generateRandomString()).not.toBe(generateRandomString());
  });
});
