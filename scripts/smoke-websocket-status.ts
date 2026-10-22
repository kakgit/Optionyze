// Smoke test for the WebSocket status endpoint logic. It calls the
// controller directly with mock req/res objects so no HTTP server, database
// or session is required. Run with: npx tsx scripts/smoke-websocket-status.ts
import { getWebSocketStatus } from "../src/api/controllers/health-controller";
import { getWebSocketClientCount, getWebSocketMonitorCount, releaseWebSocketClient, releaseWebSocketMonitor, trackWebSocketClient, trackWebSocketMonitor } from "../src/runtime/websocket-registry";

function callController(): any {
    const objCaptured: any = {};
    const objReq: any = { body: {}, query: {}, params: {} };
    const objRes: any = {
        statusCode: 200,
        json(payload: any) {
            objCaptured.statusCode = 200;
            objCaptured.payload = payload;
            return objRes;
        }
    };
    getWebSocketStatus(objReq, objRes);
    return objCaptured;
}

function assert(condition: boolean, label: string): void {
    if (!condition) {
        console.error(`SMOKE_FAIL ${label}`);
        process.exitCode = 1;
        return;
    }
    console.log(`ok - ${label}`);
}

// 1. No clients attached -> not "online".
const objFirst = callController();
assert(objFirst.payload?.status === "success", "response uses the success envelope");
assert(typeof objFirst.payload?.data?.state === "string", "state is a string");
assert(objFirst.payload?.data?.state !== "online", "no clients -> state is not online");
assert(typeof objFirst.payload?.data?.marketData?.connectionState === "string", "market data connection state is reported");
assert(typeof objFirst.payload?.data?.monitorClientCount === "number", "monitor client count is a number");
assert(typeof objFirst.payload?.data?.dataClientCount === "number", "data client count is a number");

// 2. The registry counter tracks connects and disconnects.
assert(getWebSocketClientCount() === 0, "counter starts at zero");
trackWebSocketClient();
assert(getWebSocketClientCount() === 1, "counter increments on connect");
trackWebSocketClient();
assert(getWebSocketClientCount() === 2, "counter increments again");
releaseWebSocketClient();
assert(getWebSocketClientCount() === 1, "counter decrements on disconnect");
releaseWebSocketClient();
releaseWebSocketClient();
assert(getWebSocketClientCount() === 0, "counter never goes negative");

// 3. With a monitor client attached the state becomes "online".
trackWebSocketMonitor();
const objSecond = callController();
assert(objSecond.payload?.data?.monitorClientCount === 1, "payload reflects the connected monitor count");
assert(objSecond.payload?.data?.state === "online", "monitor client attached -> state is online");
releaseWebSocketMonitor();

const objThird = callController();
assert(objThird.payload?.data?.state !== "online", "monitor client released -> state is not online");
assert(objThird.payload?.data?.monitorClientCount === 0, "monitor count drops back to zero");

if (!process.exitCode) {
    console.log("SMOKE_OK websocket status");
}
