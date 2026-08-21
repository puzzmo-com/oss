// The Puzzmo brand mark traced into braille: each cell holds 2x4 dots, and only the
// yellow body is dotted so the dark face reads as holes. Rows are exactly `width`
// columns, which callers rely on to pad around the art without measuring it.

/** The Puzzmo character rendered as terminal art, one string per row. */
export type Mascot = {
  /** Rows of the art, each carrying its own ANSI escapes and ending in a reset. */
  lines: string[]
  /** Visible width in terminal columns, so callers can pad around it. */
  width: number
  /** Height in terminal rows. */
  height: number
}

/** Braille art at 20x10 cells, for when there is room to spare. */
export const mascotLarge: Mascot = {
  lines: [
    "\x1b[38;2;255;192;0m⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣾⠇\x1b[0m",
    "\x1b[38;2;255;192;0m⠀⠀⠀⠀⢀⣠⣤⣴⣶⣶⣶⣦⣤⣀⠀⠀⠀⣾⣿⠀\x1b[0m",
    "\x1b[38;2;255;192;0m⠀⠀⣠⣾⣿⣿⣿⣿⣿⣿⢿⣿⣿⣿⣿⣦⡀⠈⣿⣧\x1b[0m",
    "\x1b[38;2;255;192;0m⠀⣾⣿⣿⣿⣿⣿⣿⣿⣧⣀⣽⣿⣿⣿⣿⣿⣾⡿⠁\x1b[0m",
    "\x1b[38;2;255;192;0m⢸⣿⣿⣿⣿⣀⣹⣿⣿⡿⠟⠛⠉⢻⣿⣿⣿⣿⠀⠀\x1b[0m",
    "\x1b[38;2;255;192;0m⢸⣿⣿⣿⣿⣿⠟⠋⠁⠀⠀⠀⠀⣸⣿⣿⣿⣿⠃⠀\x1b[0m",
    "\x1b[38;2;255;192;0m⠘⣿⣿⣿⣿⣷⣄⠀⠀⠀⢀⣠⣴⣿⣿⣿⣿⡟⠀⠀\x1b[0m",
    "\x1b[38;2;255;192;0m⠀⢘⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠀⠀⠀\x1b[0m",
    "\x1b[38;2;255;192;0m⣰⣿⠟⠙⠻⢿⣿⣿⣿⣿⣿⣿⣿⠿⠛⠁⠀⠀⠀⠀\x1b[0m",
    "\x1b[38;2;255;192;0m⠻⣿⣶⣶⣶⠄⠀⠀⠉⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀\x1b[0m",
  ],
  width: 20,
  height: 10,
}

/** Braille art at 16x8 cells, for tight spots like the upload summary. */
export const mascotSmall: Mascot = {
  lines: [
    "\x1b[38;2;255;192;0m⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣾⠇\x1b[0m",
    "\x1b[38;2;255;192;0m⠀⠀⢀⣤⣶⣶⣿⣿⣿⣷⣶⣤⡀⠐⣿⣄\x1b[0m",
    "\x1b[38;2;255;192;0m⠀⣴⣿⣿⣿⣿⣿⣟⠉⣿⣿⣿⣿⣦⣾⠟\x1b[0m",
    "\x1b[38;2;255;192;0m⣸⣿⣿⣿⣉⣿⣿⡿⠿⠛⠻⣿⣿⣿⡇⠀\x1b[0m",
    "\x1b[38;2;255;192;0m⢻⣿⣿⣿⡿⠋⠁⠀⠀⠀⣰⣿⣿⣿⡇⠀\x1b[0m",
    "\x1b[38;2;255;192;0m⠘⣿⣿⣿⣿⣦⣄⣀⣤⣶⣿⣿⣿⡿⠁⠀\x1b[0m",
    "\x1b[38;2;255;192;0m⢠⣾⠿⢿⣿⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀\x1b[0m",
    "\x1b[38;2;255;192;0m⢿⣷⣶⣶⠈⠉⠉⠉⠉⠉⠀⠀⠀⠀⠀⠀\x1b[0m",
  ],
  width: 16,
  height: 8,
}

/**
 * The art to draw, or null when colour is unavailable. There is no plain-text
 * fallback on purpose: nobody wants eight rows of braille in a CI log.
 */
export const pickMascot = (preferred: Mascot): Mascot | null => (supportsColor() ? preferred : null)

const supportsColor = (): boolean => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
