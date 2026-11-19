import { describe, expect, it } from "vitest";

import { csvCell } from "@/src/modules/traceability/csv";

describe("CSV cells", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", then go')).toBe('"say ""hi"", then go"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(80)).toBe("80");
  });

  it("neutralises spreadsheet formulas in requirement text", () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+1 for this")).toBe("'+1 for this");
    expect(csvCell("-5% fees")).toBe("'-5% fees");
    expect(csvCell("@admin")).toBe("'@admin");
  });
});
