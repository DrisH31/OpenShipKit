//
// Rotating the auth secret without breaking two-factor (docs/auth.md →
// "Rotating the secret"). Pins the Better Auth behaviour the recipe relies on:
// with BETTER_AUTH_SECRETS set, the newest key signs sessions and encrypts new
// data, values encrypted earlier under BETTER_AUTH_SECRET (no version) still
// decrypt, and a retired version no longer does. If a Better Auth upgrade
// changes any of that, this fails before the docs mislead someone mid-incident.
//

import { afterEach, describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

const OLD = "old-secret-old-secret-old-secret-0123456789";
const NEW = "new-secret-new-secret-new-secret-9876543210";
const NEWER = "newer-secret-newer-secret-newer-secret-55555";

const saved = process.env.BETTER_AUTH_SECRETS;
afterEach(() => {
  if (saved === undefined) delete process.env.BETTER_AUTH_SECRETS;
  else process.env.BETTER_AUTH_SECRETS = saved;
});

/** The secret configuration Better Auth builds for the app's options (secret: BETTER_AUTH_SECRET) and the env. */
async function contextFor(secrets: string | undefined) {
  if (secrets === undefined) delete process.env.BETTER_AUTH_SECRETS;
  else process.env.BETTER_AUTH_SECRETS = secrets;
  const auth = betterAuth({
    secret: OLD,
    baseURL: "http://localhost:3000",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    logger: { disabled: true },
  });
  return auth.$context;
}

describe("rotating BETTER_AUTH_SECRET with BETTER_AUTH_SECRETS", () => {
  it("keeps 2FA data written before the rotation readable, and signs sessions with the new key", async () => {
    const before = await contextFor(undefined);
    // A TOTP secret stored before any rotation: encrypted with BETTER_AUTH_SECRET, no version.
    const stored = await symmetricEncrypt({ key: before.secretConfig, data: "JBSWY3DPEHPK3PXP" });

    const after = await contextFor(`1:${NEW}`);
    expect(after.secret).toBe(NEW); // session cookies are signed with the new key: everyone signs in again
    expect(await symmetricDecrypt({ key: after.secretConfig, data: stored })).toBe("JBSWY3DPEHPK3PXP");

    // New 2FA data is encrypted with version 1, which the old secret alone can't read.
    const fresh = await symmetricEncrypt({ key: after.secretConfig, data: "KRSXG5DSNFXGOIDB" });
    expect(fresh.startsWith("$ba$1$")).toBe(true);
    await expect(symmetricDecrypt({ key: before.secretConfig, data: fresh })).rejects.toThrow();
  });

  it("a later rotation keeps every listed version, and retiring one makes its data unreadable", async () => {
    const v1 = await contextFor(`1:${NEW}`);
    const underV1 = await symmetricEncrypt({ key: v1.secretConfig, data: "under-v1" });

    const v2 = await contextFor(`2:${NEWER},1:${NEW}`);
    expect(v2.secret).toBe(NEWER);
    expect(await symmetricDecrypt({ key: v2.secretConfig, data: underV1 })).toBe("under-v1");

    const retired = await contextFor(`2:${NEWER}`);
    await expect(symmetricDecrypt({ key: retired.secretConfig, data: underV1 })).rejects.toThrow(/version 1/);
  });
});
