import { sql } from "@forge/sql";

import type { GraphNode } from "../models/graph-node";
import type { GraphEdge, EdgeType } from "../models/graph-edge";

import type { GraphRepository } from "./graph-repository";

import { GraphNodeNotFoundError } from "../errors/graph-errors";

import { validateNode, validateEdge } from "../validation/graph-validator";

interface NodeRow {
	tenant_id: string;
	id: string;
	type: GraphNode["type"];
	source: GraphNode["source"];
	external_id: string | null;
	name: string;
	description: string | null;
	url: string | null;
	attributes: string;
	created_at: number | string;
	updated_at: number | string;
	last_synced_at: number | string;
}

interface EdgeRow {
	tenant_id: string;
	id: string;
	source_node_id: string;
	target_node_id: string;
	type: EdgeType;
	weight: number;
	confidence: number;
	provenance: string;
	created_at: number | string;
	updated_at: number | string;
}

function mapNode(row: NodeRow): GraphNode {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		type: row.type,
		source: row.source,
		externalId: row.external_id ?? undefined,
		name: row.name,
		description: row.description ?? undefined,
		url: row.url ?? undefined,
		attributes: JSON.parse(row.attributes),
		createdAt: Number(row.created_at),
		updatedAt: Number(row.updated_at),
		lastSyncedAt: Number(row.last_synced_at),
	};
}

function mapEdge(row: EdgeRow): GraphEdge {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		sourceNodeId: row.source_node_id,
		targetNodeId: row.target_node_id,
		type: row.type,
		weight: Number(row.weight),
		confidence: Number(row.confidence),
		provenance: JSON.parse(row.provenance),
		createdAt: Number(row.created_at),
		updatedAt: Number(row.updated_at),
	};
}

export class SqlGraphRepository implements GraphRepository {
	async upsertNode(node: GraphNode): Promise<void> {
		validateNode(node);

		const query = `
      INSERT INTO graph_nodes (
        tenant_id,
        id,
        type,
        source,
        external_id,
        name,
        description,
        url,
        attributes,
        created_at,
        updated_at,
        last_synced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

      ON DUPLICATE KEY UPDATE
        type = VALUES(type),
        source = VALUES(source),
        external_id = VALUES(external_id),
        name = VALUES(name),
        description = VALUES(description),
        url = VALUES(url),
        attributes = VALUES(attributes),
        updated_at = VALUES(updated_at),
        last_synced_at = VALUES(last_synced_at)
    `;

		await sql
			.prepare(query)
			.bindParams(
				node.tenantId,
				node.id,
				node.type,
				node.source,
				node.externalId ?? null,
				node.name,
				node.description ?? null,
				node.url ?? null,
				JSON.stringify(node.attributes),
				node.createdAt,
				node.updatedAt,
				node.lastSyncedAt,
			)
			.execute();
	}

	async upsertEdge(edge: GraphEdge): Promise<void> {
		validateEdge(edge);

		const source = await this.getNode(edge.tenantId, edge.sourceNodeId);

		const target = await this.getNode(edge.tenantId, edge.targetNodeId);

		if (!source || !target) {
			throw new GraphNodeNotFoundError(
				!source ? edge.sourceNodeId : edge.targetNodeId,
			);
		}

		const query = `
      INSERT INTO graph_edges (
        tenant_id,
        id,
        source_node_id,
        target_node_id,
        type,
        weight,
        confidence,
        provenance,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

      ON DUPLICATE KEY UPDATE
        source_node_id = VALUES(source_node_id),
        target_node_id = VALUES(target_node_id),
        type = VALUES(type),
        weight = VALUES(weight),
        confidence = VALUES(confidence),
        provenance = VALUES(provenance),
        updated_at = VALUES(updated_at)
    `;

		await sql
			.prepare(query)
			.bindParams(
				edge.tenantId,
				edge.id,
				edge.sourceNodeId,
				edge.targetNodeId,
				edge.type,
				edge.weight,
				edge.confidence,
				JSON.stringify(edge.provenance),
				edge.createdAt,
				edge.updatedAt,
			)
			.execute();
	}

	async getNode(tenantId: string, nodeId: string): Promise<GraphNode | null> {
		const result = await sql
			.prepare<NodeRow>(
				`
        SELECT *
        FROM graph_nodes
        WHERE tenant_id = ?
          AND id = ?
        LIMIT 1
      `,
			)
			.bindParams(tenantId, nodeId)
			.execute();

		if (!result.rows.length) {
			return null;
		}

		return mapNode(result.rows[0]);
	}

	async getOutgoingEdges(
		tenantId: string,
		nodeId: string,
		types?: EdgeType[],
	): Promise<GraphEdge[]> {
		let query = `
      SELECT *
      FROM graph_edges
      WHERE tenant_id = ?
        AND source_node_id = ?
    `;

		const params: unknown[] = [tenantId, nodeId];

		if (types && types.length > 0) {
			query += ` AND type IN (${types.map(() => "?").join(", ")})`;
			params.push(...types);
		} else if (types && types.length === 0) {
			return [];
		}

		query += " ORDER BY id";

		const result = await sql
			.prepare<EdgeRow>(query)
			.bindParams(...params)
			.execute();

		return result.rows.map(mapEdge);
	}

	async getIncomingEdges(
		tenantId: string,
		nodeId: string,
		types?: EdgeType[],
	): Promise<GraphEdge[]> {
		let query = `
      SELECT *
      FROM graph_edges
      WHERE tenant_id = ?
        AND target_node_id = ?
    `;

		const params: unknown[] = [tenantId, nodeId];

		if (types && types.length > 0) {
			query += ` AND type IN (${types.map(() => "?").join(", ")})`;
			params.push(...types);
		} else if (types && types.length === 0) {
			return [];
		}

		query += " ORDER BY id";

		const result = await sql
			.prepare<EdgeRow>(query)
			.bindParams(...params)
			.execute();

		return result.rows.map(mapEdge);
	}

	async listNodes(tenantId: string): Promise<GraphNode[]> {
		const result = await sql
			.prepare<NodeRow>(
				`
        SELECT *
        FROM graph_nodes
        WHERE tenant_id = ?
        ORDER BY id
      `,
			)
			.bindParams(tenantId)
			.execute();

		return result.rows.map(mapNode);
	}

	async listEdges(tenantId: string): Promise<GraphEdge[]> {
		const result = await sql
			.prepare<EdgeRow>(
				`
        SELECT *
        FROM graph_edges
        WHERE tenant_id = ?
        ORDER BY id
      `,
			)
			.bindParams(tenantId)
			.execute();

		return result.rows.map(mapEdge);
	}
}
