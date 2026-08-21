type ClientUuidCrypto = {
  randomUUID?(): string;
  getRandomValues(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
};

function getBrowserCrypto(): ClientUuidCrypto {
  const cryptoApi = globalThis.crypto;
  const getRandomValues = (bytes: Uint8Array<ArrayBuffer>) =>
    cryptoApi.getRandomValues(bytes);
  return typeof cryptoApi.randomUUID === "function"
    ? { randomUUID: () => cryptoApi.randomUUID(), getRandomValues }
    : { getRandomValues };
}

export function createClientUuid(cryptoApi = getBrowserCrypto()): string {
  if (typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
