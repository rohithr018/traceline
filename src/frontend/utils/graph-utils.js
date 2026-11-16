export function buildImpactGraph(sourceNodeId, findings = [], risk = null) {
	const nodesById = new Map();
	const edgesById = new Map();
	const riskByNodeId = new Map();

	const safeFindings = Array.isArray(findings) ? findings : [];
	const nodeRisks = Array.isArray(risk?.nodeRisks) ? risk.nodeRisks : [];

	for (const nodeRisk of nodeRisks) {
		if (!nodeRisk?.nodeId) continue;
		riskByNodeId.set(nodeRisk.nodeId, nodeRisk);
	}

	// The source node is always depth zero.
	if (typeof sourceNodeId === "string" && sourceNodeId.length > 0) {
		nodesById.set(sourceNodeId, {
			id: sourceNodeId,
			name: sourceNodeId,
			type: "ISSUE",
			depth: 0,
			isSource: true,
			riskScore: null,
			riskLevel: null,
			severity: null,
			criticality: null,
		});
	}

	for (const finding of safeFindings) {
		if (!finding?.nodeId) continue;

		const findingRisk = riskByNodeId.get(finding.nodeId);
		const evidencePaths = Array.isArray(finding.evidence) ? finding.evidence : [];

		for (const path of evidencePaths) {
			const evidenceNodes = Array.isArray(path?.nodes) ? path.nodes : [];
			const relationships = Array.isArray(path?.relationships)
				? path.relationships
				: [];

			for (let index = 0; index < evidenceNodes.length; index++) {
				const evidenceNode = evidenceNodes[index];
				if (!evidenceNode?.id) continue;

				const isSource = evidenceNode.id === sourceNodeId;

				const depth = isSource ? 0 : index;

				const existing = nodesById.get(evidenceNode.id);

				const node = {
					id: evidenceNode.id,
					name: evidenceNode.name || evidenceNode.id,
					type: evidenceNode.type ?? "UNKNOWN",
					depth: existing ? Math.min(existing.depth, depth) : depth,
					isSource,
					riskScore: isSource ? null : (findingRisk?.score ?? null),

					riskLevel: isSource ? null : (findingRisk?.level ?? null),

					severity: isSource ? null : (finding.severity ?? null),
					criticality: isSource ? null : (findingRisk?.criticality ?? null),
				};

				if (existing) {
					nodesById.set(evidenceNode.id, {
						...existing,
						...node,
						depth: Math.min(existing.depth, depth),
						riskScore: node.riskScore ?? existing.riskScore,
						riskLevel: node.riskLevel ?? existing.riskLevel,
						severity: node.severity ?? existing.severity,
						criticality: node.criticality ?? existing.criticality,
					});
				} else {
					nodesById.set(evidenceNode.id, node);
				}
			}

			for (const [index, relationship] of relationships.entries()) {
				if (!relationship?.sourceNodeId || !relationship?.targetNodeId) continue;

				const edgeId =
					relationship.edgeId ??
					`${relationship.sourceNodeId}->${relationship.targetNodeId}:${index}`;

				if (!edgesById.has(edgeId)) {
					const sourceName =
						relationship.sourceName ??
						nodesById.get(relationship.sourceNodeId)?.name ??
						relationship.sourceNodeId;
					const targetName =
						relationship.targetName ??
						nodesById.get(relationship.targetNodeId)?.name ??
						relationship.targetNodeId;

					edgesById.set(edgeId, {
						id: edgeId,
						type: relationship.type ?? "UNKNOWN",
						sourceNodeId: relationship.sourceNodeId,
						targetNodeId: relationship.targetNodeId,
						sourceName,
						targetName,
						sourceSystem: relationship.sourceSystem ?? null,
						evidenceText: relationship.evidenceText ?? null,
						externalReference: relationship.externalReference ?? null,
					});
				}
			}
		}
	}

	const nodes = [...nodesById.values()].sort((a, b) => {
		if (a.depth !== b.depth) return a.depth - b.depth;
		return a.name.localeCompare(b.name);
	});

	const edges = [...edgesById.values()].filter(
		(edge) =>
			nodesById.has(edge.sourceNodeId) && nodesById.has(edge.targetNodeId),
	);

	const depths = [...new Set(nodes.map((node) => node.depth))].sort(
		(a, b) => a - b,
	);

	const nodesByDepth = depths.map((depth) => ({
		depth,
		nodes: nodes.filter((node) => node.depth === depth),
	}));

	return {
		sourceNodeId,
		nodes,
		edges,
		nodesByDepth,
		affectedNodeCount: nodes.filter((node) => !node.isSource).length,
		relationshipCount: edges.length,
	};
}
