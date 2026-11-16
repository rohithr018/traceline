export type NodeType =
	| "PROJECT"
	| "ISSUE"
	| "SERVICE"
	| "REPOSITORY"
	| "PULL_REQUEST"
	| "DOCUMENT"
	| "DECISION"
	| "INCIDENT"
	| "TEAM"
	| "RELEASE";

export type NodeSource =
	| "JIRA"
	| "CONFLUENCE"
	| "BITBUCKET"
	| "TEAMWORK_GRAPH"
	| "USER";

export interface GraphNode {
	id: string;
	tenantId: string;

	type: NodeType;
	source: NodeSource;

	externalId?: string;

	name: string;
	description?: string;
	url?: string;

	attributes: Record<string, unknown>;

	createdAt: number;
	updatedAt: number;
	lastSyncedAt: number;
}

export function createGraphNode(
	input: Omit<GraphNode, "createdAt" | "updatedAt" | "lastSyncedAt">,
): GraphNode {
	const now = Date.now();

	return {
		...input,
		createdAt: now,
		updatedAt: now,
		lastSyncedAt: now,
	};
}
