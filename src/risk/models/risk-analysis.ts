import type { GraphNode } from "../../graph/models/graph-node";
import type { GraphEdge } from "../../graph/models/graph-edge";
import type { ImpactAnalysisResult } from "../../impact/models/impact-analysis";

export type RiskLevel = "MINIMAL" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export type ComponentCriticality =
	| "UNKNOWN"
	| "LOW"
	| "MEDIUM"
	| "HIGH"
	| "CRITICAL";

export type RiskFactor =
	| "impactBreadth"
	| "componentCriticality"
	| "dependencyCentrality"
	| "propagationConfidence"
	| "propagationProximity";

export interface RiskFactorValues {
	impactBreadth: number;
	componentCriticality: number;
	dependencyCentrality: number;
	propagationConfidence: number;
	propagationProximity: number;
}

export interface RiskContributor {
	factor: RiskFactor;
	value: number;
	weight: number;
	contribution: number;
	explanation: string;
}

export interface NodeRisk {
	nodeId: string;
	score: number;
	level: RiskLevel;
	criticality: ComponentCriticality;
	factors: RiskFactorValues;
	contributors: RiskContributor[];
}

export interface RiskAnalysisResult {
	sourceNodeId: string;
	overallScore: number;
	overallLevel: RiskLevel;
	averageRisk: number;
	maximumRisk: number;
	affectedNodeCount: number;
	nodeRisks: NodeRisk[];
	analyzedAt: number;
}

export interface RiskAnalysisInput {
	tenantId: string;
	impactAnalysis: ImpactAnalysisResult;
	nodes: GraphNode[];
	edges: GraphEdge[];
}
