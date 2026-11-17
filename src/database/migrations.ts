import { migrationRunner } from "@forge/sql";

import {
	CREATE_GRAPH_NODES,
	CREATE_GRAPH_EDGES,
	CREATE_NODE_TYPE_INDEX,
	CREATE_NODE_EXTERNAL_INDEX,
	CREATE_EDGE_SOURCE_INDEX,
	CREATE_EDGE_TARGET_INDEX,
} from "./schema/001_create_graph_tables";

import {
	CREATE_BITBUCKET_WORKSPACE_LINKS,
	CREATE_BITBUCKET_BRIDGE_EVENTS,
	CREATE_BITBUCKET_BRIDGE_EVENT_STATUS_INDEX,
	ADD_BITBUCKET_BRIDGE_EVENT_LEASE_EXPIRY,
} from "./schema/010_create_bitbucket_bridge_tables";

export const CREATE_SYNC_CHECKPOINTS = `
  CREATE TABLE IF NOT EXISTS sync_checkpoints (
    tenant_id VARCHAR(255) NOT NULL,
    source VARCHAR(32) NOT NULL,
    scope_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,
    last_successful_sync_at BIGINT NULL,
    started_at BIGINT NOT NULL,
    completed_at BIGINT NULL,
    last_error TEXT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, source, scope_id)
  )
`;

export const ADD_SYNC_CHECKPOINT_JOB_ID = `
	ALTER TABLE sync_checkpoints
	ADD COLUMN job_id VARCHAR(255) NULL
`;

export const ADD_SYNC_CHECKPOINT_RESULT_JSON = `
	ALTER TABLE sync_checkpoints
	ADD COLUMN result_json TEXT NULL
`;

const migrations = migrationRunner
	.enqueue("v001_create_graph_nodes", CREATE_GRAPH_NODES)
	.enqueue("v002_create_graph_edges", CREATE_GRAPH_EDGES)
	.enqueue("v003_create_node_type_index", CREATE_NODE_TYPE_INDEX)
	.enqueue("v004_create_node_external_index", CREATE_NODE_EXTERNAL_INDEX)
	.enqueue("v005_create_edge_source_index", CREATE_EDGE_SOURCE_INDEX)
	.enqueue("v006_create_edge_target_index", CREATE_EDGE_TARGET_INDEX)
	.enqueue("v007_create_sync_checkpoints", CREATE_SYNC_CHECKPOINTS)
	.enqueue("v008_add_sync_checkpoint_job_id", ADD_SYNC_CHECKPOINT_JOB_ID)
	.enqueue(
		"v009_add_sync_checkpoint_result_json",
		ADD_SYNC_CHECKPOINT_RESULT_JSON,
	)
	.enqueue(
		"v010_create_bitbucket_workspace_links",
		CREATE_BITBUCKET_WORKSPACE_LINKS,
	)
	.enqueue(
		"v011_create_bitbucket_bridge_events",
		CREATE_BITBUCKET_BRIDGE_EVENTS,
	)
	.enqueue(
		"v012_create_bitbucket_bridge_event_status_index",
		CREATE_BITBUCKET_BRIDGE_EVENT_STATUS_INDEX,
	)
	.enqueue(
		"v013_add_bitbucket_bridge_event_lease_expiry",
		ADD_BITBUCKET_BRIDGE_EVENT_LEASE_EXPIRY,
	);
export async function runMigrations(): Promise<void> {
	await migrations.run();

	console.info("TraceLine migrations completed");
}
