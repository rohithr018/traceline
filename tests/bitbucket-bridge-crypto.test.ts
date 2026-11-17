import assert from "node:assert/strict";
import test from "node:test";

import {
	createBridgeSecret,
	decryptBridgeSecret,
	encryptBridgeSecret,
	signBridgeRequest,
	verifyBridgeRequestSignature,
} from "../src/integrations/bitbucket/bitbucket-bridge-crypto";

const secret = "test-bridge-secret-with-at-least-32-bytes";
const timestamp = "1794873600";
const eventId = "event-123";
const body = JSON.stringify({
	schemaVersion: 1,
	workspaceId: "{workspace-uuid}",
	eventId,
});

test("verifies a valid bridge signature", () => {
	const signature = signBridgeRequest(secret, timestamp, eventId, body);

	assert.equal(
		verifyBridgeRequestSignature(secret, timestamp, eventId, body, signature),
		true,
	);
});

test("rejects a modified request body", () => {
	const signature = signBridgeRequest(secret, timestamp, eventId, body);

	assert.equal(
		verifyBridgeRequestSignature(
			secret,
			timestamp,
			eventId,
			`${body} `,
			signature,
		),
		false,
	);
});

test("rejects a different timestamp", () => {
	const signature = signBridgeRequest(secret, timestamp, eventId, body);

	assert.equal(
		verifyBridgeRequestSignature(
			secret,
			"1794873601",
			eventId,
			body,
			signature,
		),
		false,
	);
});

test("rejects a different event ID", () => {
	const signature = signBridgeRequest(secret, timestamp, eventId, body);

	assert.equal(
		verifyBridgeRequestSignature(
			secret,
			timestamp,
			"event-456",
			body,
			signature,
		),
		false,
	);
});

test("rejects a different secret", () => {
	const signature = signBridgeRequest(secret, timestamp, eventId, body);

	assert.equal(
		verifyBridgeRequestSignature(
			"another-secret-with-at-least-32-bytes",
			timestamp,
			eventId,
			body,
			signature,
		),
		false,
	);
});

test("rejects malformed signatures", () => {
	assert.equal(
		verifyBridgeRequestSignature(
			secret,
			timestamp,
			eventId,
			body,
			"not-a-valid-signature",
		),
		false,
	);
});

test("creates high-entropy secrets and encrypts them without changing their value", () => {
	const previousEncryptionKey = process.env.TRACELINE_BRIDGE_ENCRYPTION_KEY;
	process.env.TRACELINE_BRIDGE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
		"base64",
	);

	try {
		const firstSecret = createBridgeSecret();
		const secondSecret = createBridgeSecret();

		assert.notEqual(firstSecret, secondSecret);
		assert.equal(Buffer.from(firstSecret, "base64url").length, 32);

		const encrypted = encryptBridgeSecret(firstSecret);

		assert.notEqual(encrypted.ciphertext, firstSecret);
		assert.equal(decryptBridgeSecret(encrypted), firstSecret);
	} finally {
		if (previousEncryptionKey === undefined) {
			delete process.env.TRACELINE_BRIDGE_ENCRYPTION_KEY;
		} else {
			process.env.TRACELINE_BRIDGE_ENCRYPTION_KEY = previousEncryptionKey;
		}
	}
});
