import crypto from "node:crypto";
import { sanitizeReply } from "../worker/openai";

// Self-contained smoke test for core, network-free logic:
//  - AES session encryption round-trips correctly
//  - model reply sanitization strips quotes / name prefixes
// Run with: npm run smoke

let failures = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
};

const main = async () => {
  // Use an ephemeral key so the test doesn't depend on env.
  process.env.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  const { encryptSession, decryptSession } = await import("../lib/crypto");

  const secret = "1AaBbCc-fake-string-session-" + crypto.randomUUID();
  const enc = encryptSession(secret);
  check("encryption produces different ciphertext", enc !== secret);
  check("decryption round-trips", decryptSession(enc) === secret);
  check(
    "tampered ciphertext is rejected",
    (() => {
      try {
        decryptSession(enc.slice(0, -4) + "AAAA");
        return false;
      } catch {
        return true;
      }
    })()
  );

  check(
    'sanitize strips wrapping quotes',
    sanitizeReply('"hello there"', "Alice") === "hello there"
  );
  check(
    "sanitize strips name prefix",
    sanitizeReply("Alice: stop it", "Alice") === "stop it"
  );
  check(
    "sanitize leaves clean text untouched",
    sanitizeReply("just a normal message", "Bob") === "just a normal message"
  );

  console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
};

void main();
