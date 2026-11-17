import { createGraphNode } from "../../graph/models/graph-node";
import type { GraphRepository } from "../../graph/repository/graph-repository";
import { ForgeJiraClient } from "./forge-jira-client";
import { mapJiraIssueToGraphNode } from "./jira-mapper";
import { mapJiraIssueLinksToGraphEdges } from "./jira-link-mapper";
import type { JiraClient, JiraIssue } from "./jira-types";

export interface JiraIngestionInput {
	tenantId: string;
	projectKey: string;
	maxIssues?: number;
}

export interface JiraIngestionResult {
	projectKey: string;
	fetchedIssues: number;
	persistedNodes: number;
	placeholderNodes: number;
	persistedEdges: number;
}

export class JiraIngestionService {
	constructor(
		private readonly repository: GraphRepository,
		private readonly client: JiraClient = new ForgeJiraClient(),
	) {}

	async ingestProject(input: JiraIngestionInput): Promise<JiraIngestionResult> {
		const { tenantId, projectKey } = input;
		const maxIssues = input.maxIssues ?? 1000;

		if (!tenantId.trim()) {
			throw new Error("Tenant ID is required");
		}

		if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(projectKey)) {
			throw new Error("Invalid Jira project key");
		}

		if (!Number.isInteger(maxIssues) || maxIssues <= 0) {
			throw new Error("maxIssues must be a positive integer");
		}

		const jql = `project = "${projectKey}" ORDER BY key ASC`;

		const fetched: JiraIssue[] = [];
		const seenTokens = new Set<string>();
		let nextPageToken: string | undefined;

		// Fetch Jira issues using token-based pagination.
		while (fetched.length < maxIssues) {
			const page = await this.client.searchIssues(
				jql,
				nextPageToken,
				Math.min(100, maxIssues - fetched.length),
			);

			fetched.push(...page.issues.slice(0, maxIssues - fetched.length));

			if (page.isLast || !page.nextPageToken) {
				break;
			}

			if (seenTokens.has(page.nextPageToken)) {
				throw new Error("Jira pagination returned a repeated page token");
			}

			seenTokens.add(page.nextPageToken);
			nextPageToken = page.nextPageToken;
		}

		// Persist all actual Jira issue nodes first.
		for (const issue of fetched) {
			const node = mapJiraIssueToGraphNode(issue, tenantId);
			await this.repository.upsertNode(node);
		}

		// Create placeholder nodes for linked issues that have not
		// been imported yet.
		let placeholderNodes = 0;

		for (const issue of fetched) {
			for (const link of issue.fields.issuelinks ?? []) {
				const linkedIssue = link.inwardIssue ?? link.outwardIssue;

				if (!linkedIssue?.id || !linkedIssue.key) {
					continue;
				}

				const linkedNodeId = `jira:issue:${linkedIssue.id}`;

				const existing = await this.repository.getNode(tenantId, linkedNodeId);

				if (existing) {
					continue;
				}

				const linkedUrl = linkedIssue.self
					? `${new URL(linkedIssue.self).origin}/browse/${linkedIssue.key}`
					: undefined;

				const placeholder = createGraphNode({
					id: linkedNodeId,
					tenantId,
					type: "ISSUE",
					source: "JIRA",
					externalId: linkedIssue.key,
					name: linkedIssue.key,
					url: linkedUrl,
					attributes: {
						jiraId: linkedIssue.id,
						issueKey: linkedIssue.key,
						placeholder: true,
					},
				});

				await this.repository.upsertNode(placeholder);
				placeholderNodes++;
			}
		}

		// Map relationships and deduplicate using Jira link IDs.
		const edges = new Map<
			string,
			ReturnType<typeof mapJiraIssueLinksToGraphEdges>[number]
		>();

		for (const issue of fetched) {
			const mappedEdges = mapJiraIssueLinksToGraphEdges(issue, tenantId);

			for (const edge of mappedEdges) {
				edges.set(edge.id, edge);
			}
		}

		// Persist all unique relationships.
		for (const edge of edges.values()) {
			await this.repository.upsertEdge(edge);
		}

		return {
			projectKey,
			fetchedIssues: fetched.length,
			persistedNodes: fetched.length,
			placeholderNodes,
			persistedEdges: edges.size,
		};
	}
}
