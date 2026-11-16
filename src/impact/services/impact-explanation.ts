import type { GraphEdge } from "../../graph/models/graph-edge";
import type { GraphNode } from "../../graph/models/graph-node";
import type {
	ImpactEvidenceNode,
	ImpactFinding,
	ImpactPathEvidence,
	ImpactRelationshipEvidence,
} from "../models/impact-analysis";

function getNodeEvidence(
	nodeId: string,
	nodesById: Map<string, GraphNode>,
): ImpactEvidenceNode {
	const node = nodesById.get(nodeId);

	if (!node) {
		return {
			id: nodeId,
			name: nodeId,
			type: null,
		};
	}

	return {
		id: node.id,
		name: node.name,
		type: node.type,
		...(node.url ? { url: node.url } : {}),
	};
}

function getRelationshipEvidence(
	edgeId: string,
	sourceNodeId: string,
	targetNodeId: string,
	edgesById: Map<string, GraphEdge>,
	nodesById: Map<string, GraphNode>,
): ImpactRelationshipEvidence {
	const edge = edgesById.get(edgeId);

	const source = getNodeEvidence(sourceNodeId, nodesById);
	const target = getNodeEvidence(targetNodeId, nodesById);

	if (!edge) {
		return {
			edgeId,
			type: null,
			sourceNodeId,
			targetNodeId,
			sourceName: source.name,
			targetName: target.name,
		};
	}

	return {
		edgeId,
		type: edge.type,
		sourceNodeId,
		targetNodeId,
		sourceName: source.name,
		targetName: target.name,
		sourceSystem: edge.provenance.sourceSystem,
		...(edge.provenance.externalReference
			? { externalReference: edge.provenance.externalReference }
			: {}),
		...(edge.provenance.evidenceText
			? { evidenceText: edge.provenance.evidenceText }
			: {}),
	};
}

function buildPathEvidence(
	findingPath: ImpactFinding["paths"][number],
	nodesById: Map<string, GraphNode>,
	edgesById: Map<string, GraphEdge>,
): ImpactPathEvidence {
	const nodes = findingPath.nodeIds.map((nodeId) =>
		getNodeEvidence(nodeId, nodesById),
	);

	const relationships = findingPath.edgeIds.map((edgeId, index) =>
		getRelationshipEvidence(
			edgeId,
			findingPath.nodeIds[index],
			findingPath.nodeIds[index + 1],
			edgesById,
			nodesById,
		),
	);

	return {
		nodes,
		relationships,
		depth: findingPath.depth,
		confidence: findingPath.confidence,
	};
}

function buildPathDescription(evidence: ImpactPathEvidence): string {
	if (evidence.nodes.length === 0) {
		return "No path information is available.";
	}

	let description = evidence.nodes[0].name;

	for (let index = 0; index < evidence.relationships.length; index++) {
		const relationship = evidence.relationships[index];

		description +=
			` --${relationship.type ?? "UNKNOWN_RELATIONSHIP"}--> ` +
			evidence.nodes[index + 1].name;
	}

	return description;
}

function buildFindingExplanation(evidence: ImpactPathEvidence[]): string {
	if (evidence.length === 0) {
		return "This node was identified as affected, but no supporting path is available.";
	}

	const strongestPath = [...evidence].sort(
		(a, b) => b.confidence - a.confidence || a.depth - b.depth,
	)[0];

	const description = buildPathDescription(strongestPath);

	return (
		`This item is potentially affected through the following dependency path: ` +
		`${description}. The path has ${strongestPath.depth} relationship(s) ` +
		`and a confidence score of ${strongestPath.confidence.toFixed(2)}.`
	);
}

export function explainImpactFindings(
	findings: ImpactFinding[],
	nodes: GraphNode[],
	edges: GraphEdge[],
): ImpactFinding[] {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const edgesById = new Map(edges.map((edge) => [edge.id, edge]));

	return findings.map((finding) => {
		const evidence = finding.paths.map((path) =>
			buildPathEvidence(path, nodesById, edgesById),
		);

		return {
			...finding,
			explanation: buildFindingExplanation(evidence),
			evidence,
		};
	});
}
