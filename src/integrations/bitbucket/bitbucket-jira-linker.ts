import { createGraphEdge } from "../../graph/models/graph-edge";

import type { GraphNode } from "../../graph/models/graph-node";
import type { GraphRepository } from "../../graph/repository/graph-repository";

import { extractJiraKeys } from "./jira-key-extractor";

interface CommitMetadata {
	message?: string;
}

export interface UnresolvedJiraReference {
	pullRequestId: string;
	jiraKey: string;
}

export interface BitbucketJiraLinkResult {
	scannedPullRequests: number;
	extractedReferences: number;
	resolvedReferences: number;
	persistedEdges: number;
	staleEdgesRemoved: number;
	unresolvedReferences: UnresolvedJiraReference[];
}

function getCommitMessages(node: GraphNode): string[] {
	const commits = node.attributes.commits;

	if (!Array.isArray(commits)) {
		return [];
	}

	return commits.flatMap((commit): string[] => {
		if (!commit || typeof commit !== "object") {
			return [];
		}

		const metadata = commit as CommitMetadata;

		return typeof metadata.message === "string" ? [metadata.message] : [];
	});
}

function getJiraIssueKey(node: GraphNode): string | undefined {
	const key = node.attributes.issueKey ?? node.externalId;

	return typeof key === "string" && key.trim()
		? key.trim().toUpperCase()
		: undefined;
}

export class BitbucketJiraLinker {
	constructor(private readonly repository: GraphRepository) {}

	async linkPullRequestsToJira(
		tenantId: string,
		pullRequestNodeId?: string,
	): Promise<BitbucketJiraLinkResult> {
		if (!tenantId.trim()) {
			throw new Error("Tenant ID is required");
		}

		const nodes = await this.repository.listNodes(tenantId);

		const jiraIssues = new Map<string, GraphNode>();

		for (const node of nodes) {
			if (
				node.type !== "ISSUE" ||
				node.source !== "JIRA" ||
				node.attributes.placeholder === true
			) {
				continue;
			}

			const key = getJiraIssueKey(node);

			if (key) {
				jiraIssues.set(key, node);
			}
		}

		const pullRequests = nodes.filter(
			(node) =>
				node.type === "PULL_REQUEST" &&
				node.source === "BITBUCKET" &&
				(!pullRequestNodeId || node.id === pullRequestNodeId),
		);

		const unresolvedReferences: UnresolvedJiraReference[] = [];

		let extractedReferences = 0;
		let resolvedReferences = 0;
		let persistedEdges = 0;
		let staleEdgesRemoved = 0;

		for (const pullRequest of pullRequests) {
			const desiredEdges = new Map<
				string,
				ReturnType<typeof createGraphEdge>
			>();

			const sourceTexts = [
				pullRequest.name,
				pullRequest.description ?? "",
				...getCommitMessages(pullRequest),
			];

			const jiraKeys = new Set(
				sourceTexts.flatMap((text) => extractJiraKeys(text)),
			);

			extractedReferences += jiraKeys.size;

			for (const jiraKey of jiraKeys) {
				const issue = jiraIssues.get(jiraKey);

				if (!issue) {
					unresolvedReferences.push({
						pullRequestId: pullRequest.id,
						jiraKey,
					});

					continue;
				}

				const edge = createGraphEdge({
					id: `bitbucket:jira:${pullRequest.id}:${issue.id}`,
					tenantId,
					sourceNodeId: pullRequest.id,
					targetNodeId: issue.id,
					type: "IMPLEMENTS",
					weight: 1,
					confidence: 0.95,
					provenance: {
						sourceSystem: "BITBUCKET",
						externalReference: pullRequest.url,
						evidenceText:
							`Jira key ${jiraKey} referenced by pull request ` +
							`"${pullRequest.name}"`,
					},
				});

				desiredEdges.set(edge.id, edge);
				resolvedReferences++;
			}

			const existingEdges = await this.repository.getOutgoingEdges(
				tenantId,
				pullRequest.id,
				["IMPLEMENTS"],
			);

			for (const edge of desiredEdges.values()) {
				await this.repository.upsertEdge(edge);
			}

			for (const existingEdge of existingEdges) {
				if (!desiredEdges.has(existingEdge.id)) {
					await this.repository.deleteEdge(tenantId, existingEdge.id);
					staleEdgesRemoved++;
				}
			}

			persistedEdges += desiredEdges.size;
		}

		return {
			scannedPullRequests: pullRequests.length,
			extractedReferences,
			resolvedReferences,
			persistedEdges,
			staleEdgesRemoved,
			unresolvedReferences,
		};
	}
}
