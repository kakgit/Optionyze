import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(pDir: string): Promise<void> {
    await fs.mkdir(pDir, { recursive: true });
}

export async function readJsonFile<T>(pFilePath: string, pFallback: T): Promise<T> {
    try {
        const vRaw = await fs.readFile(pFilePath, "utf8");
        return JSON.parse(vRaw) as T;
    }
    catch {
        return pFallback;
    }
}

export async function writeJsonFileAtomic(pFilePath: string, pValue: unknown): Promise<void> {
    const vDir = path.dirname(pFilePath);
    const vTemp = pFilePath + ".tmp";
    await ensureDir(vDir);
    await fs.writeFile(vTemp, JSON.stringify(pValue, null, 2), "utf8");
    await fs.rename(vTemp, pFilePath);
}
