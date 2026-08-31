import { describe, expect, test } from "bun:test";
import { isVisualCppRuntimeDll, readPeImportedDlls } from "./pe-imports.mjs";

const peWithImport = (dllName) => {
  const bytes = Buffer.alloc(0x400);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(0x80, 0x3c);
  bytes.write("PE\0\0", 0x80, "ascii");
  const coff = 0x84;
  bytes.writeUInt16LE(0x8664, coff);
  bytes.writeUInt16LE(1, coff + 2);
  bytes.writeUInt16LE(0xf0, coff + 16);
  const optional = coff + 20;
  bytes.writeUInt16LE(0x20b, optional);
  bytes.writeUInt32LE(16, optional + 108);
  bytes.writeUInt32LE(0x1000, optional + 120);
  bytes.writeUInt32LE(40, optional + 124);
  const section = optional + 0xf0;
  bytes.write(".rdata", section, "ascii");
  bytes.writeUInt32LE(0x200, section + 8);
  bytes.writeUInt32LE(0x1000, section + 12);
  bytes.writeUInt32LE(0x200, section + 16);
  bytes.writeUInt32LE(0x200, section + 20);
  bytes.writeUInt32LE(0x1040, 0x200);
  bytes.writeUInt32LE(0x1080, 0x20c);
  bytes.writeUInt32LE(0x1040, 0x210);
  bytes.write(`${dllName}\0`, 0x280, "ascii");
  return bytes;
};

describe("PE imports", () => {
  test("reads imported DLL names from a PE32+ image", () => {
    expect(readPeImportedDlls(peWithImport("VCRUNTIME140.dll"))).toEqual(["VCRUNTIME140.dll"]);
  });

  test("identifies Visual C++ runtime dependencies", () => {
    expect(isVisualCppRuntimeDll("VCRUNTIME140.dll")).toBe(true);
    expect(isVisualCppRuntimeDll("MSVCP140_1.dll")).toBe(true);
    expect(isVisualCppRuntimeDll("KERNEL32.dll")).toBe(false);
  });
});
