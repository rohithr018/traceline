import { createGraphNode } from "../../graph/models/graph-node";

import type { GraphNode } from "../../graph/models/graph-node";
import type { JiraIssue } from "./jira-types";

function extractDescription(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const parts: string[] = [];

	function visit(current: unknown): void {
		if (!current || typeof current !== "object") {
			return;
		}

		const item = current as Record<string, unknown>;

		if (item.type === "text" && typeof item.text === "string") {
			parts.push(item.text);
		}

		if (Array.isArray(item.content)) {
			for (const child of item.content) {
				visit(child);
			}
		}
	}

	visit(value);

	const result = parts.join(" ").trim();

	return result || undefined;
}

function parseTimestamp(value: string): number {
	const timestamp = Date.parse(value);

	return Number.isFinite(timestamp) ? timestamp : Date.now();
}

export function mapJiraIssueToGraphNode(
	issue: JiraIssue,
	tenantId: string,
): GraphNode {
	const now = Date.now();

	const createdAt = parseTimestamp(issue.fields.created);
	const updatedAt = parseTimestamp(issue.fields.updated);

	const baseUrl = new URL(issue.self).origin;

	const node = createGraphNode({
		id: `jira:issue:${issue.id}`,
		tenantId,

		type: "ISSUE",
		source: "JIRA",

		externalId: issue.key,

		name: issue.fields.summary,
		description: extractDescription(issue.fields.description),

		url: `${baseUrl}/browse/${encodeURIComponent(issue.key)}`,

		attributes: {
			jiraId: issue.id,
			issueKey: issue.key,

			projectId: issue.fields.project.id,
			projectKey: issue.fields.project.key,
			projectName: issue.fields.project.name,

			issueType: issue.fields.issuetype.name,

			status: issue.fields.status.name,
			statusId: issue.fields.status.id,

			priority: issue.fields.priority?.name ?? null,

			assigneeAccountId: issue.fields.assignee?.accountId ?? null,

			assigneeDisplayName: issue.fields.assignee?.displayName ?? null,

			labels: issue.fields.labels ?? [],
		},
	});

	return {
		...node,
		createdAt,
		updatedAt,
		lastSyncedAt: now,
	};
}
