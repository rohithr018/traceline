import { sql, type UpdateQueryResponse } from "@forge/sql";

import {
	decryptBridgeSecret,
	encryptBridgeSecret,
} from "./bitbucket-bridge-crypto";

export const BITBUCKET_BRIDGE_EVENT_LEASE_MS = 5 * 60 * 1000;

export interface BitbucketWorkspaceLink {
	workspaceUuid: string;
	tenantId: string;
	secret: string;
	status: "PENDING" | "ACTIVE";
}

export interface BitbucketWorkspacePairing {
	workspaceUuid: string;
	tenantId: string;
	status: "PENDING" | "ACTIVE" | "REVOKED";
	createdAt: number;
	updatedAt: number;
}

export interface BitbucketBridgeEventStore {
	getWorkspaceLink(workspaceUuid: string): Promise<BitbucketWorkspaceLink | null>;
	getWorkspaceActivationLink(
		workspaceUuid: string,
	): Promise<BitbucketWorkspaceLink | null>;
	activateWorkspace(workspaceUuid: string): Promise<boolean>;
	claimEvent(input: { workspaceUuid: string; eventId: string }): Promise<boolean>;
	completeEvent(input: { workspaceUuid: string; eventId: string }): Promise<boolean>;
	failEvent(input: {
		workspaceUuid: string;
		eventId: string;
		error: string;
	}): Promise<boolean>;
}

interface WorkspaceLinkRow {
	workspaceUuid: string;
	tenantId: string;
	encryptedSecret: string;
	encryptionIv: string;
	encryptionTag: string;
	status: string;
	createdAt: number | string;
	updatedAt: number | string;
}

const WORKSPACE_UUID_PATTERN = /^(\{)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\})?$/i;

export class BitbucketWorkspaceTenantMismatchError extends Error {
	constructor() {
		super("This Bitbucket workspace is already paired with another TraceLine site.");
		this.name = "BitbucketWorkspaceTenantMismatchError";
	}
}

/**
 * Bitbucket represents workspace UUIDs with braces in API responses. Store and
 * compare one canonical braced, lowercase value so formatting cannot bypass a
 * workspace pairing check.
 */
export function normalizeBitbucketWorkspaceUuid(value: string): string {
	const trimmed = value.trim();
	const match = WORKSPACE_UUID_PATTERN.exec(trimmed);

	if (!match || Boolean(match[1]) !== Boolean(match[3])) {
		throw new Error("Invalid Bitbucket workspace UUID.");
	}

	return `{${match[2].toLowerCase()}}`;
}

function validateEventIdentity(value: string, fieldName: string): string {
	const normalized = value.trim();

	if (!normalized || normalized.length > 255) {
		throw new Error(`Invalid Bitbucket bridge ${fieldName}.`);
	}

	return normalized;
}

export class BitbucketBridgeStore implements BitbucketBridgeEventStore {
	constructor(
		private readonly database: Pick<typeof sql, "prepare"> = sql,
	) {}

	async registerWorkspace(input: {
		workspaceUuid: string;
		tenantId: string;
		secret: string;
	}): Promise<void> {
		const workspaceUuid = normalizeBitbucketWorkspaceUuid(input.workspaceUuid);
		const tenantId = input.tenantId.trim();

		if (!tenantId || tenantId.length > 128) {
			throw new Error("Invalid TraceLine tenant ID.");
		}

		const encrypted = encryptBridgeSecret(input.secret);
		const now = Date.now();

		const inserted = await this.database
			.prepare<UpdateQueryResponse>(
				`INSERT IGNORE INTO bitbucket_workspace_links (
                                        workspace_uuid,
                                        tenant_id,
                                        encrypted_secret,
                                        encryption_iv,
                                        encryption_tag,
                                        status,
                                        created_at,
                                        updated_at
                                )
					VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
			)
			.bindParams(
				workspaceUuid,
				tenantId,
				encrypted.ciphertext,
				encrypted.iv,
				encrypted.authTag,
				now,
				now,
			)
			.execute();

		if (inserted.rows.affectedRows === 1) {
			return;
		}

		// A workspace can be rotated or reactivated only by the tenant that
		// originally paired it. New credentials remain PENDING until the
		// companion proves that it holds the same secret, so the UI cannot claim
		// a completed pairing merely because the local record was persisted.
		const updated = await this.database
			.prepare<UpdateQueryResponse>(
				`UPDATE bitbucket_workspace_links
                                SET
                                        encrypted_secret = ?,
                                        encryption_iv = ?,
                                        encryption_tag = ?,
						status = 'PENDING',
                                        updated_at = ?
                                WHERE workspace_uuid = ?
                                  AND tenant_id = ?`,
			)
			.bindParams(
				encrypted.ciphertext,
				encrypted.iv,
				encrypted.authTag,
				now,
				workspaceUuid,
				tenantId,
			)
			.execute();

		if (updated.rows.affectedRows !== 1) {
			throw new BitbucketWorkspaceTenantMismatchError();
		}
	}

	async getWorkspacePairing(
		workspaceUuid: string,
	): Promise<BitbucketWorkspacePairing | null> {
		const normalizedWorkspaceUuid = normalizeBitbucketWorkspaceUuid(workspaceUuid);

		const result = await this.database
			.prepare<WorkspaceLinkRow>(
				`SELECT
                                        workspace_uuid AS workspaceUuid,
                                        tenant_id AS tenantId,
                                        status,
                                        created_at AS createdAt,
                                        updated_at AS updatedAt
                                FROM bitbucket_workspace_links
                                WHERE workspace_uuid = ?
                                LIMIT 1`,
			)
			.bindParams(normalizedWorkspaceUuid)
			.execute();

		if (result.rows.length === 0) {
			return null;
		}

		const row = result.rows[0];

		if (
			row.status !== "PENDING" &&
			row.status !== "ACTIVE" &&
			row.status !== "REVOKED"
		) {
			throw new Error("Invalid Bitbucket workspace pairing status.");
		}

		return {
			workspaceUuid: row.workspaceUuid,
			tenantId: row.tenantId,
			status: row.status,
			createdAt: Number(row.createdAt),
			updatedAt: Number(row.updatedAt),
		};
	}

	async getWorkspaceLink(
		workspaceUuid: string,
	): Promise<BitbucketWorkspaceLink | null> {
		const normalizedWorkspaceUuid = normalizeBitbucketWorkspaceUuid(workspaceUuid);

		const result = await this.database
			.prepare<WorkspaceLinkRow>(
				`SELECT
                                        workspace_uuid AS workspaceUuid,
                                        tenant_id AS tenantId,
                                        encrypted_secret AS encryptedSecret,
                                        encryption_iv AS encryptionIv,
                                        encryption_tag AS encryptionTag,
                                        status
                                FROM bitbucket_workspace_links
                                WHERE workspace_uuid = ?
                                LIMIT 1`,
			)
			.bindParams(normalizedWorkspaceUuid)
			.execute();

		if (result.rows.length === 0) {
			return null;
		}

		const row = result.rows[0];

		if (row.status !== "ACTIVE") {
			return null;
		}

		const secret = decryptBridgeSecret({
			ciphertext: row.encryptedSecret,
			iv: row.encryptionIv,
			authTag: row.encryptionTag,
		});

		return {
			workspaceUuid: row.workspaceUuid,
			tenantId: row.tenantId,
			secret,
			status: "ACTIVE",
		};
	}

	/**
	 * Returns a secret only for the narrow companion activation handshake. A
	 * pending record cannot authorize PR graph writes; it can only become active
	 * after the companion proves possession of the freshly configured secret.
	 */
	async getWorkspaceActivationLink(
		workspaceUuid: string,
	): Promise<BitbucketWorkspaceLink | null> {
		const normalizedWorkspaceUuid = normalizeBitbucketWorkspaceUuid(workspaceUuid);

		const result = await this.database
			.prepare<WorkspaceLinkRow>(
				`SELECT
                                        workspace_uuid AS workspaceUuid,
                                        tenant_id AS tenantId,
                                        encrypted_secret AS encryptedSecret,
                                        encryption_iv AS encryptionIv,
                                        encryption_tag AS encryptionTag,
                                        status
                                FROM bitbucket_workspace_links
                                WHERE workspace_uuid = ?
                                LIMIT 1`,
			)
			.bindParams(normalizedWorkspaceUuid)
			.execute();

		if (result.rows.length === 0) {
			return null;
		}

		const row = result.rows[0];

		if (row.status !== "PENDING" && row.status !== "ACTIVE") {
			return null;
		}

		const secret = decryptBridgeSecret({
			ciphertext: row.encryptedSecret,
			iv: row.encryptionIv,
			authTag: row.encryptionTag,
		});

		return {
			workspaceUuid: row.workspaceUuid,
			tenantId: row.tenantId,
			secret,
			status: row.status,
		};
	}

	async activateWorkspace(workspaceUuid: string): Promise<boolean> {
		const normalizedWorkspaceUuid = normalizeBitbucketWorkspaceUuid(workspaceUuid);
		const now = Date.now();

		const result = await this.database
			.prepare<UpdateQueryResponse>(
				`UPDATE bitbucket_workspace_links
                                SET status = 'ACTIVE', updated_at = ?
                                WHERE workspace_uuid = ?
                                  AND status = 'PENDING'`,
			)
			.bindParams(now, normalizedWorkspaceUuid)
			.execute();

		return result.rows.affectedRows === 1;
	}

	async revokeWorkspace(workspaceUuid: string): Promise<boolean> {
		const normalizedWorkspaceUuid = normalizeBitbucketWorkspaceUuid(workspaceUuid);
		const now = Date.now();

		const result = await this.database
			.prepare<UpdateQueryResponse>(
				`UPDATE bitbucket_workspace_links
                                SET status = 'REVOKED', updated_at = ?
                                WHERE workspace_uuid = ?
						  AND status IN ('PENDING', 'ACTIVE')`,
			)
			.bindParams(now, normalizedWorkspaceUuid)
			.execute();

		return result.rows.affectedRows === 1;
	}

	/**
	 * Atomically claims an event.
	 *
	 * A new event is inserted as PROCESSING.
	 * A previously FAILED event, or a PROCESSING event whose bounded lease has
	 * expired, can be retried. COMPLETED events cannot be claimed again.
	 */
	async claimEvent(input: {
		workspaceUuid: string;
		eventId: string;
	}): Promise<boolean> {
		const workspaceUuid = normalizeBitbucketWorkspaceUuid(input.workspaceUuid);
		const eventId = validateEventIdentity(input.eventId, "event ID");

		const now = Date.now();
		const leaseExpiresAt = now + BITBUCKET_BRIDGE_EVENT_LEASE_MS;

		const inserted = await this.database
			.prepare<UpdateQueryResponse>(
				`INSERT IGNORE INTO bitbucket_bridge_events (
                                        workspace_uuid,
                                        event_id,
                                        status,
                                        received_at,
                                        completed_at,
                                        last_error,
                                        lease_expires_at
                                )
					VALUES (?, ?, 'PROCESSING', ?, NULL, NULL, ?)`,
			)
			.bindParams(workspaceUuid, eventId, now, leaseExpiresAt)
			.execute();

		if (inserted.rows.affectedRows === 1) {
			return true;
		}

		// Permit a retry after a previous processing failure or a bounded lease
		// expiry. A crashed invocation therefore cannot lock a Bitbucket event
		// forever.
		const retried = await this.database
			.prepare<UpdateQueryResponse>(
				`UPDATE bitbucket_bridge_events
                                SET
                                        status = 'PROCESSING',
                                        received_at = ?,
                                        completed_at = NULL,
                                        last_error = NULL,
                                        lease_expires_at = ?
                                WHERE workspace_uuid = ?
                                  AND event_id = ?
					AND (
						status = 'FAILED'
						OR (status = 'PROCESSING' AND lease_expires_at <= ?)
					)`,
			)
			.bindParams(now, leaseExpiresAt, workspaceUuid, eventId, now)
			.execute();

		return retried.rows.affectedRows === 1;
	}

	async completeEvent(input: {
		workspaceUuid: string;
		eventId: string;
	}): Promise<boolean> {
		const workspaceUuid = normalizeBitbucketWorkspaceUuid(input.workspaceUuid);
		const eventId = validateEventIdentity(input.eventId, "event ID");

		const result = await this.database
			.prepare<UpdateQueryResponse>(
				`UPDATE bitbucket_bridge_events
                                SET
                                        status = 'COMPLETED',
                                        completed_at = ?,
                                        last_error = NULL,
                                        lease_expires_at = NULL
                                WHERE workspace_uuid = ?
                                  AND event_id = ?
                                  AND status = 'PROCESSING'`,
			)
			.bindParams(Date.now(), workspaceUuid, eventId)
			.execute();

		return result.rows.affectedRows === 1;
	}

	async failEvent(input: {
		workspaceUuid: string;
		eventId: string;
		error: string;
	}): Promise<boolean> {
		const workspaceUuid = normalizeBitbucketWorkspaceUuid(input.workspaceUuid);
		const eventId = validateEventIdentity(input.eventId, "event ID");

		const result = await this.database
			.prepare<UpdateQueryResponse>(
				`UPDATE bitbucket_bridge_events
                                SET
                                        status = 'FAILED',
                                        completed_at = ?,
                                        last_error = ?,
                                        lease_expires_at = NULL
                                WHERE workspace_uuid = ?
                                  AND event_id = ?
                                  AND status = 'PROCESSING'`,
			)
			.bindParams(
				Date.now(),
				input.error.slice(0, 4000),
				workspaceUuid,
				eventId,
			)
			.execute();

		return result.rows.affectedRows === 1;
	}
}
