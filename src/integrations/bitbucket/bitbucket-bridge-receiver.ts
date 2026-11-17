import { SqlGraphRepository } from "../../graph/repository/sql-graph-repository";
import type { GraphRepository } from "../../graph/repository/graph-repository";

import {
	mapBitbucketPullRequestToGraphNode,
	mapBitbucketRepositoryToGraphNode,
	mapRepositoryPullRequestEdge,
} from "./bitbucket-mapper";

import { verifyBridgeRequestSignature } from "./bitbucket-bridge-crypto";

import {
	BitbucketBridgeStore,
	normalizeBitbucketWorkspaceUuid,
	type BitbucketBridgeEventStore,
} from "./bitbucket-bridge-store";
import { BitbucketChangeLinker } from "./bitbucket-change-linker";
import { BitbucketJiraLinker } from "./bitbucket-jira-linker";

import type {
	BitbucketCommit,
	BitbucketDiffStat,
	BitbucketPullRequest,
	BitbucketRepository,
} from "./bitbucket-types";

const MAX_BODY_BYTES = 1_000_000;
const MAX_CLOCK_SKEW_SECONDS = 300;

interface WebTriggerRequest {
	method?: string;
	body?: string;
	headers?: Record<string, string[] | undefined>;
}

interface BridgePayload {
	schemaVersion: 1;
	eventId: string;
	workspaceId: string;
	repository: {
		uuid: string;
		slug: string;
		fullName: string;
		name: string;
		isPrivate: boolean;
		url?: string;
	};
	pullRequest: {
		id: number;
		title: string;
		description?: string;
		state: string;
		url?: string;
		createdOn: string;
		updatedOn: string;
		sourceBranch?: string;
		destinationBranch?: string;
		author?: string;
	};
	commits: Array<{
		hash: string;
		message: string;
		date: string;
	}>;
	changedFiles: Array<{
		status: string;
		oldPath?: string;
		newPath?: string;
		linesAdded: number;
		linesRemoved: number;
	}>;
}

interface BridgeActivationPayload {
	schemaVersion: 1;
	kind: "ACTIVATE";
	eventId: string;
	workspaceId: string;
}

interface WebTriggerResponse {
	statusCode: number;
	headers: Record<string, string[]>;
	body: string;
}

const defaultRepository = new SqlGraphRepository();
const defaultBridgeStore = new BitbucketBridgeStore();

export interface BitbucketBridgeReceiverDependencies {
	repository: GraphRepository;
	bridgeStore: BitbucketBridgeEventStore;
	now?: () => number;
}

const defaultDependencies: BitbucketBridgeReceiverDependencies = {
	repository: defaultRepository,
	bridgeStore: defaultBridgeStore,
};

function response(statusCode: number, message: string): WebTriggerResponse {
	return {
		statusCode,
		headers: {
			"Content-Type": ["application/json"],
			"Cache-Control": ["no-store"],
		},
		body: JSON.stringify({ message }),
	};
}

function getHeader(
	headers: WebTriggerRequest["headers"],
	name: string,
): string | null {
	if (!headers) {
		return null;
	}

	const key = Object.keys(headers).find(
		(candidate) => candidate.toLowerCase() === name.toLowerCase(),
	);

	if (!key) {
		return null;
	}

	const values = headers[key];

	if (!values || values.length !== 1) {
		return null;
	}

	return values[0] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validatePayload(value: unknown): value is BridgePayload {
	if (!isRecord(value)) {
		return false;
	}

	if (
		value.schemaVersion !== 1 ||
		!isNonEmptyString(value.eventId) ||
		value.eventId.length > 255 ||
		!isNonEmptyString(value.workspaceId) ||
		value.workspaceId.length > 255 ||
		!isRecord(value.repository) ||
		!isRecord(value.pullRequest) ||
		!Array.isArray(value.commits) ||
		!Array.isArray(value.changedFiles)
	) {
		return false;
	}

	const repo = value.repository;
	const pr = value.pullRequest;

	if (
		!isNonEmptyString(repo.uuid) ||
		!isNonEmptyString(repo.slug) ||
		!isNonEmptyString(repo.fullName) ||
		!isNonEmptyString(repo.name) ||
		typeof repo.isPrivate !== "boolean" ||
		typeof pr.id !== "number" ||
		!Number.isSafeInteger(pr.id) ||
		Number(pr.id) <= 0 ||
		!isNonEmptyString(pr.title) ||
		!isNonEmptyString(pr.state) ||
		!isNonEmptyString(pr.createdOn) ||
		!isNonEmptyString(pr.updatedOn)
	) {
		return false;
	}

	const validStates = new Set(["OPEN", "MERGED", "DECLINED", "SUPERSEDED"]);

	if (!validStates.has(pr.state)) {
		return false;
	}

	for (const commit of value.commits) {
		if (
			!isRecord(commit) ||
			!isNonEmptyString(commit.hash) ||
			typeof commit.message !== "string" ||
			typeof commit.date !== "string"
		) {
			return false;
		}
	}

	for (const file of value.changedFiles) {
		if (
			!isRecord(file) ||
			!isNonEmptyString(file.status) ||
			!isNonNegativeInteger(file.linesAdded) ||
			!isNonNegativeInteger(file.linesRemoved) ||
			(file.oldPath !== undefined && typeof file.oldPath !== "string") ||
			(file.newPath !== undefined && typeof file.newPath !== "string")
		) {
			return false;
		}
	}

	return true;
}

function validateActivationPayload(value: unknown): value is BridgeActivationPayload {
	return (
		isRecord(value) &&
		value.schemaVersion === 1 &&
		value.kind === "ACTIVATE" &&
		isNonEmptyString(value.eventId) &&
		value.eventId.length <= 255 &&
		isNonEmptyString(value.workspaceId) &&
		value.workspaceId.length <= 255
	);
}

function toBitbucketRepository(payload: BridgePayload): BitbucketRepository {
	return {
		uuid: payload.repository.uuid,
		slug: payload.repository.slug,
		name: payload.repository.name,
		full_name: payload.repository.fullName,
		is_private: payload.repository.isPrivate,
		links: payload.repository.url
			? {
					html: {
						href: payload.repository.url,
					},
				}
			: undefined,
	};
}

function toBitbucketPullRequest(payload: BridgePayload): BitbucketPullRequest {
	const pullRequest = payload.pullRequest;

	return {
		id: pullRequest.id,
		title: pullRequest.title,
		description: pullRequest.description,
		state: pullRequest.state as BitbucketPullRequest["state"],
		created_on: pullRequest.createdOn,
		updated_on: pullRequest.updatedOn,
		author: pullRequest.author
			? {
					display_name: pullRequest.author,
				}
			: undefined,
		source: {
			branch: pullRequest.sourceBranch
				? { name: pullRequest.sourceBranch }
				: undefined,
		},
		destination: {
			branch: pullRequest.destinationBranch
				? { name: pullRequest.destinationBranch }
				: undefined,
		},
		links: pullRequest.url
			? {
					html: {
						href: pullRequest.url,
					},
				}
			: undefined,
	};
}

function toBitbucketCommits(payload: BridgePayload): BitbucketCommit[] {
	return payload.commits.map((commit) => ({
		hash: commit.hash,
		message: commit.message,
		date: commit.date,
	}));
}

function toBitbucketDiffStat(payload: BridgePayload): BitbucketDiffStat[] {
	return payload.changedFiles.map((file) => ({
		status: file.status,
		lines_added: file.linesAdded,
		lines_removed: file.linesRemoved,
		old: file.oldPath ? { path: file.oldPath } : undefined,
		new: file.newPath ? { path: file.newPath } : undefined,
	}));
}

/**
 * Receives signed Bitbucket events from the companion Forge app.
 *
 * The tenant ID is always obtained from the registered workspace link.
 * A tenant ID supplied in the request body is never trusted.
 */
export function createBitbucketBridgeReceiver(
	dependencies: BitbucketBridgeReceiverDependencies,
) {
	return async function receiveBitbucketBridgeEvent(
		request: WebTriggerRequest,
		_forgeContext?: unknown,
	): Promise<WebTriggerResponse> {
		if (request.method !== "POST") {
			return response(405, "POST is required.");
		}

		const rawBody = request.body;

		if (
			typeof rawBody !== "string" ||
			Buffer.byteLength(rawBody, "utf8") === 0 ||
			Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES
		) {
			return response(413, "Invalid or oversized request body.");
		}

		const timestamp = getHeader(request.headers, "X-TraceLine-Timestamp");

		const eventId = getHeader(request.headers, "X-TraceLine-Event-Id");

		const signature = getHeader(request.headers, "X-TraceLine-Signature");

		if (!timestamp || !eventId || !signature) {
			return response(401, "Missing bridge authentication headers.");
		}

		if (!/^\d{10}$/.test(timestamp) || eventId.length > 255) {
			return response(401, "Invalid bridge authentication headers.");
		}

		const timestampSeconds = Number(timestamp);
		const nowSeconds = Math.floor((dependencies.now ?? Date.now)() / 1000);

		if (
			!Number.isSafeInteger(timestampSeconds) ||
			Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS
		) {
			return response(401, "Expired bridge request.");
		}

		let parsed: unknown;

		try {
			parsed = JSON.parse(rawBody);
		} catch {
			return response(400, "Request body must contain valid JSON.");
		}

		if (!isRecord(parsed) || !isNonEmptyString(parsed.workspaceId)) {
			return response(400, "Missing workspace identity.");
		}

		if (
			!isNonEmptyString(parsed.eventId) ||
			parsed.eventId.length > 255 ||
			parsed.eventId !== eventId
		) {
			return response(401, "Event identity mismatch.");
		}

		let workspaceUuid: string;

		try {
			workspaceUuid = normalizeBitbucketWorkspaceUuid(parsed.workspaceId);
		} catch {
			return response(400, "Invalid Bitbucket workspace identity.");
		}

		if (validateActivationPayload(parsed)) {
			let activationLink;

			try {
				activationLink = await dependencies.bridgeStore.getWorkspaceActivationLink(
					workspaceUuid,
				);
			} catch (error) {
				console.error("TraceLine bridge activation lookup failed:", error);
				return response(500, "Unable to validate bridge activation.");
			}

			if (!activationLink) {
				return response(401, "Workspace is not awaiting bridge activation.");
			}

			const authenticated = verifyBridgeRequestSignature(
				activationLink.secret,
				timestamp,
				eventId,
				rawBody,
				signature,
			);

			if (!authenticated) {
				return response(401, "Invalid bridge signature.");
			}

			if (workspaceUuid !== activationLink.workspaceUuid) {
				return response(401, "Workspace identity mismatch.");
			}

			if (activationLink.status === "ACTIVE") {
				return response(200, "Bridge already activated.");
			}

			try {
				const activated = await dependencies.bridgeStore.activateWorkspace(workspaceUuid);

				if (!activated) {
					return response(409, "Bridge activation could not be completed.");
				}

				console.info("TraceLine Bitbucket bridge activated", {
					workspaceUuid,
				});

				return response(200, "Bridge activated.");
			} catch (error) {
				console.error("TraceLine bridge activation failed:", {
					workspaceUuid,
					error,
				});
				return response(500, "Bridge activation failed.");
			}
		}

		if (!validatePayload(parsed)) {
			return response(400, "Invalid Bitbucket event payload.");
		}

		let workspaceLink;

		try {
			workspaceLink = await dependencies.bridgeStore.getWorkspaceLink(workspaceUuid);
		} catch (error) {
			console.error("TraceLine bridge workspace lookup failed:", error);
			return response(500, "Unable to authenticate bridge request.");
		}

		if (!workspaceLink) {
			return response(401, "Workspace is not linked to TraceLine.");
		}

		const authenticated = verifyBridgeRequestSignature(
			workspaceLink.secret,
			timestamp,
			eventId,
			rawBody,
			signature,
		);

		if (!authenticated) {
			return response(401, "Invalid bridge signature.");
		}

		if (workspaceUuid !== workspaceLink.workspaceUuid) {
			return response(401, "Workspace identity mismatch.");
		}

		const payload = parsed;
		const tenantId = workspaceLink.tenantId;

		let claimed = false;

		try {
			claimed = await dependencies.bridgeStore.claimEvent({
				workspaceUuid: workspaceLink.workspaceUuid,
				eventId: payload.eventId,
			});

			if (!claimed) {
				return response(200, "Event already received.");
			}

			const bitbucketRepository = toBitbucketRepository(payload);
			const pullRequest = toBitbucketPullRequest(payload);
			const commits = toBitbucketCommits(payload);
			const diffstat = toBitbucketDiffStat(payload);

			const repositoryNode = mapBitbucketRepositoryToGraphNode(
				bitbucketRepository,
				tenantId,
				workspaceLink.workspaceUuid,
			);

			const pullRequestNode = mapBitbucketPullRequestToGraphNode(
				bitbucketRepository,
				pullRequest,
				commits,
				diffstat,
				tenantId,
				workspaceLink.workspaceUuid,
			);

			const repositoryPullRequestEdge = mapRepositoryPullRequestEdge(
				bitbucketRepository,
				pullRequest,
				tenantId,
			);

			await dependencies.repository.upsertNode(repositoryNode);
			await dependencies.repository.upsertNode(pullRequestNode);
			await dependencies.repository.upsertEdge(repositoryPullRequestEdge);

			const serviceLinker = new BitbucketChangeLinker(dependencies.repository);
			const jiraLinker = new BitbucketJiraLinker(dependencies.repository);

			const serviceLinks = await serviceLinker.linkPullRequestsToServices(
				tenantId,
				pullRequestNode.id,
			);
			const jiraLinks = await jiraLinker.linkPullRequestsToJira(
				tenantId,
				pullRequestNode.id,
			);

			await dependencies.bridgeStore.completeEvent({
				workspaceUuid: workspaceLink.workspaceUuid,
				eventId: payload.eventId,
			});

			console.info("TraceLine Bitbucket bridge event ingested", {
				tenantId,
				workspaceUuid: workspaceLink.workspaceUuid,
				repositoryUuid: bitbucketRepository.uuid,
				pullRequestId: pullRequest.id,
				commitCount: commits.length,
				changedFileCount: diffstat.length,
				matchedServiceCount: serviceLinks.matchedServices,
				unmatchedFileCount: serviceLinks.unmatchedFiles.length,
				linkedJiraIssueCount: jiraLinks.resolvedReferences,
			});

			return response(200, "Event accepted.");
		} catch (error) {
			console.error("TraceLine Bitbucket bridge ingestion failed:", {
				workspaceUuid: workspaceLink.workspaceUuid,
				eventId: payload.eventId,
				error,
			});

			if (claimed) {
				try {
					await dependencies.bridgeStore.failEvent({
						workspaceUuid: workspaceLink.workspaceUuid,
						eventId: payload.eventId,
						error:
							error instanceof Error
								? error.message
								: "Unknown ingestion failure.",
					});
				} catch (storeError) {
					console.error(
						"Unable to mark Bitbucket bridge event as failed:",
						storeError,
					);
				}
			}

			return response(500, "Bitbucket event ingestion failed.");
		}
	}
}

// Forge invokes webtrigger handlers with (request, context). Keep the runtime
// context out of dependency injection and close over the Forge SQL-backed
// dependencies initialized above.
export const receiveBitbucketBridgeEvent =
	createBitbucketBridgeReceiver(defaultDependencies);
