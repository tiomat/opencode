import type { KeyEvent, Renderable } from "@opentui/core"
import type { Keymap } from "@opentui/keymap"

// Терминалы без kitty-режима «report alternate keys» (например, Ghostty с
// русской раскладкой) присылают русскую букву без базовой латинской клавиши, и
// `registerBaseLayoutFallback` из @opentui/keymap молчит — последовательности
// вида `ctrl+x l` не срабатывают. Таблица повторяет физические позиции ЙЦУКЕН
// на QWERTY, то есть делает то, что сделал бы терминал, прислав base-код.
const BASE_LAYOUT: Readonly<Record<string, string>> = {
  й: "q",
  ц: "w",
  у: "e",
  к: "r",
  е: "t",
  н: "y",
  г: "u",
  ш: "i",
  щ: "o",
  з: "p",
  х: "[",
  ъ: "]",
  ё: "`",
  ф: "a",
  ы: "s",
  в: "d",
  а: "f",
  п: "g",
  р: "h",
  о: "j",
  л: "k",
  д: "l",
  ж: ";",
  э: "'",
  я: "z",
  ч: "x",
  с: "c",
  м: "v",
  и: "b",
  т: "n",
  ь: "m",
  б: ",",
  ю: ".",
}

/** Латинская клавиша, на которой стоит эта русская буква; иначе undefined. */
export function baseLayoutKey(name: string): string | undefined {
  if (name.length !== 1) return
  return BASE_LAYOUT[name.toLowerCase()]
}

export function registerCyrillicLayoutFallback(keymap: Keymap<Renderable, KeyEvent>) {
  return keymap.appendEventMatchResolver((event, ctx) => {
    // Терминал уже прислал базовую клавишу — пусть решает base-layout addon.
    if (event.baseCode !== undefined) return
    const name = baseLayoutKey(event.name)
    if (!name) return
    return [
      ctx.resolveKey({
        name,
        ctrl: event.ctrl,
        shift: event.shift,
        meta: event.meta,
        super: event.super ?? false,
        hyper: event.hyper || undefined,
      }),
    ]
  })
}
