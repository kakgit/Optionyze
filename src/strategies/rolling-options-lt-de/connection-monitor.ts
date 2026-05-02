import { performRollingOptionsLtDeConnectionCheck } from "../../api/controllers/rolling-options-lt-de-controller";
import { listRollingOptionsLtDeRuntime } from "../../storage/rolling-options-lt-de-runtime-store";

let gMonitorTimer: NodeJS.Timeout | null = null;
let gMonitorBusy = false;

export async function runRollingOptionsLtDeConnectionMonitorCycle(): Promise<void> {
    if (gMonitorBusy) {
        return;
    }

    gMonitorBusy = true;
    try {
        const arrRuntimeRows = await listRollingOptionsLtDeRuntime();
        for (const objRuntime of arrRuntimeRows) {
            const vUserId = String(objRuntime.userId || "").trim();
            const vProfileId = String(objRuntime.selectedApiProfileId || "").trim();
            const vStatus = String(objRuntime.status || "").trim().toLowerCase();
            const bActive = vStatus === "running" || vStatus === "paused";
            if (!vUserId || !vProfileId) {
                continue;
            }
            if (!objRuntime.autoTraderEnabled || !bActive) {
                continue;
            }

            try {
                await performRollingOptionsLtDeConnectionCheck(vUserId, vProfileId);
            }
            catch (_objError) {
                // Keep the monitor moving even if one profile fails unexpectedly.
            }
        }
    }
    finally {
        gMonitorBusy = false;
    }
}

export function startRollingOptionsLtDeConnectionMonitor(pIntervalMs = 5 * 60 * 1000): void {
    if (gMonitorTimer) {
        clearInterval(gMonitorTimer);
    }

    gMonitorTimer = setInterval(() => {
        void runRollingOptionsLtDeConnectionMonitorCycle();
    }, Math.max(60 * 1000, Number(pIntervalMs || 0)));
}
