import assert from "node:assert/strict";
import test from "node:test";

import { sql } from "@forge/sql";
import {
	BitbucketBridgeStore,
	BitbucketWorkspaceTenantMismatchError,
	normalizeBitbucketWorkspaceUuid,
} from "../src/integrations/bitbucket/bitbucket-bridge-store";

const WORKSPACE_UUID = "{8ba415db-861f-4575-b92b-8d057b404599}";
const SECRET = "test-bridge-secret-with-at-least-32-bytes";

interface StoredWorkspace {
	workspaceUuid: string;
	tenantId: string;
	encryptedSecret: string;
	encryptionIv: string;
	encryptionTag: string;
	status: "PENDING" | "ACTIVE" | "REVOKED";
	createdAt: number;
	updatedAt: number;
}

/** Minimal SQL-shaped adapter to exercise the store without claiming live Forge SQL access. */
class MemoryForgeSql {
	private readonly workspaces = new Map<string, StoredWorkspace>();

	prepare(query: string) {
		let params: unknown[] = [];
		const statement = {
			bindParams: (...values: unknown[]) => {
				params = values;
				return statement;
			},
			execute: async () => this.execute(query, params),
		};

		return statement;
	}

	private async execute(query: string, params: unknown[]): Promise<unknown> {
		if (query.includes("INSERT IGNORE INTO bitbucket_workspace_links")) {
			const [workspaceUuid, tenantId, encryptedSecret, encryptionIv, encryptionTag, now] =
				params as [string, string, string, string, string, number, number];

			if (this.workspaces.has(workspaceUuid)) {
				return { rows: { affectedRows: 0 } };
			}

			this.workspaces.set(workspaceUuid, {
				workspaceUuid,
				tenantId,
				encryptedSecret,
				encryptionIv,
				encryptionTag,
				status: "PENDING",
				createdAt: now,
				updatedAt: now,
			});
			return { rows: { affectedRows: 1 } };
		}

		if (query.includes("UPDATE bitbucket_workspace_links") && query.includes("encrypted_secret = ?")) {
			const [encryptedSecret, encryptionIv, encryptionTag, now, workspaceUuid, tenantId] =
				params as [string, string, string, number, string, string];
			const row = this.workspaces.get(workspaceUuid);
			if (!row || row.tenantId !== tenantId) {
				return { rows: { affectedRows: 0 } };
			}

			Object.assign(row, {
				encryptedSecret,
				encryptionIv,
				encryptionTag,
				status: "PENDING",
				updatedAt: now,
			});
			return { rows: { affectedRows: 1 } };
		}

		if (query.includes("UPDATE bitbucket_workspace_links") && query.includes("status = 'ACTIVE'")) {
			const [now, workspaceUuid] = params as [number, string];
			const row = this.workspaces.get(workspaceUuid);
			if (!row || row.status !== "PENDING") {
				return { rows: { affectedRows: 0 } };
			}

			row.status = "ACTIVE";
			row.updatedAt = now;
			return { rows: { affectedRows: 1 } };
		}

		if (query.includes("UPDATE bitbucket_workspace_links") && query.includes("status = 'REVOKED'")) {
			const [now, workspaceUuid] = params as [number, string];
			const row = this.workspaces.get(workspaceUuid);
			if (!row || (row.status !== "PENDING" && row.status !== "ACTIVE")) {
				return { rows: { affectedRows: 0 } };
			}

			row.status = "REVOKED";
			row.updatedAt = now;
			return { rows: { affectedRows: 1 } };
		}

		if (query.includes("SELECT") && query.includes("FROM bitbucket_workspace_links")) {
			const [workspaceUuid] = params as [string];
			const row = this.workspaces.get(workspaceUuid);
			if (!row) {
				return { rows: [] };
			}

			if (query.includes("encrypted_secret AS encryptedSecret")) {
				return {
					rows: [{
						workspaceUuid: row.workspaceUuid,
						tenantId: row.tenantId,
						encryptedSecret: row.encryptedSecret,
						encryptionIv: row.encryptionIv,
						encryptionTag: row.encryptionTag,
						status: row.status,
					}],
				};
			}

			return {
				rows: [{
					workspaceUuid: row.workspaceUuid,
					tenantId: row.tenantId,
					status: row.status,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
				}],
			};
		}

		throw new Error("Unexpected SQL query in Bitbucket bridge store test.");
	}
}

function createStore() {
	return new BitbucketBridgeStore(
		new MemoryForgeSql() as unknown as Pick<typeof sql, "prepare">,
	);
}

async function withEncryptionKey<T>(keyByte: number, action: () => Promise<T>): Promise<T> {
	const previousKey = process.env.TRACELINE_BRIDGE_ENCRYPTION_KEY;
	process.env.TRACELINE_BRIDGE_ENCRYPTION_KEY = Buffer.alloc(32, keyByte).toString("base64");
	try {
		return await action();
	} finally {
		if (previousKey === undefined) {
			delete process.env.TRACELINE_BRIDGE_ENCRYPTION_KEY;
		} else {
			process.env.TRACELINE_BRIDGE_ENCRYPTION_KEY = previousKey;
		}
	}
}

test("normalizes valid Bitbucket workspace UUID representations to one canonical value", () => {
	assert.equal(
		normalizeBitbucketWorkspaceUuid("8BA415DB-861F-4575-B92B-8D057B404599"),
		WORKSPACE_UUID,
	);
	assert.equal(
		normalizeBitbucketWorkspaceUuid("{8BA415DB-861F-4575-B92B-8D057B404599}"),
		WORKSPACE_UUID,
	);
});

test("rejects invalid or partially-braced Bitbucket workspace UUIDs", () => {
	assert.throws(
		() => normalizeBitbucketWorkspaceUuid("{8ba415db-861f-4575-b92b-8d057b404599"),
		/Invalid Bitbucket workspace UUID/,
	);
	assert.throws(
		() => normalizeBitbucketWorkspaceUuid("not-a-workspace"),
		/Invalid Bitbucket workspace UUID/,
	);
});

test("keeps a new workspace pending until the companion proves the shared secret", async () => {
	await withEncryptionKey(7, async () => {
		const store = createStore();
		await store.registerWorkspace({
			workspaceUuid: "8BA415DB-861F-4575-B92B-8D057B404599",
			tenantId: "tenant-1",
			secret: SECRET,
		});

		assert.equal(await store.getWorkspaceLink(WORKSPACE_UUID), null);
		const activationLink = await store.getWorkspaceActivationLink(WORKSPACE_UUID);
		assert.deepEqual(activationLink, {
			workspaceUuid: WORKSPACE_UUID,
			tenantId: "tenant-1",
			secret: SECRET,
			status: "PENDING",
		});
		const pairing = await store.getWorkspacePairing("{8BA415DB-861F-4575-B92B-8D057B404599}");
		assert.equal(pairing?.workspaceUuid, WORKSPACE_UUID);
		assert.equal(pairing?.tenantId, "tenant-1");
		assert.equal(pairing?.status, "PENDING");
		assert.equal(typeof pairing?.createdAt, "number");
		assert.equal(typeof pairing?.updatedAt, "number");

		assert.equal(await store.activateWorkspace(WORKSPACE_UUID), true);
		assert.deepEqual(await store.getWorkspaceLink(WORKSPACE_UUID), {
			workspaceUuid: WORKSPACE_UUID,
			tenantId: "tenant-1",
			secret: SECRET,
			status: "ACTIVE",
		});
	});
});

test("returns null for a workspace that has not been paired", async () => {
	await withEncryptionKey(7, async () => {
		const store = createStore();
		assert.equal(await store.getWorkspaceLink(WORKSPACE_UUID), null);
		assert.equal(await store.getWorkspacePairing(WORKSPACE_UUID), null);
	});
});

test("revoked workspaces remain visible as revoked and cannot retrieve their secret", async () => {
	await withEncryptionKey(7, async () => {
		const store = createStore();
		await store.registerWorkspace({ workspaceUuid: WORKSPACE_UUID, tenantId: "tenant-1", secret: SECRET });

		assert.equal(await store.revokeWorkspace(WORKSPACE_UUID), true);
		assert.equal((await store.getWorkspacePairing(WORKSPACE_UUID))?.status, "REVOKED");
		assert.equal(await store.getWorkspaceLink(WORKSPACE_UUID), null);
	});
});

test("does not allow a different tenant to take over a workspace pairing", async () => {
	await withEncryptionKey(7, async () => {
		const store = createStore();
		await store.registerWorkspace({ workspaceUuid: WORKSPACE_UUID, tenantId: "tenant-1", secret: SECRET });

		await assert.rejects(
			store.registerWorkspace({
				workspaceUuid: WORKSPACE_UUID,
				tenantId: "tenant-2",
				secret: "another-bridge-secret-with-at-least-32-bytes",
			}),
			BitbucketWorkspaceTenantMismatchError,
		);
		assert.equal((await store.getWorkspaceActivationLink(WORKSPACE_UUID))?.tenantId, "tenant-1");
	});
});

test("fails authenticated decryption when the configured encryption key changes", async () => {
	await withEncryptionKey(7, async () => {
		const store = createStore();
		await store.registerWorkspace({ workspaceUuid: WORKSPACE_UUID, tenantId: "tenant-1", secret: SECRET });
		await store.activateWorkspace(WORKSPACE_UUID);

		process.env.TRACELINE_BRIDGE_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
		await assert.rejects(store.getWorkspaceLink(WORKSPACE_UUID));
	});
});
