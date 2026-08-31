import { readFileSync } from "node:fs";

const readCString = (bytes, offset, maxLength = 260) => {
  const endLimit = Math.min(bytes.length, offset + maxLength);
  let end = offset;
  while (end < endLimit && bytes[end] !== 0) end += 1;
  if (end === endLimit) throw new Error("PE import name is not null-terminated");
  return bytes.toString("ascii", offset, end);
};

export const readPeImportedDlls = (input) => {
  const bytes = Buffer.isBuffer(input) ? input : readFileSync(input);
  if (bytes.length < 0x40 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Invalid PE DOS header");

  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 24 > bytes.length || bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error("Invalid PE signature");
  }

  const coffOffset = peOffset + 4;
  const sectionCount = bytes.readUInt16LE(coffOffset + 2);
  const optionalHeaderSize = bytes.readUInt16LE(coffOffset + 16);
  const optionalHeaderOffset = coffOffset + 20;
  const optionalHeaderMagic = bytes.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset = optionalHeaderOffset + (optionalHeaderMagic === 0x20b ? 112 : optionalHeaderMagic === 0x10b ? 96 : 0);
  if (!dataDirectoryOffset || dataDirectoryOffset + 16 > bytes.length) throw new Error("Unsupported PE optional header");

  const importTableRva = bytes.readUInt32LE(dataDirectoryOffset + 8);
  const importTableSize = bytes.readUInt32LE(dataDirectoryOffset + 12);
  if (!importTableRva || !importTableSize) return [];

  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTableOffset + index * 40;
    if (offset + 40 > bytes.length) throw new Error("PE section table is truncated");
    sections.push({
      virtualSize: bytes.readUInt32LE(offset + 8),
      virtualAddress: bytes.readUInt32LE(offset + 12),
      rawSize: bytes.readUInt32LE(offset + 16),
      rawOffset: bytes.readUInt32LE(offset + 20),
    });
  }

  const fileOffsetFromRva = (rva) => {
    const section = sections.find(({ virtualAddress, virtualSize, rawSize }) =>
      rva >= virtualAddress && rva < virtualAddress + Math.max(virtualSize, rawSize));
    if (!section) throw new Error(`PE RVA is outside every section: 0x${rva.toString(16)}`);
    const offset = section.rawOffset + (rva - section.virtualAddress);
    if (offset >= bytes.length) throw new Error("PE RVA points outside the file");
    return offset;
  };

  const imports = [];
  let descriptorOffset = fileOffsetFromRva(importTableRva);
  const descriptorLimit = Math.min(bytes.length, descriptorOffset + importTableSize);
  while (descriptorOffset + 20 <= descriptorLimit) {
    const originalFirstThunk = bytes.readUInt32LE(descriptorOffset);
    const nameRva = bytes.readUInt32LE(descriptorOffset + 12);
    const firstThunk = bytes.readUInt32LE(descriptorOffset + 16);
    if (originalFirstThunk === 0 && nameRva === 0 && firstThunk === 0) break;
    if (!nameRva) throw new Error("PE import descriptor has no DLL name");
    imports.push(readCString(bytes, fileOffsetFromRva(nameRva)));
    descriptorOffset += 20;
  }
  return imports;
};

export const isVisualCppRuntimeDll = (name) => /^(?:vcruntime|msvcp|concrt)\d[^/\\]*\.dll$/i.test(name);
