export {};

declare global {
    namespace Express {
        interface Request {
            authAccount?: import("./models").AccountRecord | null;
            authSessionId?: string | null;
        }
    }
}
