import type { Request, Response } from "express";
import { getServerId } from "../../runtime/server-runtime";

export function getHealth(_req: Request, res: Response): void {
    res.json({
        status: "ok",
        service: "optionyze",
        serverId: getServerId(),
        pid: process.pid,
        timestamp: new Date().toISOString()
    });
}
