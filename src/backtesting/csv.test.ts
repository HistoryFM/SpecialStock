import { describe, expect, it } from "vitest";

import { parsePriceCsv } from "./csv";

describe("price CSV import", () => {
  it("reads the supplied descending-date shape and sorts it for calculations", () => {
    const parsed = parsePriceCsv("Date,Close/Last,Volume,Open,High,Low\n01/04/2022,105,200,104,106,103\n01/03/2022,100,150,99,101,98");
    expect(parsed.rows.map((row) => row.date)).toEqual(["2022-01-03", "2022-01-04"]);
    expect(parsed.rows[0].close).toBe(100);
    expect(parsed.warnings).toContain("Price returns only: dividends are not included.");
  });

  it("rejects duplicate dates and impossible prices", () => {
    expect(() => parsePriceCsv("Date,Close/Last\n01/03/2022,100\n01/03/2022,101")).toThrow(/duplicate/);
    expect(() => parsePriceCsv("Date,Close/Last\n01/03/2022,0\n01/04/2022,100")).toThrow(/Invalid CSV price/);
  });

  it("uses raw close over adjusted close and warns about suspicious sessions", () => {
    const parsed = parsePriceCsv("Date,Close,Adj Close\n01/03/2022,100,99\n01/10/2022,200,199\n01/15/2022,205,204");
    expect(parsed.rows[0].close).toBe(100);
    expect(parsed.warnings.join(" ")).toMatch(/Price returns only/);
    expect(parsed.warnings.join(" ")).toMatch(/Long weekday gap/);
    expect(parsed.warnings.join(" ")).toMatch(/Weekend dates/);
    expect(parsed.warnings.join(" ")).toMatch(/Large price jump/);
    expect(() => parsePriceCsv("Date,Adj Close\n01/03/2022,99\n01/04/2022,100")).toThrow(/missing close/);
  });

  it("keeps missing optional volume as null while requiring valid closes", () => {
    const parsed = parsePriceCsv("Date,Close/Last,Volume\n01/03/2022,100,N/A\n01/04/2022,101,1000");
    expect(parsed.rows[0].volume).toBeNull();
    expect(parsed.warnings.join(" ")).toMatch(/missing optional/);
    expect(() => parsePriceCsv("Date,Close/Last\n01/03/2022,N/A\n01/04/2022,101")).toThrow(/Invalid CSV price/);
  });
});
