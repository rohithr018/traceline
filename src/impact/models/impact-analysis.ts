import type {
	ImpactInput,
	ImpactPath,
	ImpactResult,
} from "../../graph/algorithms/impact-traversal";
import type { EdgeType } from "../../graph/models/graph-edge";
import type { NodeType } from "../../graph/models/graph-node";

export interface ImpactAnalysisRequest extends ImpactInput {
	tenantId: string;
	sourceNodeId: string;
}

export type ImpactSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface ImpactEvidenceNode {
	id: string;
	name: string;
	type: NodeType | null;
	url?: string;
}

export interface ImpactRelationshipEvidence {
	edgeId: string;
	type: EdgeType | null;
	sourceNodeId: string;
	targetNodeId: string;
	sourceName: string;
	targetName: string;
	sourceSystem?: string;
	externalReference?: string;
	evidenceText?: string;
	/** The path traversed a conventional DEPENDS_ON edge in reverse. */
	propagatedToDependent?: boolean;
}

export interface ImpactPathEvidence {
	nodes: ImpactEvidenceNode[];
	relationships: ImpactRelationshipEvidence[];
	depth: number;
	confidence: number;
}

export interface ImpactFinding {
	nodeId: string;
	paths: ImpactPath[];
	minimumDepth: number;
	strongestPathConfidence: number;
	score: number | null;
	severity: ImpactSeverity | null;

	// Added by the explanation layer.
	explanation?: string;
	evidence?: ImpactPathEvidence[];
}

export interface ImpactAnalysisResult {
	sourceNodeId: string;
	analyzedAt: number;
	findings: ImpactFinding[];
	visitedNodeCount: number;
	truncated: boolean;
}

export function createImpactAnalysisResult(
	traversal: ImpactResult,
	analyzedAt = Date.now(),
): ImpactAnalysisResult {
	const findings = traversal.affectedNodeIds.map((nodeId) => {
		const paths = traversal.paths[nodeId] ?? [];

		return {
			nodeId,
			paths,
			minimumDepth:
				paths.length > 0 ? Math.min(...paths.map((path) => path.depth)) : 0,
			strongestPathConfidence:
				paths.length > 0
					? Math.max(...paths.map((path) => path.confidence))
					: 0,
			score: null,
			severity: null,
		};
	});

	findings.sort((a, b) =>
		a.minimumDepth !== b.minimumDepth
			? a.minimumDepth - b.minimumDepth
			: a.nodeId.localeCompare(b.nodeId),
	);

	return {
		sourceNodeId: traversal.sourceNodeId,
		analyzedAt,
		findings,
		visitedNodeCount: traversal.visitedNodeCount,
		truncated: traversal.truncated,
	};
}
