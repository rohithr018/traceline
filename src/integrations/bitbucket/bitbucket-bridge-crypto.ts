import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
export interface EncryptedBridgeSecret {
	ciphertext: string;
	iv: string;
	authTag: string;
}

/**
 * Returns a high-entropy transport secret suitable for HMAC authentication.
 * The caller is responsible for showing this value once and storing only its
 * encrypted form.
 */
export function createBridgeSecret(): string {
	return randomBytes(32).toString("base64url");
}

/**
 * Signs the exact raw request body.
 *
 * The timestamp and event ID are included in the signed content so
 * neither can be changed independently of the payload.
 */
export function signBridgeRequest(
	secret: string,
	timestamp: string,
	eventId: string,
	rawBody: string,
): string {
	const canonical = `${timestamp}.${eventId}.${rawBody}`;

	return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

/**
 * Verifies a SHA-256 HMAC using a constant-time comparison.
 */
export function verifyBridgeRequestSignature(
	secret: string,
	timestamp: string,
	eventId: string,
	rawBody: string,
	suppliedSignature: string,
): boolean {
	if (!/^[a-f0-9]{64}$/i.test(suppliedSignature)) {
		return false;
	}

	const expected = Buffer.from(
		signBridgeRequest(secret, timestamp, eventId, rawBody),
		"hex",
	);

	const supplied = Buffer.from(suppliedSignature, "hex");

	return (
		expected.length === supplied.length && timingSafeEqual(expected, supplied)
	);
}

function getEncryptionKey(): Buffer {
	const encodedKey = process.env.TRACELINE_BRIDGE_ENCRYPTION_KEY;

	if (!encodedKey) {
		throw new Error("TRACELINE_BRIDGE_ENCRYPTION_KEY is not configured.");
	}

	const key = Buffer.from(encodedKey, "base64");

	if (key.length !== 32) {
		throw new Error(
			"TRACELINE_BRIDGE_ENCRYPTION_KEY must decode to exactly 32 bytes.",
		);
	}

	return key;
}

export function encryptBridgeSecret(secret: string): EncryptedBridgeSecret {
	if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
		throw new Error("Bridge secret must contain at least 32 bytes.");
	}

	const iv = randomBytes(12);

	const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);

	const encrypted = Buffer.concat([
		cipher.update(secret, "utf8"),
		cipher.final(),
	]);

	return {
		ciphertext: encrypted.toString("base64"),
		iv: iv.toString("base64"),
		authTag: cipher.getAuthTag().toString("base64"),
	};
}

export function decryptBridgeSecret(encrypted: EncryptedBridgeSecret): string {
	const decipher = createDecipheriv(
		"aes-256-gcm",
		getEncryptionKey(),
		Buffer.from(encrypted.iv, "base64"),
	);

	decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));

	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
		decipher.final(),
	]);

	return decrypted.toString("utf8");
}
