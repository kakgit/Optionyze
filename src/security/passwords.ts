import crypto from "node:crypto";

const SCRYPT_PREFIX = "scrypt";
const KEY_LENGTH = 64;

export async function hashPassword(pPassword: string): Promise<string> {
    const vSalt = crypto.randomBytes(16).toString("hex");
    const objDerived = await deriveKey(pPassword, vSalt);
    return `${SCRYPT_PREFIX}$${vSalt}$${objDerived.toString("hex")}`;
}

export async function verifyPassword(pPassword: string, pStoredHash: string): Promise<boolean> {
    const arrParts = String(pStoredHash || "").split("$");
    if (arrParts.length !== 3 || arrParts[0] !== SCRYPT_PREFIX) {
        return false;
    }

    const [, vSalt, vHashHex] = arrParts;
    const objExpected = Buffer.from(vHashHex, "hex");
    const objActual = await deriveKey(pPassword, vSalt);

    if (objExpected.length !== objActual.length) {
        return false;
    }

    return crypto.timingSafeEqual(objExpected, objActual);
}

function deriveKey(pPassword: string, pSalt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        crypto.scrypt(pPassword, pSalt, KEY_LENGTH, (objError, objKey) => {
            if (objError) {
                reject(objError);
                return;
            }

            resolve(objKey as Buffer);
        });
    });
}
