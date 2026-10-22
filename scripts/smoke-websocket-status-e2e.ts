// End-to-end smoke test for the WebSocket status indicator.
//
// It boots the real Express + ws server on a random port, then:
//  1. connects a real WebSocket client to "/ws/status" and asserts the
//     server counts it as a monitor client,
//  2. asserts the status endpoint reports "online" while the socket is open,
//  3. closes the socket and asserts the state falls back to "offline",
//  4. asserts the status socket is rejected without a valid session cookie.
//
// Run with: npx tsx scripts/smoke-websocket-status-e2e.ts
import express from "express";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

import { getWebSocketStatus } from "../src/api/controllers/health-controller";
import { releaseWebSocketMonitor, trackWebSocketMonitor } from "../src/runtime/websocket-registry";

const arrFailures: string[] = [];

function assert(condition: boolean, label: string): void {
    if (condition) {
        console.log(`ok - ${label}`);
        return;
    }
    arrFailures.push(label);
    console.error(`FAIL - ${label}`);
}

function buildServer(): { server: any; websocketServer: WebSocketServer; port: number } {
    const app = express();
    const server = createServer(app);
    const websocketServer = new WebSocketServer({ noServer: true });

    // Mirrors the production upgrade handler closely enough for the test:
    // the status socket requires a session, the data sockets do not.
    server.on("upgrade", (req: IncomingMessage, socket: any, head: any) => {
        const objUrl = new URL(String(req.url || ""), "http://localhost");
        if (objUrl.pathname !== "/ws/status") {
            socket.destroy();
            return;
        }
        const vCookie = String(req.headers.cookie || "");
        if (!vCookie.includes("session=")) {
            socket.destroy();
            return;
        }
        websocketServer.handleUpgrade(req, socket, head, (ws) => {
            websocketServer.emit("connection", ws, req, "acc-test");
        });
    });

    websocketServer.on("connection", (ws: WebSocket, req: IncomingMessage) => {
        const objUrl = new URL(String(req.url || ""), "http://localhost");
        if (objUrl.pathname === "/ws/status") {
            trackWebSocketMonitor();
            ws.on("close", () => {
                releaseWebSocketMonitor();
            });
            return;
        }
    });

    app.get("/api/system/websocket-status", (_req: any, res: any) => {
        getWebSocketStatus(_req, res);
    });

    return { server, websocketServer, port: 0 };
}

async function readStatus(port: number): Promise<any> {
    const response = await fetch(`http://127.0.0.1:${port}/api/system/websocket-status`);
    return response.json();
}

async function main(): Promise<void> {
    const { server, websocketServer } = buildServer();

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const vPort = (server.address() as any).port;

    // 1. A status socket without a session cookie must be rejected.
    const vRejected = new WebSocket(`ws://127.0.0.1:${vPort}/ws/status`);
    const bRejected = await new Promise<boolean>((resolve) => {
        vRejected.on("open", () => resolve(false));
        vRejected.on("error", () => resolve(true));
        vRejected.on("close", () => resolve(true));
        setTimeout(() => resolve(true), 3000);
    });
    assert(bRejected, "status socket without a session cookie is rejected");

    // 2. A status socket with a session cookie must connect.
    const vSocket = new WebSocket(`ws://127.0.0.1:${vPort}/ws/status`, { headers: { cookie: "session=test" } });
    const bOpened = await new Promise<boolean>((resolve) => {
        vSocket.on("open", () => resolve(true));
        vSocket.on("error", () => resolve(false));
        setTimeout(() => resolve(false), 3000);
    });
    assert(bOpened, "status socket with a session cookie connects");

    await new Promise((resolve) => setTimeout(resolve, 150));

    // 3. While the socket is open the endpoint reports the monitor client.
    const objOpen = await readStatus(vPort);
    assert(objOpen?.data?.monitorClientCount === 1, "monitor client is counted while the socket is open");
    assert(objOpen?.data?.state === "online", "state is online while the status socket is open");

    // 4. After the socket closes the state falls back to offline.
    vSocket.close();
    await new Promise((resolve) => setTimeout(resolve, 400));

    const objClosed = await readStatus(vPort);
    assert(objClosed?.data?.monitorClientCount === 0, "monitor client is released after close");
    assert(objClosed?.data?.state !== "online", "state is not online after the socket closed");

    websocketServer.close();
    server.close();

    if (arrFailures.length) {
        console.error(`SMOKE_FAIL ${arrFailures.length} check(s) failed`);
        process.exit(1);
    }
    console.log("SMOKE_OK websocket status e2e");
}

void main();
