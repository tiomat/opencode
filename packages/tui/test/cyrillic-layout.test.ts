import { describe, expect, test } from "bun:test"
import { baseLayoutKey } from "../src/context/cyrillic-layout"

describe("baseLayoutKey", () => {
  test("ставит русские буквы на их физические клавиши QWERTY", () => {
    expect(baseLayoutKey("д")).toBe("l")
    expect(baseLayoutKey("л")).toBe("k")
    expect(baseLayoutKey("о")).toBe("j")
    expect(baseLayoutKey("е")).toBe("t")
    expect(baseLayoutKey("т")).toBe("n")
    expect(baseLayoutKey("ж")).toBe(";")
    expect(baseLayoutKey("х")).toBe("[")
    expect(baseLayoutKey("ё")).toBe("`")
  })

  test("не зависит от регистра", () => {
    expect(baseLayoutKey("Д")).toBe("l")
    expect(baseLayoutKey("Ё")).toBe("`")
  })

  test("не трогает латиницу и имена клавиш", () => {
    expect(baseLayoutKey("l")).toBeUndefined()
    expect(baseLayoutKey("escape")).toBeUndefined()
    expect(baseLayoutKey("")).toBeUndefined()
  })
})
