import Resolver from "@forge/resolver";
import api, { route, webTrigger } from "@forge/api";
import { Queue } from "@forge/events";

import { SqlGraphRepository } from "../../graph/repository/sql-graph-repository";
import { GraphNodeNotFoundError } from "../../graph/errors/graph-errors";
import type { GraphNode } from "../../graph/models/graph-node";

import { ImpactAnalysisService } from "../services/impact-analysis-service";
import { scoreImpactFindings } from "../services/impact-scoring";
import { explainImpactFindings } from "../services/impact-explanation";
import { buildImpactAnalysisRequest } from "./impact-api-contract";

import { SqlSyncCheckpointStore } from "../../sync/sql-sync-checkpoint-store";

import { RiskAnalysisService } from "../../risk/services/risk-analysis-service";

import {
	CriticalityService,
	CriticalityNodeNotFoundError,
} from "../../risk/services/criticality-service";

import {
	CriticalityValidationError,
	validateCriticalityUpdateRequest,
	validateCriticalityTarget,
} from "../../risk/validation/criticality-validator";
import { createBridgeSecret } from "../../integrations/bitbucket/bitbucket-bridge-crypto";
import { BitbucketChangeImpactService } from "../../integrations/bitbucket/bitbucket-change-impact-service";
import { ServiceConfigurationService } from "../../integrations/bitbucket/service-configuration-service";
import { countIndexedJiraIssues } from "../../integrations/jira/jira-readiness";
import type { ImpactAnalysisResult } from "../models/impact-analysis";
import {
	BitbucketBridgeStore,
	BitbucketWorkspaceTenantMismatchError,
	normalizeBitbucketWorkspaceUuid,
} from "../../integrations/bitbucket/bitbucket-bridge-store";
import { resolvePullRequestWorkspaceAssociation } from "../../integrations/bitbucket/bitbucket-workspace-association";

const resolver = new Resolver();

const repository = new SqlGraphRepository();
const analysisService = new ImpactAnalysisService(repository);
const checkpointStore = new SqlSyncCheckpointStore();
const riskAnalysisService = new RiskAnalysisService();
const criticalityService = new CriticalityService(repository);
const bridgeStore = new BitbucketBridgeStore();
const serviceConfigurationService = new ServiceConfigurationService(repository);

interface ResolverContext {
	cloudId?: string;
	accountId?: string;
}

interface ResolverRequest {
	payload: unknown;
	context: ResolverContext;
}

interface ApiError {
	ok: false;
	error: {
		code: string;
		message: string;
	};
}

interface JiraSyncEventBody extends Record<string, unknown> {
	tenantId: string;
	projectKey: string;
}

const jiraSyncQueue = new Queue<JiraSyncEventBody>({
	key: "jira-sync-queue",
});

function failure(code: string, message: string): ApiError {
	return {
		ok: false,
		error: {
			code,
			message,
		},
	};
}

function extractWorkspaceUuid(payload: unknown): string | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}

	const workspaceUuid = (payload as Record<string, unknown>).workspaceUuid;

	if (typeof workspaceUuid !== "string") {
		return null;
	}

	try {
		return normalizeBitbucketWorkspaceUuid(workspaceUuid);
	} catch {
		return null;
	}
}

/**
 * Pairing grants a workspace-level ingestion capability, so it is restricted
 * to Jira site administrators rather than ordinary project collaborators.
 */
async function canAdministerJira(): Promise<boolean> {
	try {
		const response = await api
			.asUser()
			.requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, {
				headers: {
					Accept: "application/json",
				},
			});

		if (!response.ok) {
			return false;
		}

		const result = (await response.json()) as {
			permissions?: {
				ADMINISTER?: {
					havePermission?: boolean;
				};
			};
		};

		return result.permissions?.ADMINISTER?.havePermission === true;
	} catch (error) {
		console.error("Jira administration permission check failed:", error);
		return false;
	}
}

async function authorizeJiraSiteAdministrator(
	context: ResolverContext,
): Promise<ApiError | null> {
	if (!context.cloudId) {
		return failure(
			"MISSING_INSTALLATION_CONTEXT",
			"Unable to identify the current Jira installation.",
		);
	}

	if (!context.accountId) {
		return failure(
			"AUTHENTICATION_REQUIRED",
			"An authenticated Atlassian user is required.",
		);
	}

	if (!(await canAdministerJira())) {
		return failure(
			"SITE_ADMIN_REQUIRED",
			"Jira site administration permission is required for this TraceLine operation.",
		);
	}

	return null;
}

async function getBridgeReceiverUrl(): Promise<string> {
	return webTrigger.getUrl("traceline-bitbucket-bridge");
}

function asRecord(payload: unknown): Record<string, unknown> | null {
	return payload !== null &&
		typeof payload === "object" &&
		!Array.isArray(payload)
			? (payload as Record<string, unknown>)
			: null;
}

function extractPullRequestNodeId(payload: unknown): string | null {
	const value = asRecord(payload)?.pullRequestNodeId;

	return typeof value === "string" && value.trim().length > 0 && value.length <= 255
		? value.trim()
		: null;
}

function parseTimestamp(value: unknown): number {
	if (typeof value !== "string") {
		return 0;
	}

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function getChangedFiles(node: GraphNode): Array<Record<string, unknown>> {
	const changedFiles = node.attributes.changedFiles;

	if (!Array.isArray(changedFiles)) {
		return [];
	}

	return changedFiles.filter(
		(file): file is Record<string, unknown> =>
			file !== null && typeof file === "object" && !Array.isArray(file),
	);
}

/**
 * Filter impact paths through user-readable Jira data before calculating or
 * returning risk. Bitbucket nodes are included only for admin-gated PR routes.
 */
async function analyzeAuthorizedImpact(
	tenantId: string,
	analysis: ImpactAnalysisResult,
	allowBitbucketNodes: boolean,
) {
	const [nodes, edges] = await Promise.all([
		repository.listNodes(tenantId),
		repository.listEdges(tenantId),
	]);

	const requiredNodeIds = new Set<string>();

	for (const finding of analysis.findings) {
		for (const path of finding.paths) {
			for (const nodeId of path.nodeIds) {
				requiredNodeIds.add(nodeId);
			}
		}
	}

	const potentialFindingIds = new Set(
		analysis.findings.map((finding) => finding.nodeId),
	);

	for (const edge of edges) {
		if (potentialFindingIds.has(edge.targetNodeId)) {
			requiredNodeIds.add(edge.sourceNodeId);
		}
	}

	const nodesById = new Map<string, GraphNode>(
		nodes.map((node): [string, GraphNode] => [node.id, node]),
	);

	const nodesToAuthorize = [...requiredNodeIds]
		.map((nodeId) => nodesById.get(nodeId))
		.filter((node): node is GraphNode => node !== undefined);

	const permissions = new Map<string, boolean>();
	const batchSize = 10;

	for (let index = 0; index < nodesToAuthorize.length; index += batchSize) {
		const batch = nodesToAuthorize.slice(index, index + batchSize);
		const results = await Promise.all(
			batch.map(async (node) => ({
				id: node.id,
				allowed:
					(allowBitbucketNodes && node.source === "BITBUCKET") ||
					(await canReadNode(node)),
			})),
		);

		for (const result of results) {
			permissions.set(result.id, result.allowed);
		}
	}

	const authorizedFindings = analysis.findings.flatMap((finding) => {
		const authorizedPaths = finding.paths.filter((path) =>
			path.nodeIds.every((nodeId) => permissions.get(nodeId) === true),
		);

		if (authorizedPaths.length === 0) {
			return [];
		}

		return [
			{
				...finding,
				paths: authorizedPaths,
				minimumDepth: Math.min(...authorizedPaths.map((path) => path.depth)),
				strongestPathConfidence: Math.max(
					...authorizedPaths.map((path) => path.confidence),
				),
			},
		];
	});

	const authorizedNodeIds = new Set(
		[...permissions.entries()]
			.filter(([, allowed]) => allowed)
			.map(([nodeId]) => nodeId),
	);
	const authorizedNodes = nodes.filter((node) => authorizedNodeIds.has(node.id));
	const authorizedFindingIds = new Set(
		authorizedFindings.map((finding) => finding.nodeId),
	);
	const authorizedPathEdgeIds = new Set(
		authorizedFindings.flatMap((finding) =>
			finding.paths.flatMap((path) => path.edgeIds),
		),
	);
	const authorizedEdges = edges.filter(
		(edge) =>
			authorizedNodeIds.has(edge.sourceNodeId) &&
			authorizedNodeIds.has(edge.targetNodeId) &&
			(authorizedPathEdgeIds.has(edge.id) ||
				authorizedFindingIds.has(edge.targetNodeId)),
	);

	const scoredFindings = scoreImpactFindings(authorizedFindings, authorizedEdges);
	const findings = explainImpactFindings(
		scoredFindings,
		authorizedNodes,
		authorizedEdges,
	);
	const filteredAnalysis: ImpactAnalysisResult = {
		...analysis,
		findings,
	};
	const risk = await riskAnalysisService.analyze({
		tenantId,
		impactAnalysis: filteredAnalysis,
		nodes: authorizedNodes,
		edges: authorizedEdges,
	});

	return {
		...filteredAnalysis,
		risk,
	};
}

/**
 * Extract and validate a Jira project key from resolver payload.
 */
function extractProjectKey(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}

	const projectKey = (payload as Record<string, unknown>).projectKey;

	if (
		typeof projectKey !== "string" ||
		!/^[A-Z][A-Z0-9_]{0,254}$/.test(projectKey)
	) {
		return null;
	}

	return projectKey;
}

/**
 * Verify that the current user can access a Jira project.
 */
async function canAccessProject(projectKey: string): Promise<boolean> {
	try {
		const response = await api
			.asUser()
			.requestJira(route`/rest/api/3/project/${projectKey}`, {
				headers: {
					Accept: "application/json",
				},
			});

		return response.ok;
	} catch (error) {
		console.error("Jira project permission check failed:", error);
		return false;
	}
}

/**
 * Verify that the current user can read a graph node.
 */
async function canReadNode(node: GraphNode): Promise<boolean> {
	try {
		if (node.source === "USER") {
			return true;
		}

		if (node.source === "JIRA" && node.type === "ISSUE") {
			if (!node.externalId) {
				return false;
			}

			const response = await api
				.asUser()
				.requestJira(route`/rest/api/3/issue/${node.externalId}?fields=key`, {
					headers: {
						Accept: "application/json",
					},
				});

			return response.ok;
		}

		if (node.source === "CONFLUENCE" && node.type === "DOCUMENT") {
			if (!node.externalId) {
				return false;
			}

			const response = await api
				.asUser()
				.requestConfluence(route`/wiki/api/v2/pages/${node.externalId}`, {
					headers: {
						Accept: "application/json",
					},
				});

			return response.ok;
		}

		// Fail closed for unsupported sources.
		return false;
	} catch (error) {
		console.error("Graph node permission check failed:", {
			nodeId: node.id,
			error,
		});

		return false;
	}
}

/**
 * Check permissions in batches to avoid excessive concurrent API requests.
 */
async function checkNodePermissions(
	nodes: GraphNode[],
): Promise<Map<string, boolean>> {
	const permissions = new Map<string, boolean>();
	const batchSize = 10;

	for (let index = 0; index < nodes.length; index += batchSize) {
		const batch = nodes.slice(index, index + batchSize);

		const results = await Promise.all(
			batch.map(async (node) => ({
				id: node.id,
				allowed: await canReadNode(node),
			})),
		);

		for (const result of results) {
			permissions.set(result.id, result.allowed);
		}
	}

	return permissions;
}

/**
 * Queue a Jira project synchronization.
 *
 * The actual ingestion runs in the background consumer.
 * This resolver does not wait for Jira issue ingestion.
 */
resolver.define(
	"jira.syncProject",
	async ({ payload, context }: ResolverRequest) => {
		const tenantId = context.cloudId;

		if (!tenantId) {
			return failure(
				"MISSING_INSTALLATION_CONTEXT",
				"Unable to identify the current Jira installation.",
			);
		}

		if (!context.accountId) {
			return failure(
				"AUTHENTICATION_REQUIRED",
				"An authenticated Atlassian user is required.",
			);
		}

		const projectKey = extractProjectKey(payload);

		if (!projectKey) {
			return failure(
				"INVALID_PROJECT_KEY",
				"A valid Jira project key is required.",
			);
		}

		if (!(await canAccessProject(projectKey))) {
			return failure(
				"PROJECT_ACCESS_DENIED",
				"You do not have permission to access this Jira project.",
			);
		}

		const now = Date.now();

		try {
			const existing = await checkpointStore.get(tenantId, "JIRA", projectKey);

			// Avoid queueing another job while one is active.
			if (existing?.status === "QUEUED" || existing?.status === "IN_PROGRESS") {
				return {
					ok: true,
					data: {
						status: existing.status,
						projectKey,
						alreadyRunning: true,
					},
				};
			}

			// Persist QUEUED before submitting the event.
			// This ensures the consumer can see the checkpoint
			// even if it starts immediately after the push.
			await checkpointStore.save({
				tenantId,
				source: "JIRA",
				scopeId: projectKey,
				status: "QUEUED",
				lastSuccessfulSyncAt: existing?.lastSuccessfulSyncAt ?? null,
				startedAt: now,
				completedAt: null,
				lastError: null,
				updatedAt: now,
				jobId: null,
				result: null,
			});

			try {
				await jiraSyncQueue.push({
					body: {
						tenantId,
						projectKey,
					},
					concurrency: {
						key: `${tenantId}:${projectKey}`,
						limit: 1,
					},
				});

				console.info("TraceLine Jira synchronization queued:", {
					tenantId,
					projectKey,
				});

				return {
					ok: true,
					data: {
						status: "QUEUED",
						projectKey,
					},
				};
			} catch (error) {
				const failedAt = Date.now();

				await checkpointStore.save({
					tenantId,
					source: "JIRA",
					scopeId: projectKey,
					status: "FAILED",
					lastSuccessfulSyncAt: existing?.lastSuccessfulSyncAt ?? null,
					startedAt: now,
					completedAt: failedAt,
					lastError:
						error instanceof Error
							? error.message
							: "Unable to enqueue Jira synchronization.",
					updatedAt: failedAt,
					jobId: null,
					result: null,
				});

				throw error;
			}
		} catch (error) {
			console.error("TraceLine Jira sync queue operation failed:", error);

			return failure(
				"JIRA_SYNC_QUEUE_FAILED",
				"Unable to queue Jira project synchronization.",
			);
		}
	},
);

/**
 * Retrieve the latest Jira project synchronization status.
 */
resolver.define(
	"jira.getSyncStatus",
	async ({ payload, context }: ResolverRequest) => {
		const tenantId = context.cloudId;

		if (!tenantId) {
			return failure(
				"MISSING_INSTALLATION_CONTEXT",
				"Unable to identify the current Jira installation.",
			);
		}

		if (!context.accountId) {
			return failure(
				"AUTHENTICATION_REQUIRED",
				"An authenticated Atlassian user is required.",
			);
		}

		const projectKey = extractProjectKey(payload);

		if (!projectKey) {
			return failure(
				"INVALID_PROJECT_KEY",
				"A valid Jira project key is required.",
			);
		}

		if (!(await canAccessProject(projectKey))) {
			return failure(
				"PROJECT_ACCESS_DENIED",
				"You do not have permission to access this Jira project.",
			);
		}

		try {
			const checkpoint = await checkpointStore.get(
				tenantId,
				"JIRA",
				projectKey,
			);

			return {
				ok: true,
				data: checkpoint,
			};
		} catch (error) {
			console.error("TraceLine sync status lookup failed:", error);

			return failure(
				"SYNC_STATUS_FAILED",
				"Unable to retrieve Jira synchronization status.",
			);
		}
	},
);

/**
 * Report only project access and aggregate ingestion readiness for setup.
 * Project issue details stay behind the regular Jira permission check.
 */
resolver.define(
	"setup.checkJiraProject",
	async ({ payload, context }: ResolverRequest) => {
		const tenantId = context.cloudId;

		if (!tenantId) {
			return failure(
				"MISSING_INSTALLATION_CONTEXT",
				"Unable to identify the current Jira installation.",
			);
		}

		if (!context.accountId) {
			return failure(
				"AUTHENTICATION_REQUIRED",
				"An authenticated Atlassian user is required.",
			);
		}

		if (!(await canAdministerJira())) {
			return failure(
				"SITE_ADMIN_REQUIRED",
				"Jira site administration permission is required to check TraceLine setup readiness.",
			);
		}

		const projectKey = extractProjectKey(payload);

		if (!projectKey) {
			return failure(
				"INVALID_PROJECT_KEY",
				"A valid Jira project key is required.",
			);
		}

		if (!(await canAccessProject(projectKey))) {
			return failure(
				"PROJECT_ACCESS_DENIED",
				"You do not have permission to access this Jira project.",
			);
		}

		try {
			const [nodes, checkpoint] = await Promise.all([
				repository.listNodes(tenantId),
				checkpointStore.get(tenantId, "JIRA", projectKey),
			]);
			const indexedIssueCount = countIndexedJiraIssues(
				nodes,
				tenantId,
				projectKey,
			);

			return {
				ok: true,
				data: {
					projectKey,
					accessible: true,
					indexedIssueCount,
					syncStatus: checkpoint?.status ?? "NOT_STARTED",
					lastSuccessfulSyncAt: checkpoint?.lastSuccessfulSyncAt ?? null,
					lastSyncError:
						checkpoint?.status === "FAILED" ? checkpoint.lastError : null,
				},
			};
		} catch (error) {
			console.error("TraceLine Jira setup readiness lookup failed:", error);
			return failure(
				"JIRA_READINESS_FAILED",
				"Unable to check Jira project ingestion readiness.",
			);
		}
	},
);

/**
 * Return pairing metadata without ever decrypting or exposing the shared
 * secret. A pairing owned by another tenant is intentionally indistinguishable
 * from an unpaired workspace.
 */
resolver.define(
	"bridge.getPairingStatus",
	async ({ payload, context }: ResolverRequest) => {
		const authorizationFailure = await authorizeJiraSiteAdministrator(context);

		if (authorizationFailure) {
			return authorizationFailure;
		}

		const workspaceUuid = extractWorkspaceUuid(payload);

		if (!workspaceUuid) {
			return failure(
				"INVALID_WORKSPACE_UUID",
				"A valid Bitbucket workspace UUID is required.",
			);
		}

		try {
			const pairing = await bridgeStore.getWorkspacePairing(workspaceUuid);

			if (!pairing || pairing.tenantId !== context.cloudId) {
				return {
					ok: true,
					data: {
						workspaceUuid,
						paired: false,
					},
				};
			}

			return {
				ok: true,
				data: {
					workspaceUuid: pairing.workspaceUuid,
					paired: pairing.status === "ACTIVE",
					status: pairing.status,
					createdAt: pairing.createdAt,
					updatedAt: pairing.updatedAt,
				},
			};
		} catch (error) {
			console.error("TraceLine bridge pairing status lookup failed:", error);

			return failure(
				"BRIDGE_PAIRING_STATUS_FAILED",
				"Unable to retrieve Bitbucket workspace pairing status.",
			);
		}
	},
);

resolver.define(
	"bridge.pairWorkspace",
	async ({ payload, context }: ResolverRequest) => {
		const authorizationFailure = await authorizeJiraSiteAdministrator(context);

		if (authorizationFailure) {
			return authorizationFailure;
		}

		const workspaceUuid = extractWorkspaceUuid(payload);

		if (!workspaceUuid) {
			return failure(
				"INVALID_WORKSPACE_UUID",
				"A valid Bitbucket workspace UUID is required.",
			);
		}

		const tenantId = context.cloudId!;

		try {
			const existing = await bridgeStore.getWorkspacePairing(workspaceUuid);

			if (existing?.tenantId !== undefined && existing.tenantId !== tenantId) {
				return failure(
					"WORKSPACE_UNAVAILABLE",
					"This Bitbucket workspace cannot be paired with this TraceLine site.",
				);
			}

			if (existing?.status === "ACTIVE") {
				return failure(
					"WORKSPACE_ALREADY_PAIRED",
					"This workspace is already paired. Use secret rotation to replace its companion configuration.",
				);
			}

			const bridgeReceiverUrl = await getBridgeReceiverUrl();
			const secret = createBridgeSecret();

			await bridgeStore.registerWorkspace({
				workspaceUuid,
				tenantId,
				secret,
			});

			// This is the only resolver response that contains the secret. It must
			// be copied into the companion configuration immediately.
			return {
				ok: true,
				data: {
					workspaceUuid,
					bridgeReceiverUrl,
					secret,
				},
			};
		} catch (error) {
			if (error instanceof BitbucketWorkspaceTenantMismatchError) {
				return failure(
					"WORKSPACE_UNAVAILABLE",
					"This Bitbucket workspace cannot be paired with this TraceLine site.",
				);
			}

			console.error("TraceLine Bitbucket workspace pairing failed:", error);

			return failure(
				"BRIDGE_PAIRING_FAILED",
				"Unable to pair the Bitbucket workspace. No secret was saved.",
			);
		}
	},
);

resolver.define(
	"bridge.rotateWorkspaceSecret",
	async ({ payload, context }: ResolverRequest) => {
		const authorizationFailure = await authorizeJiraSiteAdministrator(context);

		if (authorizationFailure) {
			return authorizationFailure;
		}

		const workspaceUuid = extractWorkspaceUuid(payload);

		if (!workspaceUuid) {
			return failure(
				"INVALID_WORKSPACE_UUID",
				"A valid Bitbucket workspace UUID is required.",
			);
		}

		const tenantId = context.cloudId!;

		try {
			const existing = await bridgeStore.getWorkspacePairing(workspaceUuid);

			if (!existing || existing.tenantId !== tenantId) {
				return failure(
					"WORKSPACE_NOT_PAIRED",
					"This workspace is not paired with the current TraceLine site.",
				);
			}

			const bridgeReceiverUrl = await getBridgeReceiverUrl();
			const secret = createBridgeSecret();

			await bridgeStore.registerWorkspace({
				workspaceUuid,
				tenantId,
				secret,
			});

			return {
				ok: true,
				data: {
					workspaceUuid,
					bridgeReceiverUrl,
					secret,
				},
			};
		} catch (error) {
			if (error instanceof BitbucketWorkspaceTenantMismatchError) {
				return failure(
					"WORKSPACE_NOT_PAIRED",
					"This workspace is not paired with the current TraceLine site.",
				);
			}

			console.error("TraceLine Bitbucket secret rotation failed:", error);

			return failure(
				"BRIDGE_SECRET_ROTATION_FAILED",
				"Unable to rotate the Bitbucket workspace secret. The current secret remains active.",
			);
		}
	},
);

resolver.define(
	"service.listConfiguration",
	async ({ context }: ResolverRequest) => {
		const authorizationFailure = await authorizeJiraSiteAdministrator(context);

		if (authorizationFailure) {
			return authorizationFailure;
		}

		const tenantId = context.cloudId!;

		try {
			const [nodes, edges] = await Promise.all([
				repository.listNodes(tenantId),
				repository.listEdges(tenantId),
			]);
			const repositories = nodes.filter(
				(node) => node.type === "REPOSITORY" && node.source === "BITBUCKET",
			);
			const pairings = new Map<string, boolean>();

			await Promise.all(
				repositories.map(async (node) => {
					const workspaceUuid = node.attributes.workspaceId;

					if (typeof workspaceUuid !== "string" || !workspaceUuid.trim()) {
						return;
					}

					try {
						const pairing = await bridgeStore.getWorkspacePairing(workspaceUuid);
						pairings.set(
							workspaceUuid,
							pairing?.tenantId === tenantId && pairing.status === "ACTIVE",
						);
					} catch {
						pairings.set(workspaceUuid, false);
					}
				}),
			);

			return {
				ok: true,
				data: {
					repositories: repositories.map((node) => {
						const workspaceUuid = node.attributes.workspaceId;

						return {
							id: node.id,
						repositoryUuid:
								typeof node.attributes.repositoryUuid === "string"
									? node.attributes.repositoryUuid
									: node.externalId,
							name: node.name,
							fullName: node.attributes.fullName ?? null,
							url: node.url ?? null,
							isPrivate: node.attributes.isPrivate === true,
							workspaceUuid:
								typeof workspaceUuid === "string" ? workspaceUuid : null,
							paired:
								typeof workspaceUuid === "string"
									? pairings.get(workspaceUuid) === true
									: false,
						};
					}),
					services: nodes
						.filter((node) => node.type === "SERVICE" && node.source === "USER")
						.map((node) => ({
							id: node.id,
							name: node.name,
							criticality: node.attributes.criticality ?? "UNKNOWN",
							mappings: Array.isArray(node.attributes.bitbucketSourceMappings)
								? node.attributes.bitbucketSourceMappings
								: [],
							dependsOnServiceIds: edges
								.filter(
									(edge) =>
										edge.sourceNodeId === node.id &&
										edge.type === "DEPENDS_ON",
								)
								.map((edge) => edge.targetNodeId)
								.sort(),
						})),
				},
			};
		} catch (error) {
			console.error("TraceLine service configuration lookup failed:", error);
			return failure(
				"SERVICE_CONFIGURATION_FAILED",
				"Unable to retrieve connected repositories and service configuration.",
			);
		}
	},
);

resolver.define(
	"service.saveConfiguration",
	async ({ payload, context }: ResolverRequest) => {
		const authorizationFailure = await authorizeJiraSiteAdministrator(context);

		if (authorizationFailure) {
			return authorizationFailure;
		}

		const tenantId = context.cloudId!;
		const accountId = context.accountId!;
		const input = asRecord(payload);

		if (
			!input ||
			typeof input.serviceId !== "string" ||
			typeof input.name !== "string" ||
			!Array.isArray(input.mappings)
		) {
			return failure(
				"INVALID_SERVICE_CONFIGURATION",
				"A service ID, name, source mappings, and criticality are required.",
			);
		}

		try {
			const result = await serviceConfigurationService.save({
				tenantId,
				updatedBy: accountId,
				serviceId: input.serviceId,
				name: input.name,
				mappings: input.mappings,
				dependsOnServiceIds: input.dependsOnServiceIds,
				criticality: input.criticality,
			});

			return {
				ok: true,
				data: {
					service: {
						id: result.service.id,
						name: result.service.name,
						criticality: result.service.attributes.criticality,
						mappings: result.mappings,
						dependsOnServiceIds: result.dependsOnServiceIds,
					},
					staleDependenciesRemoved: result.staleDependenciesRemoved,
				},
			};
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Invalid service configuration.";

			if (
				message.includes("required") ||
				message.includes("invalid") ||
				message.includes("must ") ||
				message.includes("cannot ") ||
				message.includes("no more than") ||
				message.includes("duplicates") ||
				message.includes("does not exist") ||
				message.includes("has not been received") ||
				message.includes("format") ||
				message.includes("characters")
			) {
				return failure("INVALID_SERVICE_CONFIGURATION", message);
			}

			console.error("TraceLine service configuration save failed:", error);
			return failure(
				"SERVICE_CONFIGURATION_SAVE_FAILED",
				"Unable to save the service configuration.",
			);
		}
	},
);

resolver.define(
	"bitbucket.listPullRequests",
	async ({ context }: ResolverRequest) => {
		const authorizationFailure = await authorizeJiraSiteAdministrator(context);

		if (authorizationFailure) {
			return authorizationFailure;
		}

		try {
			const tenantId = context.cloudId!;
			const nodes = await repository.listNodes(tenantId);
			const pullRequests = nodes
				.filter(
					(node) =>
						node.type === "PULL_REQUEST" && node.source === "BITBUCKET",
				)
				.sort(
					(a, b) =>
						parseTimestamp(b.attributes.updatedOn) -
						parseTimestamp(a.attributes.updatedOn),
				)
				.slice(0, 100);

			return {
				ok: true,
				data: {
					pullRequests: pullRequests.map((node) => ({
						id: node.id,
						name: node.name,
						url: node.url ?? null,
						state: node.attributes.state ?? "UNKNOWN",
						author:
							typeof asRecord(node.attributes.author)?.displayName === "string"
								? asRecord(node.attributes.author)?.displayName
								: null,
						repository:
							node.attributes.repositoryFullName ??
							node.attributes.repositorySlug ??
							"Unknown repository",
						repositoryUuid: node.attributes.repositoryUuid ?? null,
						changedFileCount: getChangedFiles(node).length,
						updatedOn: node.attributes.updatedOn ?? null,
						risk: null,
					})),
				},
			};
		} catch (error) {
			console.error("TraceLine pull request list failed:", error);
			return failure(
				"PULL_REQUEST_LIST_FAILED",
				"Unable to retrieve Bitbucket pull requests.",
			);
		}
	},
);

resolver.define(
	"bitbucket.analyzePullRequest",
	async ({ payload, context }: ResolverRequest) => {
		const authorizationFailure = await authorizeJiraSiteAdministrator(context);

		if (authorizationFailure) {
			return authorizationFailure;
		}

		const tenantId = context.cloudId!;
		const pullRequestNodeId = extractPullRequestNodeId(payload);

		if (!pullRequestNodeId) {
			return failure(
				"INVALID_PULL_REQUEST",
				"A valid Bitbucket pull request is required.",
			);
		}

		try {
			const pullRequest = await repository.getNode(tenantId, pullRequestNodeId);

			if (
				!pullRequest ||
				pullRequest.type !== "PULL_REQUEST" ||
				pullRequest.source !== "BITBUCKET"
			) {
				return failure(
					"PULL_REQUEST_NOT_FOUND",
					"The pull request is not available in this TraceLine site.",
				);
			}

			const workspaceAssociation = await resolvePullRequestWorkspaceAssociation(
				repository,
				tenantId,
				pullRequest,
			);

			if (!workspaceAssociation) {
				return failure(
					"WORKSPACE_NOT_PAIRED",
					"The pull request is missing its paired Bitbucket workspace.",
				);
			}

			const workspaceUuid = workspaceAssociation.workspaceUuid;

			// Older bridge events could create a PR before its workspace attribute
			// was persisted. Repair that record only from the matching, same-tenant
			// repository node, never from the frontend request.
			if (workspaceAssociation.source === "REPOSITORY") {
				await repository.upsertNode({
					...pullRequest,
					attributes: {
						...pullRequest.attributes,
						workspaceId: workspaceUuid,
					},
				});
			}

			const pairing = await bridgeStore.getWorkspacePairing(workspaceUuid);

			if (
				!pairing ||
				pairing.tenantId !== tenantId ||
				pairing.status !== "ACTIVE"
			) {
				return failure(
					"WORKSPACE_NOT_PAIRED",
					"The pull request's Bitbucket workspace is not actively paired with this TraceLine site.",
				);
			}

			const changeImpactService = new BitbucketChangeImpactService<ImpactAnalysisResult>(
				repository,
				{ analyze: (request) => analysisService.analyze(request) },
			);
			const result = await changeImpactService.analyzePullRequest({
				tenantId,
				pullRequestNodeId,
				propagationTypes: ["MODIFIES", "DEPENDS_ON", "BLOCKS", "IMPLEMENTS"],
				reverseDependencyEdges: true,
			});
			const authorizedAnalysis = await analyzeAuthorizedImpact(
				tenantId,
				result.analysis,
				true,
			);
			const changedFiles = getChangedFiles(pullRequest);
			const [edges, nodes] = await Promise.all([
				repository.getOutgoingEdges(tenantId, pullRequest.id, ["MODIFIES"]),
				repository.listNodes(tenantId),
			]);
			const nodesById = new Map(nodes.map((node) => [node.id, node]));

			return {
				ok: true,
				data: {
					pullRequest: {
						id: pullRequest.id,
						name: pullRequest.name,
						url: pullRequest.url ?? null,
						state: pullRequest.attributes.state ?? "UNKNOWN",
						author:
							asRecord(pullRequest.attributes.author)?.displayName ?? null,
						repository:
							pullRequest.attributes.repositoryFullName ??
							pullRequest.attributes.repositorySlug ??
							"Unknown repository",
						updatedOn: pullRequest.attributes.updatedOn ?? null,
					},
					changedFiles,
					mapping: {
						...result.mapping,
						matchedServiceCount: result.mapping.matchedServices,
						matchedServices: edges.map((edge) => ({
							id: edge.targetNodeId,
							name: nodesById.get(edge.targetNodeId)?.name ?? edge.targetNodeId,
							evidenceText: edge.provenance.evidenceText ?? null,
						})),
					},
					analysis: authorizedAnalysis,
				},
			};
		} catch (error) {
			if (error instanceof GraphNodeNotFoundError) {
				return failure(
					"PULL_REQUEST_NOT_FOUND",
					"The pull request is not available in this TraceLine site.",
				);
			}

			console.error("TraceLine pull request analysis failed:", error);
			return failure(
				"PULL_REQUEST_ANALYSIS_FAILED",
				"The pull request impact analysis could not be completed.",
			);
		}
	},
);

/**
 * Analyze the currently selected Jira issue.
 */

resolver.define(
	"impact.analyze",
	async ({ payload, context }: ResolverRequest) => {
		const tenantId = context.cloudId;
		const startedAt = Date.now();

		const logStage = (stage: string, details: Record<string, unknown> = {}) => {
			console.info("TraceLine impact analysis:", {
				stage,
				elapsedMs: Date.now() - startedAt,
				...details,
			});
		};

		logStage("STARTED");

		if (!tenantId) {
			return failure(
				"MISSING_INSTALLATION_CONTEXT",
				"Unable to identify the current Jira installation.",
			);
		}

		if (!context.accountId) {
			return failure(
				"AUTHENTICATION_REQUIRED",
				"An authenticated Atlassian user is required.",
			);
		}

		try {
			const request = buildImpactAnalysisRequest(payload, tenantId);

			logStage("REQUEST_VALIDATED", {
				sourceNodeId: request.sourceNodeId,
			});

			const sourceNode = await repository.getNode(
				tenantId,
				request.sourceNodeId,
			);

			logStage("SOURCE_NODE_LOADED", {
				found: Boolean(sourceNode),
			});

			if (!sourceNode) {
				return failure(
					"SOURCE_NOT_FOUND",
					"The requested source node does not exist. Synchronize the Jira project first.",
				);
			}

			const sourceAllowed = await canReadNode(sourceNode);

			logStage("SOURCE_PERMISSION_CHECKED", {
				allowed: sourceAllowed,
			});

			if (!sourceAllowed) {
				return failure(
					"SOURCE_ACCESS_DENIED",
					"You do not have permission to access the requested source.",
				);
			}

			const analysis = await analysisService.analyze(request);

			logStage("TRAVERSAL_COMPLETED", {
				findings: analysis.findings.length,
				truncated: analysis.truncated,
			});

			const [nodes, edges] = await Promise.all([
				repository.listNodes(tenantId),
				repository.listEdges(tenantId),
			]);

			logStage("GRAPH_LOADED", {
				nodes: nodes.length,
				edges: edges.length,
			});

			// Collect nodes used by impact paths.
			const requiredNodeIds = new Set<string>();

			for (const finding of analysis.findings) {
				for (const path of finding.paths) {
					for (const nodeId of path.nodeIds) {
						requiredNodeIds.add(nodeId);
					}
				}
			}

			// Also authorize incoming dependency sources for affected nodes.
			// These nodes contribute to dependency centrality.
			const potentialFindingIds = new Set(
				analysis.findings.map((finding) => finding.nodeId),
			);

			for (const edge of edges) {
				if (potentialFindingIds.has(edge.targetNodeId)) {
					requiredNodeIds.add(edge.sourceNodeId);
				}
			}

			const nodesById = new Map<string, GraphNode>(
				nodes.map((node): [string, GraphNode] => [node.id, node]),
			);

			const nodesToAuthorize = [...requiredNodeIds]
				.map((nodeId) => nodesById.get(nodeId))
				.filter((node): node is GraphNode => node !== undefined);

			logStage("PERMISSION_CHECK_STARTED", {
				nodesToAuthorize: nodesToAuthorize.length,
			});

			const permissions = await checkNodePermissions(nodesToAuthorize);

			logStage("PERMISSION_CHECK_COMPLETED", {
				checked: permissions.size,
				allowed: [...permissions.values()].filter(Boolean).length,
			});

			// Retain only impact paths whose every node is readable.
			const authorizedFindings = analysis.findings.flatMap((finding) => {
				const authorizedPaths = finding.paths.filter((path) =>
					path.nodeIds.every((nodeId) => permissions.get(nodeId) === true),
				);

				if (authorizedPaths.length === 0) {
					return [];
				}

				return [
					{
						...finding,
						paths: authorizedPaths,
						minimumDepth: Math.min(
							...authorizedPaths.map((path) => path.depth),
						),
						strongestPathConfidence: Math.max(
							...authorizedPaths.map((path) => path.confidence),
						),
					},
				];
			});

			// Build the authorized graph.
			const authorizedNodeIds = new Set(
				[...permissions.entries()]
					.filter(([, allowed]) => allowed)
					.map(([nodeId]) => nodeId),
			);

			const authorizedNodes = nodes.filter((node) =>
				authorizedNodeIds.has(node.id),
			);

			const authorizedFindingIds = new Set(
				authorizedFindings.map((finding) => finding.nodeId),
			);

			// Identify edges that belong to authorized impact paths.
			const authorizedPathPairs = new Set<string>();

			for (const finding of authorizedFindings) {
				for (const path of finding.paths) {
					for (let index = 0; index < path.nodeIds.length - 1; index++) {
						authorizedPathPairs.add(
							JSON.stringify([path.nodeIds[index], path.nodeIds[index + 1]]),
						);
					}
				}
			}

			// Keep path edges and readable incoming dependency edges.
			const authorizedEdges = edges.filter((edge) => {
				if (
					!authorizedNodeIds.has(edge.sourceNodeId) ||
					!authorizedNodeIds.has(edge.targetNodeId)
				) {
					return false;
				}

				const isPathEdge = authorizedPathPairs.has(
					JSON.stringify([edge.sourceNodeId, edge.targetNodeId]),
				);

				const isIncomingFindingEdge = authorizedFindingIds.has(
					edge.targetNodeId,
				);

				return isPathEdge || isIncomingFindingEdge;
			});

			const scoredFindings = scoreImpactFindings(
				authorizedFindings,
				authorizedEdges,
			);

			logStage("SCORING_COMPLETED", {
				findings: scoredFindings.length,
			});

			const explainedFindings = explainImpactFindings(
				scoredFindings,
				authorizedNodes,
				authorizedEdges,
			);

			// Calculate risk after permission filtering.
			const risk = await riskAnalysisService.analyze({
				tenantId,
				impactAnalysis: {
					...analysis,
					findings: scoredFindings,
				},
				nodes: authorizedNodes,
				edges: authorizedEdges,
			});

			logStage("RISK_ANALYSIS_COMPLETED", {
				overallScore: risk.overallScore,
				overallLevel: risk.overallLevel,
				affectedNodeCount: risk.affectedNodeCount,
			});

			logStage("COMPLETED", {
				findings: explainedFindings.length,
			});

			return {
				ok: true,
				data: {
					...analysis,
					findings: explainedFindings,
					risk,
				},
			};
		} catch (error) {
			if (error instanceof GraphNodeNotFoundError) {
				return failure(
					"SOURCE_NOT_FOUND",
					"The requested source node does not exist.",
				);
			}

			if (error instanceof Error) {
				if (
					error.message.includes("must be") ||
					error.message.includes("is required") ||
					error.message.includes("too long") ||
					error.message.includes("must be a number")
				) {
					return failure("INVALID_REQUEST", error.message);
				}
			}

			console.error("TraceLine impact analysis failed:", error);

			return failure(
				"IMPACT_ANALYSIS_FAILED",
				"Impact analysis could not be completed.",
			);
		}
	},
);

async function getJiraProjectKey(node: GraphNode): Promise<string> {
	const projectKey = node.attributes?.projectKey;

	if (typeof projectKey === "string" && projectKey.trim()) {
		return projectKey.trim();
	}

	if (node.type === "PROJECT") {
		const externalId = node.externalId;

		if (typeof externalId === "string" && externalId.trim()) {
			return externalId.trim();
		}

		throw new CriticalityValidationError(
			"Cannot determine the Jira project key.",
		);
	}

	if (node.type !== "ISSUE") {
		throw new CriticalityValidationError(
			"Cannot determine the Jira project for this component.",
		);
	}

	const externalId = node.externalId;

	if (typeof externalId !== "string" || !externalId.trim()) {
		throw new CriticalityValidationError(
			"The Jira issue does not have a valid external ID.",
		);
	}

	const response = await api
		.asUser()
		.requestJira(route`/rest/api/3/issue/${externalId}?fields=project`, {
			headers: {
				Accept: "application/json",
			},
		});

	if (!response.ok) {
		throw new Error("Unable to verify Jira project access for this issue.");
	}

	const issue = (await response.json()) as {
		fields?: {
			project?: {
				key?: string;
			};
		};
	};

	const key = issue.fields?.project?.key;

	if (!key) {
		throw new CriticalityValidationError(
			"The Jira issue does not have a readable project.",
		);
	}

	return key;
}

async function canAdministerJiraProject(projectKey: string): Promise<boolean> {
	const response = await api
		.asUser()
		.requestJira(
			route`/rest/api/3/mypermissions?projectKey=${projectKey}&permissions=ADMINISTER_PROJECTS`,
			{
				headers: {
					Accept: "application/json",
				},
			},
		);

	if (!response.ok) {
		throw new Error("Unable to verify Jira project administration permission.");
	}

	const result = (await response.json()) as {
		permissions?: {
			ADMINISTER_PROJECTS?: {
				havePermission?: boolean;
			};
		};
	};

	return result.permissions?.ADMINISTER_PROJECTS?.havePermission === true;
}

async function authorizeCriticalityUpdate(node: GraphNode): Promise<void> {
	if (node.source !== "JIRA") {
		throw new CriticalityValidationError(
			"Criticality updates are currently supported only for Jira-backed components.",
		);
	}

	const projectKey = await getJiraProjectKey(node);

	const allowed = await canAdministerJiraProject(projectKey);

	if (!allowed) {
		throw new Error(
			"You need Jira project administration permission to update component criticality.",
		);
	}
}

resolver.define(
	"risk.updateCriticality",
	async ({ payload, context }: ResolverRequest) => {
		const tenantId = context.cloudId;
		const accountId = context.accountId;

		if (!tenantId) {
			return failure(
				"MISSING_INSTALLATION_CONTEXT",
				"Unable to identify the Forge installation.",
			);
		}

		if (!accountId) {
			return failure(
				"AUTHENTICATION_REQUIRED",
				"An authenticated Atlassian user is required.",
			);
		}

		try {
			const request = validateCriticalityUpdateRequest(payload);

			const node = await repository.getNode(tenantId, request.nodeId);

			if (!node) {
				throw new CriticalityNodeNotFoundError(request.nodeId);
			}

			validateCriticalityTarget(node, tenantId);

			await authorizeCriticalityUpdate(node);

			const result = await criticalityService.updateCriticality({
				tenantId,
				updatedBy: accountId,
				request,
			});

			return {
				ok: true,
				data: result,
			};
		} catch (error) {
			if (error instanceof CriticalityNodeNotFoundError) {
				return failure("NODE_NOT_FOUND", error.message);
			}

			if (error instanceof CriticalityValidationError) {
				return failure("INVALID_CRITICALITY_REQUEST", error.message);
			}

			if (
				error instanceof Error &&
				error.message.includes("project administration permission")
			) {
				return failure("CRITICALITY_ACCESS_DENIED", error.message);
			}

			console.error("TraceLine criticality update failed:", error);

			return failure(
				"CRITICALITY_UPDATE_FAILED",
				"Unable to update component criticality.",
			);
		}
	},
);

export const handler = resolver.getDefinitions();
