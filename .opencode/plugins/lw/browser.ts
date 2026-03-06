import { platform } from "os"
import { execSync } from "child_process"

function isWSL(): boolean {
  try {
    const release = execSync("uname -r", { encoding: "utf-8" })
    return (
      release.toLowerCase().includes("microsoft") ||
      release.toLowerCase().includes("wsl")
    )
  } catch {
    return false
  }
}

/**
 * Fallback chain for WSL: wslview → cmd.exe → xdg-open → return false.
 * Non-fatal: never throws.
 */
export async function openBrowser(url: string): Promise<boolean> {
  const os = platform()

  try {
    if (os === "darwin") {
      Bun.spawn(["open", url])
      return true
    }

    if (os === "win32") {
      Bun.spawn(["cmd.exe", "/c", "start", url])
      return true
    }

    if (isWSL()) {
      try {
        Bun.spawn(["wslview", url])
        return true
      } catch {
        /* fallthrough */
      }

      try {
        Bun.spawn(["cmd.exe", "/c", "start", url.replace(/&/g, "^&")])
        return true
      } catch {
        /* fallthrough */
      }
    }

    try {
      Bun.spawn(["xdg-open", url])
      return true
    } catch {
      /* fallthrough */
    }

    return false
  } catch {
    return false
  }
}
