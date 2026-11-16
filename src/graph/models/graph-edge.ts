export type EdgeType =
	| "DEPENDS_ON"
	| "BLOCKS"
	| "IMPLEMENTS"
	| "MODIFIES"
	| "OWNED_BY"
	| "DOCUMENTED_BY"
	| "DECIDED_BY"
	| "AFFECTED_BY"
	| "RELATED_TO";

export interface EdgeProvenance {
	sourceSystem: string;
	externalReference?: string;
	evidenceText?: string;
}

export interface GraphEdge {
	id: string;
	tenantId: string;

	sourceNodeId: string;
	targetNodeId: string;

	type: EdgeType;

	weight: number;
	confidence: number;

	provenance: EdgeProvenance;

	createdAt: number;
	updatedAt: number;
}

export function createGraphEdge(
	input: Omit<GraphEdge, "createdAt" | "updatedAt">,
): GraphEdge {
	const now = Date.now();

	return {
		...input,
		createdAt: now,
		updatedAt: now,
	};
}
