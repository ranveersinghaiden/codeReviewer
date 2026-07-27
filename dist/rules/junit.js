export const junitRules = [
    "Test class names should mirror the class under test (`OrderServiceTest` for `OrderService`).",
    "Test method names should describe scenario and expectation, e.g. `methodUnderTest_condition_expectedResult`, or use @DisplayName for readability.",
    "Prefer one logical assertion focus per test (Arrange/Act/Assert); include failure messages on assertions where it aids debugging.",
    "Tests must be independent and order-independent; use @BeforeEach/@AfterEach for fresh fixtures, no shared mutable static state.",
    "Mock external dependencies (DB, network, filesystem) to keep unit tests fast and deterministic.",
    "Use @ParameterizedTest for testing multiple input/output combinations instead of copy-pasted test methods.",
    "Don't test private methods directly; test observable public behavior.",
    "Cover edge/boundary cases, not just the happy path.",
    "Avoid flaky patterns: no real sleeps/timing races, no reliance on external services or system clock without control.",
];
