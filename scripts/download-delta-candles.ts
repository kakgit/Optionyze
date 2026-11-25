import { downloadYearOf30mCandles, DeltaCandleRow } from "../src/services/delta-market-data-client";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function parseArgs(): { symbol: string; lookbackDays: number; outDir: string } {
    const args = process.argv.slice(2);
    const get = (pFlag: string, pDefault: string): string => {
        const vIndex = args.indexOf(pFlag);
        return vIndex >= 0 && vIndex + 1 < args.length ? String(args[vIndex + 1]).trim() : pDefault;
    };
    const vSymbol = String(get("--symbol", "BTCUSD")).toUpperCase();
    const vLookbackDays = Math.max(1, Math.floor(Number(get("--days", "365")) || 365));
    const vOutDir = String(get("--out", "data/candles")).trim();
    return { symbol: vSymbol, lookbackDays: vLookbackDays, outDir: vOutDir };
}

function toIsoUtc(pUnixSeconds: number): string {
    return new Date(pUnixSeconds * 1000).toISOString();
}

function pad2(pN: number): string {
    return String(pN).padStart(2, "0");
}

function formatDateTime(pUnixSeconds: number): string {
    const vDate = new Date(pUnixSeconds * 1000);
    return `${pad2(vDate.getDate())}-${pad2(vDate.getMonth() + 1)}-${vDate.getFullYear()} ${pad2(vDate.getHours())}:${pad2(vDate.getMinutes())}`;
}

function formatCsv(pRows: DeltaCandleRow[]): string {
    const arrLines = ["time,open,high,low,close,volume"];
    for (const objRow of pRows) {
        arrLines.push(`${formatDateTime(objRow.time)},${objRow.open},${objRow.high},${objRow.low},${objRow.close},${objRow.volume}`);
    }
    return arrLines.join("\n") + "\n";
}

async function main(): Promise<void> {
    const { symbol, lookbackDays, outDir } = parseArgs();
    const vStartTs = Date.now();

    console.log(`[delta-candles] Downloading ${lookbackDays} day(s) of 30m candles for ${symbol} ...`);

    const arrRows = await downloadYearOf30mCandles(symbol, lookbackDays);

    if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
    }

    const vDateStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 13);
    const vBaseName = `${symbol}_30m_${lookbackDays}d_${vDateStamp}`;
    const vJsonPath = join(outDir, `${vBaseName}.json`);
    const vCsvPath = join(outDir, `${vBaseName}.csv`);

    writeFileSync(vJsonPath, JSON.stringify(arrRows, null, 2));
    writeFileSync(vCsvPath, formatCsv(arrRows));

    const vElapsedMs = Date.now() - vStartTs;
    const vFirst = arrRows[0];
    const vLast = arrRows[arrRows.length - 1];

    console.log(`[delta-candles] Done in ${vElapsedMs}ms.`);
    console.log(`[delta-candles] Candles: ${arrRows.length}`);
    console.log(`[delta-candles] Range: ${toIsoUtc(vFirst?.time ?? 0)} -> ${toIsoUtc(vLast?.time ?? 0)}`);
    console.log(`[delta-candles] JSON: ${vJsonPath}`);
    console.log(`[delta-candles] CSV:  ${vCsvPath}`);
}

void main().catch((objError) => {
    console.error("[delta-candles] ERROR:", objError instanceof Error ? objError.message : String(objError));
    process.exit(1);
});
