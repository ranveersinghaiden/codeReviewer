export const cucumberRules = [
    "Feature/Scenario names should describe business behavior, not implementation ('User logs in with valid credentials', not 'Test login').",
    "Prefer declarative steps expressing outcomes over imperative UI-click scripts ('When Bob logs in' not 'When Bob types \"x\" into field \"y\" and clicks \"z\"').",
    "Each scenario should verify a single business rule; split scenarios that test multiple behaviors.",
    "Scenarios must be independent and runnable in isolation/any order; don't rely on state from a prior scenario.",
    "Keep `Background` short and only for steps truly common to all scenarios in the feature.",
    "Use Scenario Outline + Examples for data-driven variations instead of duplicating near-identical scenarios.",
    "Maintain clear Given/When/Then separation; avoid ambiguous or conjunctive steps ('When I do X and Y and then Z').",
    "Reuse existing step definitions rather than creating near-duplicate ones.",
    "Remove obsolete/unused/commented-out scenarios and step definitions.",
];
