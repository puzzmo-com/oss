import type { Theme } from "./types"

export const lightTheme: Theme = {
  name: "Puzzmo (light)",
  type: "light" as "light" | "dark",

  /** The bright Pink */
  key: "#FFAAAC",
  /** The color to draw on a key */
  keyFG: "#000000",
  /** A bolder version of the bright pink */
  keyStrong: "#F7868B",
  /** A lighter version of the bright pink */
  keyLight: "#FFD2D3",
  /** The bright Pink */
  g_key: "#FFAAAC",

  /** A secondary color for the brand, in Puzzmo's case this is the puzzmo yellow */
  subBrand: "#FFC000",
  /** Foreground color for the secondary */
  subBrandFG: "#000000",

  /** The blue you traditionally see around a user avatar and selection */
  player: "#5DBAFC",
  /** The color render text above a players */
  playerFG: "#000000",
  /** A lighter variant on the user's blue */
  playerLight: "#9EDDFF",
  /** Alt color, this one is an earthy green in the main theme */
  alt1: "#98B389",
  /** Alt color 2, this one is a faded yellow which looks quite like the puzmo yellow */
  alt2: "#FAC16C",
  /** Alt color 3, this one is a cute purple */
  alt3: "#D298FF",

  /** The foreground body text color */
  fg: "#000000",
  /** The red for showing errors */
  error: "#FF3C3C",

  /** Stays dark regardless of being in light/dark mode */
  alwaysDark: "#1B1D29",
  /** Stays light regardless of being in light/dark mode */
  alwaysLight: "#FFFFFF",

  /** The 'tile' usually */
  g_bg: "#FFFFFF",
  /** The 'tile' alternative in checkered patterns */
  g_bgAlt: "#EBEBEB",
  /** Sorta useful for content layers on the existing bg, a darker version */
  g_bgDark: "#D6D6D6",
  /** When _the text_ is on a light background, this is basically black */
  g_textDark: "#1B1B28",
  /** When _the text_ is dark background, this is white */
  g_textLight: "#FFFFFF",
  /** For voids in a game, this is black */
  g_blank: "#000000",
  /** For when a tile is not yet solved, this is a lighter grey */
  g_unsolved: "#C2C2C2",
  /** Border for a game frame, for example the crossword edge */
  g_outline: "#1B1D29",

  /** The light grey you see as the background for most pages */
  a_bg: "#F2F2F2",
  /** The darker grey which usually is seen as borders in the background */
  a_bgAlt: "#ECECEC",
  /** The yellow shade of the puzmonaut */
  a_puzmo: "#FFC000",
  /** Header colors */
  a_headerText: "#000000",
  /** When tabulating results, the background color for an even table row */
  a_table: "#F9F9F9",
  /** When tabulating results, the background color for an odd table row */
  a_tableAlt: "#F6F4F4",
  /** Inline tag bg (??) */
  a_inlineTag: "#D9D9D9",
  /** Used to indicate a link */
  a_anchor: "#1F97EE",
  /** The background color of the info bar, couldn't think of a semantic name :D */
  a_infoBG: "#FFFFFF",
}

const darkTheme: Theme = {
  name: "Puzzmo (dark)",
  type: "dark" as "light" | "dark",
  key: "#FFAAAC",
  keyFG: "#000000",
  keyStrong: "#F7868B",
  keyLight: "#FFD2D3",
  g_key: "#FFAAAC",
  player: "#5DBAFC",
  playerFG: "#000000",
  playerLight: "#9EDDFF",
  subBrand: "#FFC000",
  subBrandFG: "#000000",
  alt1: "#98B389",
  alt2: "#FAC16C",
  alt3: "#D298FF",
  error: "#FF3C3C",

  fg: "#ECECEC",
  alwaysDark: "#1B1D29",
  alwaysLight: "#FFFFFF",

  g_bg: "#374351",
  g_bgAlt: "#333D49",
  g_bgDark: "#2C2F33",
  g_textDark: "#F2F2F2",
  g_textLight: "#20180E",
  g_blank: "#000000",
  g_unsolved: "#747474",
  g_outline: "#646464",

  a_bg: "#141620",
  a_bgAlt: "#202433",
  a_puzmo: "#FFC000",
  a_headerText: "#A1BAD4",
  a_table: "#303246",
  a_tableAlt: "#393b52",
  a_inlineTag: "#ECECEC",
  a_anchor: "#1F97EE",
  a_infoBG: "#282C3A",
}

const brightWhiteTheme: Theme = {
  name: "Bright white",
  type: "light" as "light" | "dark",
  key: "#67ced2",
  keyFG: "#000000",
  keyStrong: "#26a0a5",
  keyLight: "#ade6e9",
  g_key: "#67ced2",

  subBrand: "#FFC000",
  subBrandFG: "#000000",
  player: "#5DBAFC",
  playerFG: "#000000",
  playerLight: "#9EDDFF",
  alt1: "#d26767",
  alt2: "#fac16c",
  alt3: "#7580bd",

  fg: "#000000",
  error: "#FF3C3C",

  alwaysDark: "#111111",
  alwaysLight: "#FFFFFF",

  g_bg: "#f6f6f6",
  g_bgAlt: "#F4F4F4",
  g_bgDark: "#D6D6D6",
  g_textDark: "#1B1B28",
  g_textLight: "#FFFFFF",
  g_blank: "#000000",
  g_unsolved: "#C2C2C2",
  g_outline: "#1B1D29",

  a_bg: "#FFFFFF",
  a_bgAlt: "#f8fbfc",
  a_puzmo: "#FFC000",
  a_headerText: "#000000",
  a_table: "#EDEDED",
  a_tableAlt: "#DBDBDB",
  a_inlineTag: "#D9D9D9",
  a_anchor: "#1F97EE",
  a_infoBG: "#f6f6f6",
}

const newsPaperDarkTheme: Theme = {
  name: "News paper dark",
  type: "dark" as "light" | "dark",
  key: "#FFAAAC",
  keyFG: "#000000",
  keyStrong: "#F7868B",
  keyLight: "#FFD2D3",
  g_key: "#FFAAAC",

  player: "#5DBAFC",
  playerFG: "#000000",
  playerLight: "#9EDDFF",
  subBrand: "#FFC000",
  subBrandFG: "#000000",
  alt1: "#98B389",
  alt2: "#FAC16C",
  alt3: "#D298FF",
  error: "#FF3C3C",

  fg: "#ECECEC",
  alwaysDark: "#000000",
  alwaysLight: "#FFFFFF",

  g_bg: "#374351",
  g_bgAlt: "#333D49",
  g_bgDark: "#2C2F33",
  g_textDark: "#F2F2F2",
  g_textLight: "#20180E",
  g_blank: "#000000",
  g_unsolved: "#747474",
  g_outline: "#646464",

  a_bg: "#000000",
  a_bgAlt: "#202433",
  a_puzmo: "#FFC000",
  a_headerText: "#A1BAD4",
  a_table: "#303246",
  a_tableAlt: "#393b52",
  a_inlineTag: "#ECECEC",
  a_anchor: "#1F97EE",
  a_infoBG: "#000000",
}

export const themes: Theme[] = [
  lightTheme,
  darkTheme,
  {
    name: "Foshay",
    type: "light" as "light" | "dark",
    key: "#98B389",
    keyFG: "#313540",
    keyStrong: "#87BD69",
    keyLight: "#809B77",
    g_key: "#98B389",

    player: "#3EC0E5",
    subBrand: "#FFC000",
    subBrandFG: "#000000",
    playerFG: "#292B35",
    playerLight: "#A8B5D6",
    alt1: "#D87DA4",
    alt2: "#E3A54F",
    alt3: "#D298FF",
    error: "#FF3C3C",

    fg: "#292B35",
    alwaysDark: "#292B35",
    alwaysLight: "#D1DBF2",

    g_bg: "#949EBA",
    g_bgAlt: "#8891AB",
    g_bgDark: "#7B839B",
    g_textDark: "#292B35",
    g_textLight: "#FFFFFF",
    g_blank: "#292B35",
    g_unsolved: "#B6B7BA",
    g_outline: "#676F83",

    a_bg: "#828CA3",
    a_bgAlt: "#7F889F",
    a_puzmo: "#FFC000",
    a_headerText: "#292B35",
    a_table: "#7A8399",
    a_tableAlt: "#767E94",
    a_inlineTag: "#ECECEC",
    a_anchor: "#56C9E9",
    a_infoBG: "#767F95",
  },
  brightWhiteTheme,
  {
    name: "Submersible",
    type: "dark" as "light" | "dark",
    key: "#CD6DC6",
    keyFG: "#031698",
    keyStrong: "#FF7ABC",
    keyLight: "#B467CB",
    g_key: "#CD6DC6",
    subBrand: "#FFC000",
    subBrandFG: "#000000",
    player: "#4AB1D1",
    playerFG: "#071D47",
    playerLight: "#3C99D7",
    alt1: "#8BA964",
    alt2: "#C69A58",
    alt3: "#7644B5",
    fg: "#FFEBFF",
    error: "#FF3C3C",
    alwaysDark: "#031698",
    alwaysLight: "#FFEBFF",
    g_bg: "#043BED",
    g_bgAlt: "#0A31CC",
    g_bgDark: "#0E2DA8",
    g_textDark: "#031698",
    g_textLight: "#FFEBFF",
    g_blank: "#031698",
    g_unsolved: "#3662F1",
    g_outline: "#031698",
    a_bg: "#043BED",
    a_bgAlt: "#0A31CC",
    a_puzmo: "#FFC000",
    a_headerText: "#FFEBFF",
    a_table: "#043BED",
    a_tableAlt: "#0A31CC",
    a_inlineTag: "#FF7ABC",
    a_anchor: "#FF7ABC",
    a_infoBG: "#0A31CC",
  },
  {
    name: "Hot Dog (beta)",
    type: "light" as "light" | "dark",

    key: "#FFFF00",
    keyFG: "#000000",
    keyStrong: "#FFE600",
    keyLight: "#FFEC44",
    g_key: "#FFFF00",
    subBrand: "#FFC000",
    subBrandFG: "#000000",
    player: "#FF7A00",
    playerFG: "#000000",
    playerLight: "#FFA450",
    alt1: "#3ABC5E",
    alt2: "#5C3ABC",
    alt3: "#BC3AAF",
    fg: "#000000",
    error: "#FF3C3C",
    alwaysDark: "#1B1D29",
    alwaysLight: "#FFFFFF",
    g_bg: "#EBFF00",
    g_bgAlt: "#EBEBEB",
    g_bgDark: "#D6D6D6",
    g_textDark: "#1B1B28",
    g_textLight: "#FFFFFF",
    g_blank: "#000000",
    g_unsolved: "#C2C2C2",
    g_outline: "#1B1D29",
    a_bg: "#FF0000",
    a_bgAlt: "#E50000",
    a_puzmo: "#FFC000",
    a_headerText: "#FFFFFF",
    a_table: "#E50000",
    a_tableAlt: "#FF2525",
    a_inlineTag: "#000000",
    a_anchor: "#000000",
    a_infoBG: "#C6C6C6",
  },
  {
    name: "Outlook Hayesy",
    type: "light" as "light" | "dark",
    key: "#DAB98C",
    keyFG: "#000000",
    keyStrong: "#B99368",
    keyLight: "#DAB98C",
    subBrand: "#FFC000",
    subBrandFG: "#000000",
    g_key: "#DAB98C",
    player: "#5DBAFC",
    playerFG: "#000000",
    playerLight: "#9EDDFF",
    alt1: "#5EC386",
    alt2: "#5E93C3",
    alt3: "#C35E5E",
    fg: "#000000",
    error: "#FF3C3C",
    alwaysDark: "#5E390F",
    alwaysLight: "#FFF3E4",
    g_bg: "#FFFFFF",
    g_bgAlt: "#EBEBEB",
    g_bgDark: "#D6D6D6",
    g_textDark: "#1B1B28",
    g_textLight: "#FFFFFF",
    g_blank: "#000000",
    g_unsolved: "#C2C2C2",
    g_outline: "#1B1D29",

    a_bg: "#FEF5E8",
    a_bgAlt: "#ffffff",
    a_puzmo: "#FAC7CE",
    a_headerText: "#000000",
    a_table: "#FAE8D3",
    a_tableAlt: "#EED7BC",
    a_inlineTag: "#D9D9D9",
    a_anchor: "#B99368",
    a_infoBG: "#FFFFFF",
  },
  {
    name: "Console (beta)",
    type: "dark" as "light" | "dark",

    key: "#957df9",
    keyFG: "#000000",

    keyStrong: "#590FF5",
    keyLight: "#590FF5",
    subBrand: "#FFC000",
    subBrandFG: "#000000",
    g_key: "#FFFF00",
    player: "#ffffff",
    playerFG: "#000000",
    playerLight: "#9EDDFF",
    alt1: "#590ff5",
    alt2: "#00e200",
    alt3: "#ff8a02",

    fg: "#00e200",
    error: "#FF3C3C",

    alwaysDark: "#1B1D29",
    alwaysLight: "#00e200",

    g_bg: "#101428",
    g_bgAlt: "#101428",
    g_bgDark: "#00e200",
    g_textDark: "#00e200",
    g_textLight: "#590ff5",
    g_blank: "#00e200",
    g_unsolved: "#0000ff",
    g_outline: "#00e200",

    a_bg: "#000000",
    a_bgAlt: "#112211",
    a_puzmo: "#ffffff",
    a_headerText: "#00e200",
    a_table: "#000000",
    a_tableAlt: "#002200",
    a_inlineTag: "#D9D9D9",
    a_anchor: "#957df9",
    a_infoBG: "#001900",
  },
]

export const defaultLightTheme = lightTheme
export const defaultDarkTheme = darkTheme
export const newsPaperLightTheme = brightWhiteTheme

export const modifiedNewsPaperTheme = (type: "light" | "dark", hexes: string[] | readonly string[], partnerSlug: string) => {
  const baseTheme = (type === "light" ? newsPaperLightTheme : newsPaperDarkTheme) as Theme

  const theme = {
    ...baseTheme,
    name: baseTheme.name + partnerSlug ? `-(${partnerSlug})` : "",
    a_puzmo: hexes[0] || baseTheme.a_puzmo,
    key: hexes[1] || baseTheme.key,
    keyLight: hexes[2] || baseTheme.keyLight,
    keyStrong: hexes[3] || baseTheme.keyStrong,
    alt1: hexes[4] || baseTheme.alt1,
    alt2: hexes[5] || baseTheme.alt2,
    alt3: hexes[6] || baseTheme.alt3,
    keyFG: hexes[7] || baseTheme.player,
    player: hexes[8] || baseTheme.player,
    playerLight: hexes[9] || baseTheme.playerLight,
    playerFG: hexes[10] || baseTheme.playerFG,
    subBrand: hexes[11] || baseTheme.subBrand,
    subBrandFG: hexes[12] || baseTheme.subBrandFG,
    g_key: hexes[13] || baseTheme.subBrandFG,
    a_infoBG: type === "light" ? baseTheme.alwaysLight : baseTheme.alwaysDark,
  }
  return theme
}

export type PuzmoTheme = typeof lightTheme

// Useless JS until we get 'satisfies' in TS 4.9
const validThemes = (_theme: readonly Theme[]): _theme is PuzmoTheme[] => true
validThemes(themes)
