type ClientCrypto = Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">>;

const fillWithPseudoRandomBytes = (bytes: Uint8Array) => {
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
};

export const createClientUuid = (cryptoApi: ClientCrypto | null | undefined = globalThis.crypto) => {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    fillWithPseudoRandomBytes(bytes);
  }

  // RFC 4122 version 4 and variant bits. getRandomValues remains available in
  // browsers on plain-HTTP LAN origins where randomUUID is intentionally hidden.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};
