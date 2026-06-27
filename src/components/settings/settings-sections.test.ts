import { describe, expect, it } from "vitest";

import {
  DEFAULT_SECTION,
  resolveSection,
} from "@/components/settings/settings-sections";

describe("resolveSection", () => {
  it("returns overview for empty/unknown tabs", () => {
    expect(resolveSection(null)).toBe(DEFAULT_SECTION);
    expect(resolveSection("")).toBe(DEFAULT_SECTION);
    expect(resolveSection("not-a-tab")).toBe(DEFAULT_SECTION);
  });

  it("passes through modern section ids", () => {
    expect(resolveSection("profile")).toBe("profile");
    expect(resolveSection("whatsapp")).toBe("whatsapp");
    expect(resolveSection("members")).toBe("members");
    expect(resolveSection("api")).toBe("api");
  });

  it("maps legacy tab slugs onto their new homes", () => {
    expect(resolveSection("tags")).toBe("fields");
    expect(resolveSection("custom-fields")).toBe("fields");
    expect(resolveSection("api-keys")).toBe("api");
    expect(resolveSection("team")).toBe("members");
  });
});
