import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocale, setLocale, tr } from "./locale.js";

afterEach(() => { setLocale("ja"); vi.unstubAllGlobals(); });
describe("UI language", () => {
  it("persists the selected language and translates the same UI boundary both ways", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    setLocale("en");
    expect(getLocale()).toBe("en");
    expect(setItem).toHaveBeenCalledWith("sprink.ui.locale", "en");
    expect(tr("材料・組立")).toBe("Materials & assembly");
    expect(tr("現況を保存")).toBe("Save observation");
    setLocale("ja");
    expect(tr("Save observation")).toBe("現況を保存");
  });
  it("localizes shape controls, unknown height and revision conflicts", () => {
    setLocale("ja");
    expect(tr("Insert obstacle")).toBe("障害物を挿入");
    expect(tr("height unknown")).toBe("高さ未確定");
    expect(tr("Shape {dimension}", { dimension: tr("Bottom Z") })).toBe("図形の下端Z");
    expect(tr("Inputs changed while editing. Discard edits to use the latest revision.")).toContain("編集中に入力が更新");
    setLocale("en");
    expect(tr("図形を保存")).toBe("Save shapes");
  });
  it("keeps switching when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("blocked"); } });
    expect(() => setLocale("en")).not.toThrow();
    expect(tr("図面に戻る")).toBe("Back to drawing");
  });
  it("interpolates values without translating identifiers or interpreting replacement syntax", () => {
    setLocale("en");
    expect(tr("Selected: {part}", { part: "$& / 部材-01" })).toBe("Selected: $& / 部材-01");
    expect(tr("NFPA 13 § 10.2.6: original passage")).toBe("NFPA 13 § 10.2.6: original passage");
  });
});
