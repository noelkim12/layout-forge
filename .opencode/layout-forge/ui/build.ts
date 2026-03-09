import { readFile, writeFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"
import { cssOrder } from "./src/styles/_order"
import { jsOrder } from "./src/js/_order"

const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url))
const SOURCE_DIR = join(ROOT_DIR, "src")
const TEMPLATE_PATH = join(SOURCE_DIR, "template.html")
const OUTPUT_PATH = join(ROOT_DIR, "index.html")

const readOrdered = async (dirPath: string, order: readonly string[]) => {
  const contents = await Promise.all(order.map(async (fileName) => {
    const fullPath = join(dirPath, fileName)
    return readFile(fullPath, "utf8")
  }))
  return contents.join("")
}

export const assembleUiHtml = async () => {
  const [template, css, js] = await Promise.all([
    readFile(TEMPLATE_PATH, "utf8"),
    readOrdered(join(SOURCE_DIR, "styles"), cssOrder),
    readOrdered(join(SOURCE_DIR, "js"), jsOrder),
  ])

  return template
    .replace("{{STYLE}}", css)
    .replace("{{SCRIPT}}", js)
}

export const writeUiHtml = async () => {
  const html = await assembleUiHtml()
  await writeFile(OUTPUT_PATH, html, "utf8")
  return { outputPath: OUTPUT_PATH, html }
}

if (import.meta.main) {
  await writeUiHtml()
}
