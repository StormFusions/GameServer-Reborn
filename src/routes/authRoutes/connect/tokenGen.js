import crypto from "crypto";

function generateToken(prefix, userId) {
    const randomBytes = crypto.randomBytes(16);
    const userIdBuffer = Buffer.from(userId, "utf-8");
    const tokenBuffer = Buffer.concat([Buffer.from(prefix), randomBytes, userIdBuffer]);
    return tokenBuffer.toString("base64url");
}

export default generateToken
