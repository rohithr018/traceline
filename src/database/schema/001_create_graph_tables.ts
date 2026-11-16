export const CREATE_GRAPH_NODES = `
CREATE TABLE IF NOT EXISTS graph_nodes (
  tenant_id VARCHAR(128) NOT NULL,
  id VARCHAR(255) NOT NULL,

  type VARCHAR(40) NOT NULL,
  source VARCHAR(40) NOT NULL,

  external_id VARCHAR(255),
  name VARCHAR(500) NOT NULL,
  description TEXT,
  url TEXT,

  attributes TEXT NOT NULL,

  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_synced_at BIGINT NOT NULL,

  PRIMARY KEY (tenant_id, id)
)
`;

export const CREATE_GRAPH_EDGES = `
CREATE TABLE IF NOT EXISTS graph_edges (
  tenant_id VARCHAR(128) NOT NULL,
  id VARCHAR(255) NOT NULL,

  source_node_id VARCHAR(255) NOT NULL,
  target_node_id VARCHAR(255) NOT NULL,

  type VARCHAR(40) NOT NULL,

  weight DOUBLE NOT NULL,
  confidence DOUBLE NOT NULL,

  provenance TEXT NOT NULL,

  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,

  PRIMARY KEY (tenant_id, id)
)
`;

export const CREATE_NODE_TYPE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_nodes_type
ON graph_nodes (tenant_id, type)
`;

export const CREATE_NODE_EXTERNAL_INDEX = `
CREATE INDEX IF NOT EXISTS idx_nodes_external
ON graph_nodes (tenant_id, external_id)
`;

export const CREATE_EDGE_SOURCE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_edges_source
ON graph_edges (tenant_id, source_node_id, type)
`;

export const CREATE_EDGE_TARGET_INDEX = `
CREATE INDEX IF NOT EXISTS idx_edges_target
ON graph_edges (tenant_id, target_node_id, type)
`;
