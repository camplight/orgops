import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseMasterKey } from "./index";

describe("crypto", () => {
  it("encrypts and decrypts roundtrip", () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    const master = parseMasterKey(key);
    const cipher = encryptSecret(master, "hello");
    const plain = decryptSecret(master, cipher);
    expect(plain).toBe("hello");
  });
});
