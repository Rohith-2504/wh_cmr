import { describe, expect, it } from "vitest";

import {
  isMissingColumnError,
  isMissingSchemaResourceError,
  mapLegacyProfileRole,
  normalizeProfileRow,
} from "./profile-load";

describe("profile-load", () => {
  it("detects Postgres undefined_column errors", () => {
    expect(
      isMissingColumnError({
        code: "42703",
        message: 'column profiles.account_id does not exist',
      }),
    ).toBe(true);
  });

  it("detects missing PostgREST tables and RPCs", () => {
    expect(
      isMissingSchemaResourceError({
        code: "PGRST205",
        message: "Could not find the table 'public.accounts' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingSchemaResourceError({
        code: "PGRST202",
        message:
          "Could not find the function public.touch_presence(p_status) in the schema cache",
      }),
    ).toBe(true);
  });

  it("maps legacy admin role and defaults sole users to owner", () => {
    expect(mapLegacyProfileRole("admin")).toBe("admin");
    expect(mapLegacyProfileRole("user")).toBe("owner");
    expect(mapLegacyProfileRole(null)).toBe("owner");
  });

  it("synthesizes account fields in legacy mode", () => {
    const row = normalizeProfileRow(
      {
        id: "prof-1",
        full_name: "User ADMIN",
        email: "admin@example.com",
        avatar_url: null,
        role: "admin",
      },
      { userId: "user-1", legacy: true },
    );

    expect(row.account_id).toBe("user-1");
    expect(row.account_role).toBe("admin");
    expect(row.beta_features).toEqual([]);
  });
});
