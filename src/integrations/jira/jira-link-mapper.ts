import { createGraphEdge } from "../../graph/models/graph-edge";
import type { GraphEdge, EdgeType } from "../../graph/models/graph-edge";
import type { JiraIssue, JiraIssueLink } from "./jira-types";

type LinkDirection = "CURRENT_TO_LINKED" | "LINKED_TO_CURRENT" | "UNDIRECTED";

interface RelationshipMapping {
	edgeType: EdgeType;
	direction: LinkDirection;
}

function normalizeLabel(label: string): string {
	return label
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ");
}

function resolveRelationship(label: string): RelationshipMapping | null {
	const mappings: Record<string, RelationshipMapping> = {
		blocks: {
			edgeType: "BLOCKS",
			direction: "CURRENT_TO_LINKED",
		},
		"is blocked by": {
			edgeType: "BLOCKS",
			direction: "LINKED_TO_CURRENT",
		},
		"blocked by": {
			edgeType: "BLOCKS",
			direction: "LINKED_TO_CURRENT",
		},
		"depends on": {
			edgeType: "DEPENDS_ON",
			direction: "CURRENT_TO_LINKED",
		},
		"is depended on by": {
			edgeType: "DEPENDS_ON",
			direction: "LINKED_TO_CURRENT",
		},
		implements: {
			edgeType: "IMPLEMENTS",
			direction: "CURRENT_TO_LINKED",
		},
		"is implemented by": {
			edgeType: "IMPLEMENTS",
			direction: "LINKED_TO_CURRENT",
		},
		"relates to": {
			edgeType: "RELATED_TO",
			direction: "UNDIRECTED",
		},
		"is related to": {
			edgeType: "RELATED_TO",
			direction: "UNDIRECTED",
		},
		duplicates: {
			edgeType: "RELATED_TO",
			direction: "UNDIRECTED",
		},
		"is duplicated by": {
			edgeType: "RELATED_TO",
			direction: "UNDIRECTED",
		},
	};

	return mappings[normalizeLabel(label)] ?? null;
}

function getLinkedIssue(link: JiraIssueLink) {
	if (link.inwardIssue) {
		return {
			issue: link.inwardIssue,
			label: link.type.inward,
		};
	}

	if (link.outwardIssue) {
		return {
			issue: link.outwardIssue,
			label: link.type.outward,
		};
	}

	return null;
}

export function mapJiraIssueLinksToGraphEdges(
	issue: JiraIssue,
	tenantId: string,
): GraphEdge[] {
	const links = issue.fields.issuelinks ?? [];
	const edges: GraphEdge[] = [];

	for (const link of links) {
		const linked = getLinkedIssue(link);

		if (!linked || !link.id || !linked.issue.id || !linked.issue.key) {
			continue;
		}

		const relationship = resolveRelationship(linked.label);

		if (!relationship) {
			continue;
		}

		const currentNodeId = `jira:issue:${issue.id}`;
		const linkedNodeId = `jira:issue:${linked.issue.id}`;

		let sourceNodeId: string;
		let targetNodeId: string;

		switch (relationship.direction) {
			case "CURRENT_TO_LINKED":
				sourceNodeId = currentNodeId;
				targetNodeId = linkedNodeId;
				break;

			case "LINKED_TO_CURRENT":
				sourceNodeId = linkedNodeId;
				targetNodeId = currentNodeId;
				break;

			case "UNDIRECTED": {
				const [first, second] = [currentNodeId, linkedNodeId].sort();

				sourceNodeId = first;
				targetNodeId = second;
				break;
			}
		}

		edges.push(
			createGraphEdge({
				id: `jira:issue-link:${link.id}`,
				tenantId,
				sourceNodeId,
				targetNodeId,
				type: relationship.edgeType,
				weight: 1,
				confidence: 1,
				provenance: {
					sourceSystem: "JIRA",
					externalReference: link.id,
					evidenceText: `${link.type.name}: ${linked.label}`,
				},
			}),
		);
	}

	return edges;
}
