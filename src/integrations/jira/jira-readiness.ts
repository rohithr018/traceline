import type { GraphNode } from "../../graph/models/graph-node";

/** Count only real Jira issues from this tenant and project. */
export function countIndexedJiraIssues(
	nodes: GraphNode[],
	tenantId: string,
	projectKey: string,
): number {
	return nodes.filter(
		(node) =>
			node.tenantId === tenantId &&
			node.type === "ISSUE" &&
			node.source === "JIRA" &&
			node.attributes.projectKey === projectKey &&
			node.attributes.placeholder !== true,
	).length;
}
