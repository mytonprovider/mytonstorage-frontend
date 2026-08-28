import { describe, expect, it, vi } from "vitest"
import type { PickedFile } from "@/types/bag"
import { safeName, uploadBag, validatePicked } from "./upload"

describe("safeName", () => {
  it("drops the segments the backend rejects the whole request for", () => {
    expect(safeName("../../etc/passwd")).toBe("etc/passwd")
    expect(safeName("bag/./notes//a.txt")).toBe("bag/notes//a.txt")
  })

  it("never hands the backend a name it would read as 'not a file'", () => {
    expect(safeName("..")).toBe("file")
    expect(safeName("")).toBe("file")
  })

  it("strips the backslash the validator rejects", () => {
    expect(safeName("a\\b.txt")).toBe("ab.txt")
  })
})

const picked = (name: string, content: string): PickedFile => {
  const file = new File([content], name)
  return { name, size: file.size, file }
}

const sentBody = async (files: PickedFile[], description: string): Promise<string> => {
  let captured: FormData | null = null

  class CapturingRequest {
    upload = { addEventListener: () => {} }
    status = 200
    responseText = "{}"
    timeout = 0
    withCredentials = false
    addEventListener = () => {}
    open = () => {}
    abort = () => {}
    send = (body: FormData) => {
      captured = body
    }
  }

  vi.stubGlobal("XMLHttpRequest", CapturingRequest)
  uploadBag(files, description, () => {})
  vi.unstubAllGlobals()

  if (captured === null) throw new Error("upload never reached send")
  return new Response(captured).text()
}

describe("uploadBag", () => {
  it("puts the description before the files, where the backend reads it", async () => {
    const body = await sentBody([picked("notes.txt", "hello")], "backup-2026-08")

    expect(body.indexOf('name="description"')).toBeLessThan(body.indexOf('name="file"'))
  })

  it("wraps every file, so the request body outgrows the bytes the user picked", async () => {
    const bytes = 4096
    const body = await sentBody([picked("dummy.img", "x".repeat(bytes))], "backup-2026-08.tar.zst")
    const wrapping = new TextEncoder().encode(body).length - bytes

    expect(wrapping).toBeGreaterThan(0)
    expect(wrapping).toBeLessThan(1024)
  })

  it("sends the cleaned name, not the one the file system gave", async () => {
    const body = await sentBody([picked("../a\\b.txt", "x")], "")

    expect(body).toContain('filename="ab.txt"')
  })
})

describe("validatePicked", () => {
  it("accepts a clean nested folder", () => {
    expect(validatePicked([picked("bag/docs/a.txt", "x"), picked("bag/docs/b.txt", "y")])).toBeNull()
  })

  it("rejects paths the server would overwrite, naming every colliding spelling", () => {
    const result = validatePicked([picked("bag/docs/a.txt", "x"), picked("bag/docs//a.txt", "y"), picked("bag/b.txt", "z")])

    expect(result).toEqual({ errorKey: "upload.duplicateNames", names: ["bag/docs/a.txt", "bag/docs//a.txt"] })
  })

  it("names a plain duplicate once", () => {
    const result = validatePicked([picked("a.txt", "x"), picked("a.txt", "y")])

    expect(result).toEqual({ errorKey: "upload.duplicateNames", names: ["a.txt"] })
  })

  it("rejects a segment over 255 utf-8 bytes, counting bytes rather than characters", () => {
    const long = `bag/${"я".repeat(128)}/c.txt`

    expect(validatePicked([picked(long, "x")])).toEqual({ errorKey: "upload.nameTooLong", names: [long] })
    expect(validatePicked([picked(`bag/${"a".repeat(255)}`, "x")])).toBeNull()
  })

  it("rejects every name the tonutils-storage validator rejects", () => {
    for (const name of ["nul\u0000.txt", "a\\b.txt", "/etc/a.txt", "bag/dir/", "bag/./a.txt", "bag/../a.txt", ""]) {
      expect(validatePicked([picked(name, "x")])).toEqual({ errorKey: "upload.invalidName", names: [name] })
    }
  })

  it("rejects the bytes the multipart serializer would rename to percent escapes", () => {
    for (const name of ["shot\r\n.png", "cr\r.txt", "lf\n.txt", 'quote".txt']) {
      expect(validatePicked([picked(name, "x")])).toEqual({ errorKey: "upload.invalidName", names: [name] })
    }
  })

  it("keeps the double slash the validator allows", () => {
    expect(validatePicked([picked("bag//a.txt", "x")])).toBeNull()
  })

  it("lets a tab-bearing name through untouched", () => {
    expect(validatePicked([picked("a\tb.txt", "x")])).toBeNull()
    expect(safeName("a\tb.txt")).toBe("a\tb.txt")
  })
})
