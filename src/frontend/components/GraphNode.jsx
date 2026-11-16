import React from "react";
import { Button, Inline, Stack, Text } from "@forge/react";

export default function GraphNode({ node, selected, connected, onSelect }) {
	const appearance = selected ? "primary" : connected ? "subtle" : "default";

	return (
		<Stack space="space.050">
			<Button appearance={appearance} onClick={() => onSelect(node.id)}>
				{node.name}
			</Button>

			<Inline alignBlock="center" space="space.050">
				<Text size="small">{node.isSource ? "SOURCE" : node.type}</Text>

				{!node.isSource && node.riskScore !== null && (
					<Text size="small" weight="semibold">
						Risk: {Number(node.riskScore).toFixed(2)} / 100
					</Text>
				)}
			</Inline>

			{!node.isSource && node.riskLevel && (
				<Text size="small" color="color.text.subtle">
					Risk level: {node.riskLevel}
				</Text>
			)}

			{!node.isSource && node.severity && (
				<Text size="small" color="color.text.subtle">
					Impact severity: {node.severity}
				</Text>
			)}

			{!node.isSource && node.criticality && (
				<Text size="small" color="color.text.subtle">
					Criticality: {node.criticality}
				</Text>
			)}
		</Stack>
	);
}
