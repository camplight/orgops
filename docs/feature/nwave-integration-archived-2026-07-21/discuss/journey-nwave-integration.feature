Feature: nWave Integration -- SSOT Bootstrap Journey
  As Priya Raman, OrgOps engineering lead
  I want the shipped OrgOps architecture formalized into nWave's SSOT doc model
  So that future feature work can flow through DISCUSS/DESIGN/DISTILL/DELIVER waves
  grounded in real architecture instead of re-deriving it from scratch each time

  # Step 1: Recognize the SSOT Gap
  Scenario: Migration gate correctly identifies a greenfield SSOT bootstrap
    Given docs/product/ does not exist
    And docs/feature/ has no prior feature directories
    When Priya runs /nw-design for the first OrgOps feature under nWave
    Then the gate proceeds with SSOT bootstrap instead of halting for migration
    And shared artifact "${ssot_exists}" is documented as false at this step

  # Step 2: Inventory Existing Architecture Knowledge
  Scenario: Existing documentation is fully triaged before formalization begins
    Given docs/SPEC.md and docs/use-cases.md are the only existing architecture sources
    When Priya inventories them section by section
    Then every section is assigned to brief.md narrative, an ADR candidate, or "link, don't duplicate"
    And no section is left unclassified

  # Step 3: Formalize Architecture SSOT Brief
  Scenario: DESIGN wave finds canonical architecture context without re-deriving it from source
    Given docs/SPEC.md documents the current OrgOps implementation
    And no docs/product/architecture/brief.md exists yet
    When solution-architect formalizes docs/product/architecture/brief.md for this feature
    Then brief.md documents the stack, monorepo layout, and core data model
    And brief.md links to docs/SPEC.md for implementation-level detail instead of copying it

  Scenario: Brief stays a thin index, not a duplicate of SPEC.md
    Given docs/SPEC.md documents 39 environment variables and the full HTTP API surface
    When brief.md is authored
    Then brief.md summarizes architecture decisions and links to docs/SPEC.md for the exhaustive list
    And updating an environment variable in SPEC.md does not require a brief.md edit

  # Step 4: Capture Undocumented Decisions as ADRs
  Scenario: Undocumented mode-of-execution decision becomes a discoverable ADR
    Given docs/SPEC.md describes CLASSIC, RLM_REPL, and WRAPPED agent modes without explaining why WRAPPED exists
    When the architectural decision behind WRAPPED mode is captured
    Then docs/product/architecture/adr-001-wrapped-agent-mode.md documents the context, decision, and consequences
    And a future contributor adding a fourth agent mode can read the ADR instead of asking in chat

  # Step 5: Define Wave-Routing Rules for Future Features
  Scenario: Future OrgOps features skip an unnecessary DISCOVER pass
    Given OrgOps is a working, shipped system with 5 documented use cases in docs/use-cases.md
    And this feature has recorded the DISCOVER-skip rule in wave-decisions.md
    When a contributor starts the next real OrgOps feature
    Then they consult wave-decisions.md and start at DISCUSS or DESIGN, not DISCOVER
    And the rationale (product-market fit already established) is visible to them without re-deriving it

  # Step 6: Validate SSOT Readiness with a Dry Run
  Scenario: Next feature's DESIGN wave passes its reading-enforcement gate on the first try
    Given docs/product/architecture/brief.md and adr-*.md were created by this feature
    When solution-architect runs the DESIGN wave for the next real OrgOps feature
    Then the reading-enforcement checklist shows all files as read with zero missing-file markers
    And solution-architect extends brief.md under a new section instead of recreating system context

  # Error / friction paths
  Scenario: Duplication drift between brief.md and SPEC.md is caught before it causes divergence
    Given brief.md was authored by summarizing and linking to docs/SPEC.md
    When a reviewer compares brief.md's environment variable list against docs/SPEC.md's exhaustive list
    Then brief.md contains no verbatim-copied environment variable table
    And any OrgOps-specific implementation detail needed for a task stays only in docs/SPEC.md

  Scenario: A real architectural decision is not silently omitted from the ADR set
    Given docs/SPEC.md contains statements that read as decisions ("X instead of Y because Z")
    When the ADR capture step reviews docs/SPEC.md for decision-shaped language
    Then each decision-shaped statement either has a corresponding ADR or an explicit red-card note recording why it was deferred
    And no decision-shaped statement is left unaddressed without a record
