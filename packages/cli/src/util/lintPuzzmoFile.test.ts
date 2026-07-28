import { describe, expect, it } from "vitest"

import { lintDeedScopeUsage } from "./lintPuzzmoFile.js"

describe(lintDeedScopeUsage.name, () => {
  it("flags a bare deed name in a userAggregateStats expression", () => {
    const warnings = lintDeedScopeUsage({
      completionTable: [{ persistedDeedID: "best-pickups", title: "Largest pickup", formatString: "%@" }],
      userAggregateStats: [
        { stableID: "largest-pickup", valueExp: "prior == null || bestPickups > prior ? bestPickups : prior" },
        { stableID: "total-misses", deedID: "misses" },
        { stableID: "no-miss-completions", filterExp: "misses === 0", valueExp: "(prior || 0) + 1" },
      ],
    })

    expect(warnings).toEqual([
      'userAggregateStats[0].valueExp: "bestPickups" is a deed, so it needs the deeds prefix here — use "deeds.bestPickups". Bare deed names only work in the other sections.',
      'userAggregateStats[2].filterExp: "misses" is a deed, so it needs the deeds prefix here — use "deeds.misses". Bare deed names only work in the other sections.',
    ])
  })

  it("accepts userAggregateStats expressions that use the deeds prefix", () => {
    const warnings = lintDeedScopeUsage({
      completionTable: [{ persistedDeedID: "best-pickups", title: "Largest pickup", formatString: "%@" }],
      userAggregateStats: [
        { stableID: "largest-pickup", valueExp: "prior == null || deeds.bestPickups > prior ? deeds.bestPickups : prior" },
        { stableID: "no-miss-completions", filterExp: "deeds.misses === 0", valueExp: "(prior || 0) + 1" },
        { stableID: "completions", valueExp: "(prior || 0) + 1" },
      ],
    })

    expect(warnings).toEqual([])
  })

  it("flags a deeds prefix in the sections which get a flat scope", () => {
    const warnings = lintDeedScopeUsage({
      puzzleAggregateStats: [{ stableID: "perfects", filterExp: "deeds.excessMoves === 0", valueExp: "prior + 1" }],
      leaderboards: [{ stableID: "g:star", displayName: "Star by", valueExp: "deeds.wordsToStarred" }],
    })

    expect(warnings).toEqual([
      'leaderboards[0].valueExp: deeds are bare identifiers in this section — use "wordsToStarred" rather than "deeds.wordsToStarred".',
      'puzzleAggregateStats[0].filterExp: deeds are bare identifiers in this section — use "excessMoves" rather than "deeds.excessMoves".',
    ])
  })

  it("knows about the platform-supplied points and time deeds", () => {
    const warnings = lintDeedScopeUsage({
      userAggregateStats: [{ stableID: "total-points", valueExp: "(prior || 0) + points" }],
    })

    expect(warnings).toEqual([
      'userAggregateStats[0].valueExp: "points" is a deed, so it needs the deeds prefix here — use "deeds.points". Bare deed names only work in the other sections.',
    ])
  })

  it("leaves scope roots and unknown identifiers alone", () => {
    const warnings = lintDeedScopeUsage({
      userAggregateStats: [{ stableID: "best", valueExp: "prior > uas.site[1] ? prior : uas.site[1]" }],
    })

    expect(warnings).toEqual([])
  })

  it("does not read deed names out of string literals", () => {
    const warnings = lintDeedScopeUsage({
      userAggregateStats: [{ stableID: "tag", deedID: "misses", valueExp: "'misses' + prior" }],
    })

    expect(warnings).toEqual([])
  })
})
