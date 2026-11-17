import type { GraphNode } from "../models/graph-node";
import type { GraphEdge, EdgeType } from "../models/graph-edge";

import type { GraphRepository } from "./graph-repository";

import {
	GraphNodeNotFoundError,
	GraphTenantMismatchError,
} from "../errors/graph-errors";

import { validateNode, validateEdge } from "../validation/graph-validator";

export class InMemoryGraphRepository implements GraphRepository {
	private readonly nodes = new Map<string, GraphNode>();
	private readonly edges = new Map<string, GraphEdge>();

	private key(tenantId: string, id: string): string {
		return JSON.stringify([tenantId, id]);
	}

	async upsertNode(node: GraphNode): Promise<void> {
		validateNode(node);

		const key = this.key(node.tenantId, node.id);
		const existing = this.nodes.get(key);

		this.nodes.set(key, {
			...existing,
			...node,
			attributes: { ...node.attributes },
		});
	}

	async upsertEdge(edge: GraphEdge): Promise<void> {
		validateEdge(edge);

		const sourceKey = this.key(edge.tenantId, edge.sourceNodeId);

		const targetKey = this.key(edge.tenantId, edge.targetNodeId);

		const source = this.nodes.get(sourceKey);
		const target = this.nodes.get(targetKey);

		if (!source || !target) {
			throw new GraphNodeNotFoundError(
				!source ? edge.sourceNodeId : edge.targetNodeId,
			);
		}

		if (source.tenantId !== target.tenantId) {
			throw new GraphTenantMismatchError();
		}

		const key = this.key(edge.tenantId, edge.id);
		const existing = this.edges.get(key);

		this.edges.set(key, {
			...existing,
			...edge,
			provenance: { ...edge.provenance },
		});
	}

	async deleteEdge(tenantId: string, edgeId: string): Promise<boolean> {
		return this.edges.delete(this.key(tenantId, edgeId));
	}

	async getNode(tenantId: string, nodeId: string): Promise<GraphNode | null> {
		const node = this.nodes.get(this.key(tenantId, nodeId));

		if (!node) return null;

		return {
			...node,
			attributes: { ...node.attributes },
		};
	}

	async getOutgoingEdges(
		tenantId: string,
		nodeId: string,
		types?: EdgeType[],
	): Promise<GraphEdge[]> {
		return [...this.edges.values()]
			.filter(
				(edge) =>
					edge.tenantId === tenantId &&
					edge.sourceNodeId === nodeId &&
					(!types || types.includes(edge.type)),
			)
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((edge) => ({
				...edge,
				provenance: { ...edge.provenance },
			}));
	}

	async getIncomingEdges(
		tenantId: string,
		nodeId: string,
		types?: EdgeType[],
	): Promise<GraphEdge[]> {
		return [...this.edges.values()]
			.filter(
				(edge) =>
					edge.tenantId === tenantId &&
					edge.targetNodeId === nodeId &&
					(!types || types.includes(edge.type)),
			)
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((edge) => ({
				...edge,
				provenance: { ...edge.provenance },
			}));
	}

	async listNodes(tenantId: string): Promise<GraphNode[]> {
		return [...this.nodes.values()]
			.filter((node) => node.tenantId === tenantId)
			.map((node) => ({
				...node,
				attributes: { ...node.attributes },
			}));
	}

	async listEdges(tenantId: string): Promise<GraphEdge[]> {
		return [...this.edges.values()]
			.filter((edge) => edge.tenantId === tenantId)
			.map((edge) => ({
				...edge,
				provenance: { ...edge.provenance },
			}));
	}
}
