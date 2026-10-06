# Test reuse: extend before you add

Applies to: JS/TS unit tests (Karma/Jasmine, React Testing Library, Jest), .NET unit/integration tests (xUnit, NUnit), and E2E tests (Cypress, Protractor).

Before planning or writing any new test scenario, search for existing tests that cover the same subject and check whether the new scenario belongs there. A new test that re-creates setup an existing suite already has is duplication: it costs runtime (especially E2E login/navigation), and it drifts when one copy of the setup changes and the other does not.

## When this applies

- **Planning:** before a plan adds a test step, locate the candidate suites.
- **Writing:** before creating a new test, spec file, `describe`, or test class, even without a plan.
- **Reviewing:** flag new tests whose setup duplicates an existing suite for the same subject.

## How to check

Search by the subject under test — class, component, service, controller, page, route, or feature flow — across the test folders (e.g. `tests/`, `tests-new/`, `*.spec.ts`, `*.test.tsx`, `*Tests.cs`, `cypress/e2e/`, Protractor specs). Look at `beforeEach`/constructor/fixture setup, mocks, `cy.intercept`, login/navigation steps, and `WebApplicationFactory` usage.

## Group into the existing test when

- It exercises the same subject under test, **and**
- It needs the same or nearly the same setup (fixtures, mocks, intercepts, login/navigation, test host), **and**
- It differs only in inputs, state, or assertions.

Preferred forms, in order:

1. Add a parameterized case: `[Theory]` + `[InlineData]`/`[MemberData]`, `it.each` / `describe.each`, or a data-driven loop in a Cypress spec.
2. Add an `it` / `[Fact]` inside the existing `describe` / test class so it reuses its setup.
3. For Cypress/Protractor: add steps or assertions to an existing flow that already reaches the needed state, rather than a new spec that logs in and navigates again — as long as the flow still tests one coherent journey.

## A new test/suite is allowed when

- No existing suite covers the subject, or
- Merging would make an existing test assert unrelated behaviors, or
- Sharing setup would require conditional branches in the setup, or
- The existing file is already too large to navigate reasonably.

When a plan creates a new test file, suite, or class, the plan step that adds it must name the candidate(s) checked and give a one-line reason each was rejected. Extending an existing test needs no justification.

## Existing duplication

If you notice two or more existing tests already duplicating setup, suggest extracting it (shared helper, fixture, builder, custom Cypress command, test base class) — but do not refactor existing tests unless asked.
