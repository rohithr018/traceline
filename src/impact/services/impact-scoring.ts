import type { EdgeType, GraphEdge } from "../../graph/models/graph-edge";
import type { ImpactFinding, ImpactSeverity } from "../models/impact-analysis";

export interface ImpactScoringOptions {
	depthDecay?: number;
	relationshipWeights?: Partial<Record<EdgeType, number>>;
	thresholds?: {
		critical: number;
		high: number;
		medium: number;
	};
}

const DEFAULT_RELATIONSHIP_WEIGHTS: Record<EdgeType, number> = {
	BLOCKS: 1.0,
	DEPENDS_ON: 0.95,
	MODIFIES: 0.9,
	AFFECTED_BY: 0.85,
	IMPLEMENTS: 0.8,
	DECIDED_BY: 0.65,
	DOCUMENTED_BY: 0.5,
	OWNED_BY: 0.4,
	RELATED_TO: 0.35,
};

const DEFAULT_THRESHOLDS = {
	critical: 80,
	high: 60,
	medium: 35,
};

function getSeverity(
	score: number,
	thresholds: typeof DEFAULT_THRESHOLDS,
): ImpactSeverity {
	if (score >= thresholds.critical) return "CRITICAL";
	if (score >= thresholds.high) return "HIGH";
	if (score >= thresholds.medium) return "MEDIUM";
	return "LOW";
}

function calculateRelationshipRelevance(
	edgeIds: string[],
	edgesById: Map<string, GraphEdge>,
	weights: Record<EdgeType, number>,
): number {
	if (edgeIds.length === 0) return 1;

	let product = 1;

	for (const edgeId of edgeIds) {
		const edge = edgesById.get(edgeId);

		// Missing edge data should not silently receive maximum relevance.
		const relevance = edge ? weights[edge.type] : 0.5;
		product *= relevance;
	}

	return Math.pow(product, 1 / edgeIds.length);
}

export function scoreImpactFindings(
	findings: ImpactFinding[],
	edges: GraphEdge[],
	options: ImpactScoringOptions = {},
): ImpactFinding[] {
	const depthDecay = options.depthDecay ?? 0.75;
	const weights: Record<EdgeType, number> = {
		...DEFAULT_RELATIONSHIP_WEIGHTS,
		...options.relationshipWeights,
	};
	const thresholds = {
		...DEFAULT_THRESHOLDS,
		...options.thresholds,
	};

	if (!Number.isFinite(depthDecay) || depthDecay < 0 || depthDecay > 1) {
		throw new Error("depthDecay must be between 0 and 1.");
	}

	for (const [name, value] of Object.entries(weights)) {
		if (!Number.isFinite(value) || value < 0 || value > 1) {
			throw new Error(
				`Relationship weight for ${name} must be between 0 and 1.`,
			);
		}
	}

	if (
		!Number.isFinite(thresholds.critical) ||
		!Number.isFinite(thresholds.high) ||
		!Number.isFinite(thresholds.medium) ||
		thresholds.critical > 100 ||
		thresholds.critical < thresholds.high ||
		thresholds.high < thresholds.medium ||
		thresholds.medium < 0
	) {
		throw new Error("Severity thresholds must be ordered between 0 and 100.");
	}

	const edgesById = new Map(edges.map((edge) => [edge.id, edge]));

	return findings.map((finding) => {
		const pathScores = finding.paths.map((path) => {
			const relevance = calculateRelationshipRelevance(
				path.edgeIds,
				edgesById,
				weights,
			);

			const depthFactor = Math.pow(depthDecay, Math.max(0, path.depth - 1));

			return 100 * path.confidence * depthFactor * relevance;
		});

		const bestScore = pathScores.length > 0 ? Math.max(...pathScores) : 0;

		const score = Math.round(Math.min(100, Math.max(0, bestScore)) * 100) / 100;

		return {
			...finding,
			score,
			severity: getSeverity(score, thresholds),
		};
	});
}
