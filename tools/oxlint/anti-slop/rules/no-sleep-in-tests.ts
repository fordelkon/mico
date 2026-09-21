import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const realTimeSleepNames = new Set(["sleep", "delay", "pause", "waitForTimeout"]);
const rawTimerNames = new Set(["setTimeout", "setInterval"]);
const waitForNames = new Set(["waitFor", "waitForElementToBeRemoved"]);

/** Only enforce on test files so production code can still schedule work with timers. */
function isTestFileName(filename: string): boolean {
	return (
		/(\.test|\.spec)\.[cm]?[jt]sx?$/i.test(filename) ||
		/(^|[\\/])__tests__([\\/]|$)/i.test(filename)
	);
}

function memberName(callee: ESTree.Expression): string | null {
	if (callee.type !== "MemberExpression" || callee.computed) return null;
	return callee.property.type === "Identifier" ? callee.property.name : null;
}

/** Time-dependent tests must use fake timers or deterministic coordination, never real time. */
export const noSleepInTestsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow sleeping on real time in tests; time logic must go through fake timers or deterministic coordination.",
		},
		messages: {
			realTimeSleep:
				"Do not sleep in tests. Use vi.useFakeTimers() with vi.advanceTimersByTime*() or deterministic coordination (deferreds, signals, awaited iterators).",
			rawTimer:
				"Do not call setTimeout/setInterval directly in tests. Use vi.useFakeTimers() and vi.advanceTimersByTime*() to control time.",
			waitForTimeoutOption:
				"Do not pass a timeout option to waitFor. Coordinate deterministically and advance fake timers instead of waiting on real time.",
		},
	},
	create(context) {
		if (!isTestFileName(context.filename)) return {};

		return {
			CallExpression(node) {
				if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;

				if (node.callee.type === "Identifier" && realTimeSleepNames.has(node.callee.name)) {
					context.report({ node, messageId: "realTimeSleep" });
					return;
				}

				const member = memberName(node.callee);
				if (member === null) return;
				if (rawTimerNames.has(member)) {
					context.report({ node, messageId: "rawTimer" });
					return;
				}

				if (waitForNames.has(member)) {
					const options = node.arguments[node.arguments.length - 1];
					if (
						options !== undefined &&
						options.type === "ObjectExpression" &&
						options.properties.some(
							(property) =>
								property.type === "Property" &&
								!property.computed &&
								((property.key.type === "Identifier" && property.key.name === "timeout") ||
									(property.key.type === "Literal" && property.key.value === "timeout")),
						)
					) {
						context.report({ node, messageId: "waitForTimeoutOption" });
					}
				}
			},
		};
	},
});
