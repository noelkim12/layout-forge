import { describe, expect, test } from "bun:test"
import { readFile } from "fs/promises"
import { join } from "path"
import { assembleUiHtml, writeUiHtml } from "../.opencode/layout-forge/ui/build"

const uiDir = join(process.cwd(), ".opencode/layout-forge/ui")
const indexPath = join(uiDir, "index.html")

describe("ui build", () => {
  test("assembled html matches checked-in index.html", async () => {
    const assembled = await assembleUiHtml()
    const checkedIn = await readFile(indexPath, "utf8")

    expect(assembled).toBe(checkedIn)
  })

  test("assembled html keeps placeholder contracts exactly once", async () => {
    const assembled = await assembleUiHtml()

    expect(assembled.match(/__SESSION_TOKEN__/g)?.length ?? 0).toBe(1)
    expect(assembled.match(/__SESSION_ID__/g)?.length ?? 0).toBe(1)
    expect(assembled.includes("{{STYLE}}")).toBe(false)
    expect(assembled.includes("{{SCRIPT}}")).toBe(false)
  })

  test("writeUiHtml writes assembled output", async () => {
    const assembled = await assembleUiHtml()
    const { html } = await writeUiHtml()

    expect(html).toBe(assembled)
    const written = await readFile(indexPath, "utf8")
    expect(written).toBe(assembled)
  })
})
