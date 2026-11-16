import type { GraphRepository } from "../../graph/repository/graph-repository";
import { ImpactTraversal } from "../../graph/algorithms/impact-traversal";
import {
	createImpactAnalysisResult,
	type ImpactAnalysisRequest,
	type ImpactAnalysisResult,
} from "../models/impact-analysis";
import { validateImpactRequest } from "../validation/impact-request-validator";
import {
	scoreImpactFindings,
	type ImpactScoringOptions,
} from "./impact-scoring";
import { explainImpactFindings } from "./impact-explanation";

export class ImpactAnalysisService {
	private readonly traversal: ImpactTraversal;

	constructor(
		private readonly repository: GraphRepository,
		private readonly scoringOptions: ImpactScoringOptions = {},
	) {
		this.traversal = new ImpactTraversal(repository);
	}

	async analyze(input: ImpactAnalysisRequest): Promise<ImpactAnalysisResult> {
		validateImpactRequest(input);

		// 1. Discover affected nodes and their paths.
		const traversalResult = await this.traversal.analyze(input);
		const analysis = createImpactAnalysisResult(traversalResult);

		// 2. Load graph data once for scoring and evidence generation.
		const [nodes, edges] = await Promise.all([
			this.repository.listNodes(input.tenantId),
			this.repository.listEdges(input.tenantId),
		]);

		// 3. Rank findings.
		const scoredFindings = scoreImpactFindings(
			analysis.findings,
			edges,
			this.scoringOptions,
		);

		// 4. Attach explanations and supporting evidence.
		const explainedFindings = explainImpactFindings(
			scoredFindings,
			nodes,
			edges,
		);

		return {
			...analysis,
			findings: explainedFindings,
		};
	}
}
