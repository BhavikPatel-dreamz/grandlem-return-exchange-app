import { describe, it, expect, vi } from "vitest";
import {
  getReturnFormCustomization,
  updateReturnFormCustomization,
  DEFAULT_RETURN_FORM_CUSTOMIZATION,
} from "../app/services/settings.server";

const mockSettings: Record<string, any> = {};

vi.mock("../app/db.server", () => {
  return {
    default: {
      settings: {
        findUnique: vi.fn(({ where }: { where: { shop: string } }) => {
          return Promise.resolve(mockSettings[where.shop] || null);
        }),
        create: vi.fn(({ data }: { data: { shop: string } }) => {
          mockSettings[data.shop] = { ...data };
          return Promise.resolve(mockSettings[data.shop]);
        }),
        upsert: vi.fn(({ where, create, update }: { where: { shop: string }; create: any; update: any }) => {
          if (!mockSettings[where.shop]) {
            mockSettings[where.shop] = { ...create };
          } else {
            mockSettings[where.shop] = { ...mockSettings[where.shop], ...update };
          }
          return Promise.resolve(mockSettings[where.shop]);
        }),
      },
    },
  };
});

describe("return form customization settings", () => {
  const shop = "test-customization.myshopify.com";

  it("returns default values when no customization is set", () => {
    const config = getReturnFormCustomization(null);
    expect(config.primaryColor).toBe(DEFAULT_RETURN_FORM_CUSTOMIZATION.primaryColor);
    expect(config.primaryTextColor).toBe(DEFAULT_RETURN_FORM_CUSTOMIZATION.primaryTextColor);
    expect(config.textColor).toBe(DEFAULT_RETURN_FORM_CUSTOMIZATION.textColor);
    expect(config.secondaryBgColor).toBe(DEFAULT_RETURN_FORM_CUSTOMIZATION.secondaryBgColor);
    expect(config.showLogo).toBe(DEFAULT_RETURN_FORM_CUSTOMIZATION.showLogo);
    expect(config.showStoreName).toBe(DEFAULT_RETURN_FORM_CUSTOMIZATION.showStoreName);
  });

  it("saves and retrieves customized palette and logo options", async () => {
    await updateReturnFormCustomization(shop, {
      primaryColor: "#2563eb",
      primaryTextColor: "#1e293b",
      textColor: "#ffffff",
      secondaryBgColor: "#eff6ff",
      showLogo: true,
      showStoreName: true,
      logoUrl: "data:image/png;base64,sample",
      storeName: "Custom Shop",
    });

    const config = getReturnFormCustomization(mockSettings[shop]);

    expect(config.primaryColor).toBe("#2563eb");
    expect(config.primaryTextColor).toBe("#1e293b");
    expect(config.textColor).toBe("#ffffff");
    expect(config.secondaryBgColor).toBe("#eff6ff");
    expect(config.showLogo).toBe(true);
    expect(config.showStoreName).toBe(true);
    expect(config.logoUrl).toBe("data:image/png;base64,sample");
    expect(config.storeName).toBe("Custom Shop");
  });
});
