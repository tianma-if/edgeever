import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_UPDATE_KEY_ID,
  WINDOWS_UPDATE_PUBLIC_KEY_PEM,
  WINDOWS_UPDATE_SIGNATURE_NAME,
  verifyWindowsUpdateMetadata,
} from "../apps/desktop/src/main/windows-update-trust.mjs";

const normalizedPublicKey = (key) => (key?.type === "public" ? key : createPublicKey(key)).export({
  type: "spki",
  format: "pem",
}).trim();

export const assertWindowsUpdateSigningKey = ({
  privateKeyPath,
  expectedPublicKey = WINDOWS_UPDATE_PUBLIC_KEY_PEM,
}) => {
  if (!privateKeyPath) {
    throw new Error("EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY must point to the offline Ed25519 private key");
  }
  const privateKey = createPrivateKey(readFileSync(privateKeyPath, "utf8"));
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Windows update signing key must be Ed25519");
  }
  const derivedPublicKey = normalizedPublicKey(createPublicKey(privateKey));
  if (derivedPublicKey !== normalizedPublicKey(expectedPublicKey)) {
    throw new Error("Windows update signing key does not match the public key pinned in the desktop client");
  }
  return privateKey;
};

export const signWindowsUpdateManifest = ({
  manifestPath,
  signaturePath,
  privateKeyPath,
  expectedPublicKey = WINDOWS_UPDATE_PUBLIC_KEY_PEM,
}) => {
  const privateKey = assertWindowsUpdateSigningKey({ privateKeyPath, expectedPublicKey });
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest?.schemaVersion !== 1 || manifest.keyId !== WINDOWS_UPDATE_KEY_ID) {
    throw new Error("Windows update manifest key metadata is invalid");
  }
  const envelope = {
    schemaVersion: 1,
    keyId: WINDOWS_UPDATE_KEY_ID,
    signature: sign(null, manifestBytes, privateKey).toString("base64"),
  };
  const signatureBytes = Buffer.from(`${JSON.stringify(envelope)}\n`);
  verifyWindowsUpdateMetadata({
    manifestBytes,
    signatureBytes,
    expectedVersion: manifest.version,
    updateInfo: {
      version: manifest.version,
      files: [{
        url: manifest.file?.name,
        size: manifest.file?.size,
        sha512: manifest.file?.sha512,
      }],
    },
    trustedPublicKeys: { [WINDOWS_UPDATE_KEY_ID]: expectedPublicKey },
  });
  writeFileSync(signaturePath, signatureBytes, { mode: 0o644 });
  return envelope;
};

const run = () => {
  const [manifestValue, signatureValue] = process.argv.slice(2);
  if (!manifestValue) {
    throw new Error("Usage: node scripts/sign-windows-update-manifest.mjs <manifest> [signature]");
  }
  const manifestPath = resolve(manifestValue);
  const signaturePath = resolve(signatureValue || `${manifestPath}.sig`);
  if (!signaturePath.endsWith(WINDOWS_UPDATE_SIGNATURE_NAME)) {
    throw new Error(`Signature filename must end with ${WINDOWS_UPDATE_SIGNATURE_NAME}`);
  }
  signWindowsUpdateManifest({
    manifestPath,
    signaturePath,
    privateKeyPath: process.env.EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY,
  });
  process.stdout.write(`${signaturePath}\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
