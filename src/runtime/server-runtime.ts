const gResolvedServerId = String(
    process.env.SERVER_ID
    || process.env.RAILWAY_SERVICE_NAME
    || process.env.RENDER_SERVICE_NAME
    || process.env.HOSTNAME
    || "optionyze-server"
).trim();

export function getServerId(): string {
    return gResolvedServerId || "optionyze-server";
}

export function getStrategyLeaseDurationMs(): number {
    const vLeaseMs = Number(process.env.STRATEGY_LEASE_DURATION_MS || 30000);
    return Number.isFinite(vLeaseMs) && vLeaseMs >= 10000 ? Math.floor(vLeaseMs) : 30000;
}

