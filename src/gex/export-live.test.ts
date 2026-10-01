import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildGexLiveWorkbook } from "@/gex/export";

describe("live GEX workbook export", () => {
  it("creates Call Wall and Put Wall tabs from saved live rows", async () => {
    const workbook = new ExcelJS.Workbook();
    const output = await buildGexLiveWorkbook([{
      symbol: "AAPL", category: "daily", expiration: "2026-09-25", underlyingPrice: 250, gexFlip: 248, callWall: 255, putWall: 245,
      activityCallWall: 255, activityPutWall: 245, netGex: 123, expectedMove: 4,
      levels: { callEntry: 255, callTarget: 259, callStop: 252, putEntry: 245, putTarget: 241, putStop: 248 }, calculatedAt: "2026-09-25T14:00:00.000Z",
      chart: { chartSymbol: "NASDAQ:AAPL", imageHash: "test", values: { readable: true, lastPrice: 250, vwap: 249, keltnerUpper: 253, keltnerMiddle: 249, keltnerLower: 245 } },
    }], "daily", new Date("2026-09-25T14:00:00.000Z"));
    await workbook.xlsx.load(Uint8Array.from(output).buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Call Wall", "Put Wall"]);
    expect(workbook.getWorksheet("Call Wall")!.getRow(4).values).toContain("Trade entry (5-min zone)");
    expect(workbook.getWorksheet("Call Wall")!.getCell("A5").value).toBe("AAPL");
    expect(workbook.getWorksheet("Put Wall")!.getCell("P5").value).toBe(245);
  });
});
