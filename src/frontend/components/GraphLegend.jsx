import React from "react";
import { Inline, Text } from "@forge/react";

export default function GraphLegend({ sourceLabel = "Source is the current Jira issue." }) {
	return (
		<Inline
			alignBlock="center"
			space="space.100"
			shouldWrap
			rowSpace="space.100"
		>
			<Text size="small" weight="semibold">
				Graph guide:
			</Text>
			<Text size="small">{sourceLabel}</Text>
			<Text size="small">Select a node to inspect its relationships.</Text>
		</Inline>
	);
}
