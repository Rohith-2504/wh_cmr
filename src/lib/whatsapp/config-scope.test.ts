import { describe, expect, it } from "vitest";

import { getWhatsAppConfigScope } from "@/lib/whatsapp/config-scope";

describe("getWhatsAppConfigScope", () => {
  it("uses user_id in legacy single-user mode", () => {
    expect(
      getWhatsAppConfigScope({
        userId: "user-1",
        accountId: "user-1",
        legacyAccountSharing: true,
      }),
    ).toEqual({ column: "user_id", value: "user-1" });
  });

  it("uses account_id after account-sharing migration", () => {
    expect(
      getWhatsAppConfigScope({
        userId: "user-1",
        accountId: "acct-9",
        legacyAccountSharing: false,
      }),
    ).toEqual({ column: "account_id", value: "acct-9" });
  });
});
