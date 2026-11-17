import type {
	RiskAnalysisInput,
	RiskAnalysisResult,
} from "../models/risk-analysis";
import { validateRiskInput } from "../validation/risk-request-validator";
import { getRiskLevel, scoreRiskFindings } from "./risk-scoring";

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

export class RiskAnalysisService {
	async analyze(input: RiskAnalysisInput): Promise<RiskAnalysisResult> {
		// The caller must provide permission-filtered graph data.
		validateRiskInput({
			tenantId: input.tenantId,
			impactAnalysis: input.impactAnalysis,
			nodes: input.nodes,
			edges: input.edges,
		});

		const nodeRisks = scoreRiskFindings(
			input.impactAnalysis.findings,
			input.nodes,
			input.edges,
		);

		if (nodeRisks.length === 0) {
			return {
				sourceNodeId: input.impactAnalysis.sourceNodeId,
				overallScore: 0,
				overallLevel: "LOW",
				averageRisk: 0,
				maximumRisk: 0,
				affectedNodeCount: 0,
				nodeRisks: [],
				analyzedAt: Date.now(),
			};
		}

		const averageRisk = round(
			nodeRisks.reduce((sum, item) => sum + item.score, 0) / nodeRisks.length,
		);

		const maximumRisk = Math.max(...nodeRisks.map((item) => item.score));

		const overallScore = round(0.6 * averageRisk + 0.4 * maximumRisk);

		return {
			sourceNodeId: input.impactAnalysis.sourceNodeId,
			overallScore,
			overallLevel: getRiskLevel(overallScore),
			averageRisk,
			maximumRisk: round(maximumRisk),
			affectedNodeCount: nodeRisks.length,
			nodeRisks,
			analyzedAt: Date.now(),
		};
	}
}
