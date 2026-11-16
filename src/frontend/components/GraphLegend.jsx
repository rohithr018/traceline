import React from "react";
import { Inline, Text } from "@forge/react";

export default function GraphLegend() {
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
			<Text size="small">Source is the current Jira issue.</Text>
			<Text size="small">Select a node to inspect its relationships.</Text>
		</Inline>
	);
}
