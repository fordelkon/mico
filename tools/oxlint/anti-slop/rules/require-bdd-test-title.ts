import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const testNames = new Set(["it", "test", "specify"]);
const directWrapperProperties = new Set(["each", "skip", "only", "failing", "todo"]);
const titlePrefix = /^user\b/;
const whenKeyword = /\bwhen\b/;
const thenKeyword = /\bthen\b/;
const maxTitleLength = 140;

/** Only enforce on test files so helper modules can still build titles dynamically. */
function isTestFileName(filename: string): boolean {
	return (
		/(\.test|\.spec)\.[cm]?[jt]sx?$/i.test(filename) ||
		/(^|[\\/])__tests__([\\/]|$)/i.test(filename)
	);
}

/** Extract the statically readable title string of an `it`/`test` (including `it.each(...)()` / `it.skip`) call. */
function titleOf(node: ESTree.CallExpression): string | null {
	const { callee } = node;
	const firstArgument = node.arguments[0];

	if (callee.type === "Identifier" && testNames.has(callee.name)) {
		return staticText(firstArgument);
	}

	if (
		callee.type === "MemberExpression" &&
		!callee.computed &&
		callee.property.type === "Identifier" &&
		directWrapperProperties.has(callee.property.name) &&
		callee.object.type === "Identifier" &&
		testNames.has(callee.object.name)
	) {
		return staticText(firstArgument);
	}

	if (callee.type === "CallExpression") {
		const inner = callee.callee;
		if (
			inner.type === "MemberExpression" &&
			!inner.computed &&
			inner.property.type === "Identifier" &&
			inner.property.name === "each" &&
			inner.object.type === "Identifier" &&
			testNames.has(inner.object.name)
		) {
			return staticText(firstArgument);
		}
	}

	return null;
}

function staticText(node: ESTree.Expression | ESTree.SpreadElement | undefined): string | null {
	if (node === undefined || node.type === "SpreadElement") return null;
	if (node.type === "Literal" && typeof node.value === "string") return node.value;
	if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
		return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
	}
	return null;
}

/** Test titles must read as user-visible acceptance scenarios (Given/When/Then), not implementation notes. */
export const requireBddTestTitleRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Require test titles to start with `user` and state a Given/When/Then scenario (`user ... when ..., then ...`).",
		},
		messages: {
			bddTitle:
				"Test titles must describe user-visible behavior: start with 'user' and include 'when' and 'then', e.g. 'user cannot place a duplicate order when resubmitting, then is charged only once'.",
			longTitle:
				"Test title is too long; state one lean scenario instead of restating mechanics, e.g. 'user sees a generated title when the first message completes, then it is persisted'.",
		},
	},
	create(context) {
		if (!isTestFileName(context.filename)) return {};

		return {
			CallExpression(node) {
				if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
				const title = titleOf(node);
				if (title === null) return;
				if (!titlePrefix.test(title) || !whenKeyword.test(title) || !thenKeyword.test(title)) {
					context.report({ node, messageId: "bddTitle" });
					return;
				}
				if (title.length > maxTitleLength) {
					context.report({ node, messageId: "longTitle" });
				}
			},
		};
	},
});
