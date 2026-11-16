import React, { useEffect, useMemo, useState } from "react";
import {
	Button,
	Heading,
	Inline,
	SectionMessage,
	Stack,
	Text,
	Textfield,
} from "@forge/react";

import { buildImpactGraph } from "../utils/graph-utils";
import { formatNumber } from "../utils/formatters";
import GraphNode from "./GraphNode";
import GraphLegend from "./GraphLegend";

export default function ImpactGraph({
	sourceNodeId,
	findings = [],
	risk = null,
	selectedNodeId = null,
	onSelectNode,
}) {
	const [selectedDepth, setSelectedDepth] = useState(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [connectedOnly, setConnectedOnly] = useState(false);

	const graph = useMemo(
		() => buildImpactGraph(sourceNodeId, findings, risk),
		[sourceNodeId, findings, risk],
	);

	const depths = graph.nodesByDepth.map((group) => group.depth);

	useEffect(() => {
		if (
			selectedDepth !== null &&
			!graph.nodesByDepth.some((group) => group.depth === selectedDepth)
		) {
			setSelectedDepth(null);
		}
	}, [graph.nodesByDepth, selectedDepth]);

	const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);

	const selectedEdges = graph.edges.filter(
		(edge) =>
			edge.sourceNodeId === selectedNodeId ||
			edge.targetNodeId === selectedNodeId,
	);

	const connectedNodeIds = new Set(
		selectedEdges.map((edge) =>
			edge.sourceNodeId === selectedNodeId
				? edge.targetNodeId
				: edge.sourceNodeId,
		),
	);

	const normalizedQuery = searchQuery.trim().toLowerCase();

	const matchingNodeIds = new Set(
		graph.nodes
			.filter(
				(node) =>
					!normalizedQuery ||
					node.name.toLowerCase().includes(normalizedQuery) ||
					node.id.toLowerCase().includes(normalizedQuery),
			)
			.map((node) => node.id),
	);

	const visibleNodeIds = new Set(matchingNodeIds);

	if (connectedOnly && selectedNodeId) {
		visibleNodeIds.add(selectedNodeId);

		for (const nodeId of connectedNodeIds) {
			visibleNodeIds.add(nodeId);
		}
	}

	const visibleGroups = graph.nodesByDepth
		.filter((group) => selectedDepth === null || group.depth === selectedDepth)
		.map((group) => ({
			...group,
			nodes: group.nodes.filter((node) => visibleNodeIds.has(node.id)),
		}))
		.filter((group) => group.nodes.length > 0);
	const visibleNodeCount = visibleGroups.reduce(
		(total, group) => total + group.nodes.length,
		0,
	);

	const visibleEdges = graph.edges.filter(
		(edge) =>
			visibleNodeIds.has(edge.sourceNodeId) &&
			visibleNodeIds.has(edge.targetNodeId),
	);

	function clearSelection() {
		onSelectNode?.(null);
		setConnectedOnly(false);
	}

	function selectNode(nodeId) {
		onSelectNode?.(nodeId);
		setConnectedOnly(false);
	}

	if (graph.affectedNodeCount === 0) {
		const emptyMessage = findings.length === 0
			? "No affected components were identified for this issue."
			: "Affected components were found, but no dependency path evidence is available to display.";

		return (
			<Stack space="space.100">
				<Heading size="medium">Dependency graph</Heading>

				<SectionMessage appearance="information">
					<Text>{emptyMessage}</Text>
				</SectionMessage>
			</Stack>
		);
	}

	return (
		<Stack space="space.200">
			<Stack space="space.050">
				<Heading size="medium">Dependency graph</Heading>

				<Text color="color.text.subtle">
					Explore affected components, search for a component, and inspect its
					dependency relationships.
				</Text>

				<Inline alignBlock="center" space="space.200" shouldWrap>
					<Text weight="semibold">
						{graph.affectedNodeCount} affected components
					</Text>

					<Text color="color.text.subtle">{graph.relationshipCount} relationships</Text>
				</Inline>
			</Stack>

			<GraphLegend />

			<Stack space="space.100">
				<Text weight="semibold">Search components</Text>

				<Textfield
					name="graph-node-search"
					placeholder="Search by component name or ID"
					value={searchQuery}
					onChange={(event) => setSearchQuery(event?.target?.value ?? "")}
				/>

					<Text color="color.text.subtle" size="small">
					{visibleNodeCount} of {graph.nodes.length} nodes shown
				</Text>
			</Stack>

			<Stack space="space.100">
				<Text weight="semibold">Filter by dependency depth</Text>

				<Inline space="space.100" shouldWrap rowSpace="space.100">
					<Button
						appearance={selectedDepth === null ? "primary" : "default"}
						onClick={() => setSelectedDepth(null)}
					>
						All
					</Button>

					{depths.map((depth) => (
						<Button
							key={depth}
							appearance={selectedDepth === depth ? "primary" : "default"}
							onClick={() => setSelectedDepth(depth)}
						>
							{depth === 0 ? "Source" : `Depth ${depth}`}
						</Button>
					))}
				</Inline>
			</Stack>

			{selectedNode && (
				<Inline alignBlock="center" space="space.100" shouldWrap>
					<Button
						appearance={connectedOnly ? "primary" : "default"}
						onClick={() => setConnectedOnly((current) => !current)}
					>
						{connectedOnly ? "Show all matching nodes" : "Show connected nodes"}
					</Button>

					<Button appearance="subtle" onClick={clearSelection}>
						Clear selection
					</Button>
				</Inline>
			)}

			{visibleGroups.length === 0 ? (
				<SectionMessage appearance="information">
					<Text>
						No components match your search and selected filters. Try another
						search or clear the filters.
					</Text>
				</SectionMessage>
			) : (
				<Stack space="space.200">
					{visibleGroups.map((group) => {
						const groupEdges = visibleEdges.filter((edge) =>
							group.nodes.some((node) => node.id === edge.sourceNodeId),
						);

						return (
							<Stack key={group.depth} space="space.100">
								<Heading size="small">
									{group.depth === 0
										? "Source issue"
										: `Dependency depth ${group.depth}`}
								</Heading>

								{group.nodes.map((node) => (
									<GraphNode
										key={node.id}
										node={node}
										selected={selectedNodeId === node.id}
										connected={connectedNodeIds.has(node.id)}
										onSelect={selectNode}
									/>
								))}

								{groupEdges.map((edge) => {
									const highlighted =
										selectedNodeId !== null &&
										(edge.sourceNodeId === selectedNodeId ||
											edge.targetNodeId === selectedNodeId);

									return (
										<Inline
											key={edge.id}
											alignBlock="center"
											space="space.050"
											shouldWrap
										>
											<Text
												size="small"
												weight={highlighted ? "semibold" : "regular"}
											>
												{edge.sourceName}
											</Text>

											<Text
												size="small"
												color="color.text.subtle"
												weight={highlighted ? "semibold" : "regular"}
											>
												-- {edge.type} →
											</Text>

											<Text
												size="small"
												weight={highlighted ? "semibold" : "regular"}
											>
												{edge.targetName}
											</Text>
										</Inline>
									);
								})}
							</Stack>
						);
					})}
				</Stack>
			)}

			{selectedNode && (
				<SectionMessage appearance="information">
					<Stack space="space.100">
						<Heading size="small">
							Selected component: {selectedNode.name}
						</Heading>

						<Text size="small">ID: {selectedNode.id}</Text>
						<Text size="small">Node type: {selectedNode.type}</Text>
						<Text size="small">Dependency depth: {selectedNode.depth}</Text>

						{selectedNode.riskScore !== null && (
							<Text size="small">
													Risk score: {formatNumber(selectedNode.riskScore)} / 100
							</Text>
						)}

						{selectedNode.riskLevel && (
							<Text size="small">Risk level: {selectedNode.riskLevel}</Text>
						)}

						{selectedNode.severity && (
							<Text size="small">Impact severity: {selectedNode.severity}</Text>
						)}

						{selectedNode.criticality && (
							<Text size="small">Criticality: {selectedNode.criticality}</Text>
						)}

						<Heading size="small">
							Relationships ({selectedEdges.length})
						</Heading>

						{selectedEdges.length === 0 ? (
							<Text size="small">
								No relationships are available for this node.
							</Text>
						) : (
							selectedEdges.map((edge) => (
								<Stack key={edge.id} space="space.050">
									<Text size="small" weight="semibold">
										{edge.sourceName} -- {edge.type} → {edge.targetName}
									</Text>

									{edge.evidenceText && (
										<Text size="small" color="color.text.subtle">
											{edge.evidenceText}
										</Text>
									)}

									{edge.sourceSystem && (
										<Text size="small" color="color.text.subtle">
											Source: {edge.sourceSystem}
										</Text>
									)}

									{edge.externalReference && (
										<Text size="small" color="color.text.subtle">
											Reference: {edge.externalReference}
										</Text>
									)}
								</Stack>
							))
						)}
					</Stack>
				</SectionMessage>
			)}
		</Stack>
	);
}
