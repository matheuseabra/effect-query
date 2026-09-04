import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("README", () => {
	it("shows the actual package version in the version badge", () => {
		const pkg = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8")
		) as { version: string }
		const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
		expect(readme).toContain(`version-${pkg.version.replace(/-/g, "--")}`)
	})
})
