import type { FixtureImports } from "./types"

/** Parse fixture imports into a structured format: { category: { filename: data } } */
export function parseFixtures(fixtures: FixtureImports): Map<string, Map<string, any>> {
  const result = new Map<string, Map<string, any>>()

  console.log("Simulator: Parsing fixtures", Object.keys(fixtures))

  for (const [path, module] of Object.entries(fixtures)) {
    // Extract category and filename from path like "./fixtures/puzzles/3x3/puzzle_1.json"
    const parts = path.split("/")
    const filename = parts.pop()?.replace(".json", "") ?? ""
    const category = parts.pop() ?? "default"

    if (!result.has(category)) {
      result.set(category, new Map())
    }

    const data = (module as any).default ?? module
    result.get(category)!.set(filename, data)
  }

  // Sort puzzles naturally (puzzle_1, puzzle_2, ... puzzle_10, puzzle_11)
  result.forEach((puzzles, category) => {
    const sorted = new Map<string, any>(
      Array.from(puzzles.entries()).sort((a, b) => {
        const numA = parseInt(a[0].match(/\d+/)?.[0] ?? "0")
        const numB = parseInt(b[0].match(/\d+/)?.[0] ?? "0")
        return numA - numB
      }),
    )
    result.set(category, sorted)
  })

  return result
}

/** Render fixture selector HTML */
export function renderFixtureSelector(categories: string[], selectedCategory: string | null): string {
  if (categories.length === 0) return ""

  return `
    <div class="simulator-fixtures">
      <div class="simulator-field">
        <label class="simulator-label">Category</label>
        <select class="simulator-select" id="simulator-fixture-category">
          ${categories.map((cat) => `<option value="${cat}" ${cat === selectedCategory ? "selected" : ""}>${cat}</option>`).join("")}
        </select>
      </div>
      <div class="simulator-field">
        <label class="simulator-label">Puzzle</label>
        <select class="simulator-select" id="simulator-fixture-puzzle"></select>
      </div>
    </div>
  `
}

/** Update puzzle select options based on selected category */
export function updatePuzzleOptions(
  puzzleSelect: HTMLSelectElement,
  fixtures: Map<string, Map<string, any>>,
  category: string,
  selectedPuzzle: string | null,
): string | null {
  const puzzles = fixtures.get(category)
  if (!puzzles) return null

  const puzzleNames = Array.from(puzzles.keys())

  // If stored puzzle exists in this category, use it; otherwise use first
  let actualSelected = selectedPuzzle
  if (!selectedPuzzle || !puzzles.has(selectedPuzzle)) {
    actualSelected = puzzleNames[0] ?? null
  }

  puzzleSelect.innerHTML = puzzleNames
    .map((name) => `<option value="${name}" ${name === actualSelected ? "selected" : ""}>${name}</option>`)
    .join("")

  return actualSelected
}

/** Get puzzle data from fixtures */
export function getFixturePuzzle(fixtures: Map<string, Map<string, any>>, category: string | null, puzzle: string | null): any | null {
  if (!category || !puzzle) return null
  return fixtures.get(category)?.get(puzzle) ?? null
}
