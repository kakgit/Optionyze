/**
 * Shared helper for arbitrage compare chains.
 *
 * Each arbitrage compare API fetches an exchange chain (Shark / Bybit /
 * CoinSwitch) and pairs each known strike with its Delta Exchange counterpart.
 * The Delta Exchange row is the only delta that is always available at fetch
 * time across all three pages (the Shark page, for example, leaves its own
 * `shark.delta` null until the live websocket fills it in).
 *
 * The arbitration flow is most relevant immediately around the 0.50-delta
 * boundary, so the compare responses only need the single strike sitting just
 * above that boundary and the single strike sitting just below it. This helper
 * reduces a full compare row chain down to those two straddling rows.
 */

export const DELTA_STRIKE_TARGET = 0.5;

export interface CompareDeltaAtRow {
    strike: number;
    delta: { delta?: number | null } | null;
}

function getAbsDelta<T extends CompareDeltaAtRow>(pRow: T): number {
    const vAbs = Math.abs(Number(pRow?.delta?.delta));
    return Number.isFinite(vAbs) ? vAbs : Number.NaN;
}

/**
 * Reduces a compare row chain to the two rows straddling the 0.50-delta
 * boundary (based on the absolute Delta Exchange delta): one row just above
 * (or exactly at) 0.50 and one row just below 0.50. Rows are returned in the
 * original chain order (ascending strike). If either side has no candidate,
 * only the existing side is included.
 */
export function filterCompareRowsToDeltaStraddle<T extends CompareDeltaAtRow>(
    pRows: T[],
    pTarget: number = DELTA_STRIKE_TARGET
): T[] {
    let vAbove: T | null = null;
    let vBelow: T | null = null;

    for (const objRow of pRows) {
        const vAbsDelta = getAbsDelta(objRow);
        if (!Number.isFinite(vAbsDelta)) {
            continue;
        }
        if (vAbsDelta >= pTarget) {
            // Closest at/above the boundary.
            if (vAbove === null || vAbsDelta < getAbsDelta(vAbove)) {
                vAbove = objRow;
            }
        }
        else {
            // Closest below the boundary.
            if (vBelow === null || vAbsDelta > getAbsDelta(vBelow)) {
                vBelow = objRow;
            }
        }
    }

    const arrSelected = [vBelow, vAbove].filter(Boolean) as T[];
    if (!arrSelected.length) {
        return [];
    }

    const setSelectedStrikes = new Set(arrSelected.map((objRow) => objRow.strike));
    return pRows.filter((objRow) => setSelectedStrikes.has(objRow.strike));
}