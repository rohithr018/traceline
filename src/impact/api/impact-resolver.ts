import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";
import { Queue } from "@forge/events";

import { SqlGraphRepository } from "../../graph/repository/sql-graph-repository";
import { GraphNodeNotFoundError } from "../../graph/errors/graph-errors";
import type { GraphNode } from "../../graph/models/graph-node";

import { ImpactAnalysisService } from "../services/impact-analysis-service";
import { scoreImpactFindings } from "../services/impact-scoring";
import { explainImpactFindings } from "../services/impact-explanation";
import { buildImpactAnalysisRequest } from "./impact-api-contract";

import { SqlSyncCheckpointStore } from "../../sync/sql-sync-checkpoint-store";

const resolver = new Resolver();

const repository = new SqlGraphRepository();
const analysisService = new ImpactAnalysisService(repository);
const checkpointStore = new SqlSyncCheckpointStore();

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

			const requiredNodeIds = new Set<string>();

			for (const finding of analysis.findings) {
				for (const path of finding.paths) {
					for (const nodeId of path.nodeIds) {
						requiredNodeIds.add(nodeId);
					}
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

			const scoredFindings = scoreImpactFindings(authorizedFindings, edges);

			logStage("SCORING_COMPLETED", {
				findings: scoredFindings.length,
			});

			const explainedFindings = explainImpactFindings(
				scoredFindings,
				nodes,
				edges,
			);

			logStage("COMPLETED", {
				findings: explainedFindings.length,
			});

			return {
				ok: true,
				data: {
					...analysis,
					findings: explainedFindings,
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

export const handler = resolver.getDefinitions();
