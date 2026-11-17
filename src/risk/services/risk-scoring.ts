import type { GraphNode } from "../../graph/models/graph-node";
import type { GraphEdge } from "../../graph/models/graph-edge";
import type { ImpactFinding } from "../../impact/models/impact-analysis";
import type {
	ComponentCriticality,
	NodeRisk,
	RiskContributor,
	RiskFactor,
	RiskFactorValues,
	RiskLevel,
} from "../models/risk-analysis";

export const RISK_WEIGHTS: Record<RiskFactor, number> = {
	impactBreadth: 0.25,
	componentCriticality: 0.25,
	dependencyCentrality: 0.2,
	propagationConfidence: 0.2,
	propagationProximity: 0.1,
};

const CRITICALITY_VALUES: Record<
	Exclude<ComponentCriticality, "UNKNOWN">,
	number
> = {
	LOW: 25,
	MEDIUM: 50,
	HIGH: 75,
	CRITICAL: 100,
};

const FACTOR_EXPLANATIONS: Record<RiskFactor, string> = {
	impactBreadth: "Number of components affected by the source change.",
	componentCriticality: "Importance assigned to this component.",
	dependencyCentrality: "Number of distinct components depending on this node.",
	propagationConfidence: "Confidence of the strongest propagation path.",
	propagationProximity: "How close this component is to the changed source.",
};

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function clamp(value: number, min = 0, max = 100): number {
	return Math.max(min, Math.min(max, value));
}

export function getRiskLevel(score: number): RiskLevel {
	if (score < 35) return "LOW";
	if (score < 60) return "MEDIUM";
	if (score < 80) return "HIGH";
	return "CRITICAL";
}

function getCriticality(node: GraphNode): {
	label: ComponentCriticality;
	score: number;
} {
	const raw = node.attributes.criticality;

	if (typeof raw !== "string") {
		return { label: "UNKNOWN", score: 50 };
	}

	const value = raw.trim().toUpperCase();

	if (
		value === "LOW" ||
		value === "MEDIUM" ||
		value === "HIGH" ||
		value === "CRITICAL"
	) {
		return {
			label: value,
			score: CRITICALITY_VALUES[value],
		};
	}

	return { label: "UNKNOWN", score: 50 };
}

function getDependencyCentrality(nodeId: string, edges: GraphEdge[]): number {
	const incomingSources = new Set(
		edges
			.filter((edge) => edge.targetNodeId === nodeId)
			.map((edge) => edge.sourceNodeId),
	);

	return 100 * Math.min(1, incomingSources.size / 10);
}

function createFactors(
	finding: ImpactFinding,
	node: GraphNode,
	edges: GraphEdge[],
	affectedNodeCount: number,
): {
	factors: RiskFactorValues;
	criticality: ComponentCriticality;
} {
	const criticality = getCriticality(node);

	return {
		criticality: criticality.label,
		factors: {
			impactBreadth: 100 * Math.min(1, affectedNodeCount / 10),

			componentCriticality: criticality.score,

			dependencyCentrality: getDependencyCentrality(node.id, edges),

			propagationConfidence: clamp(finding.strongestPathConfidence * 100),

			propagationProximity:
				finding.minimumDepth > 0 ? 100 / finding.minimumDepth : 0,
		},
	};
}

function createContributors(factors: RiskFactorValues): RiskContributor[] {
	const factorNames = Object.keys(RISK_WEIGHTS) as RiskFactor[];

	return factorNames.map((factor) => ({
		factor,
		value: round(factors[factor]),
		weight: RISK_WEIGHTS[factor],
		contribution: round(factors[factor] * RISK_WEIGHTS[factor]),
		explanation: FACTOR_EXPLANATIONS[factor],
	}));
}

export function scoreRiskFindings(
	findings: ImpactFinding[],
	nodes: GraphNode[],
	edges: GraphEdge[],
): NodeRisk[] {
	const nodeMap = new Map(nodes.map((node) => [node.id, node]));

	return findings
		.map((finding) => {
			const node = nodeMap.get(finding.nodeId);

			if (!node) {
				throw new Error(
					`Cannot calculate risk: node ${finding.nodeId} was not supplied.`,
				);
			}

			const { factors, criticality } = createFactors(
				finding,
				node,
				edges,
				findings.length,
			);

			const contributors = createContributors(factors);

			const score = round(
				clamp(
					contributors.reduce(
						(total, contributor) => total + contributor.contribution,
						0,
					),
				),
			);

			return {
				nodeId: finding.nodeId,
				score,
				level: getRiskLevel(score),
				criticality,
				factors,
				contributors,
			};
		})
		.sort((a, b) =>
			b.score !== a.score
				? b.score - a.score
				: a.nodeId.localeCompare(b.nodeId),
		);
}
