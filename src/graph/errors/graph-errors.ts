export class GraphError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GraphError";
	}
}

export class GraphNodeNotFoundError extends GraphError {
	constructor(nodeId: string) {
		super(`Graph node not found: ${nodeId}`);
		this.name = "GraphNodeNotFoundError";
	}
}

export class GraphValidationError extends GraphError {
	constructor(message: string) {
		super(message);
		this.name = "GraphValidationError";
	}
}

export class GraphTenantMismatchError extends GraphError {
	constructor() {
		super("Graph entities belong to different tenants.");
		this.name = "GraphTenantMismatchError";
	}
}
