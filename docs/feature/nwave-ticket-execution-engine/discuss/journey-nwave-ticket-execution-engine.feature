Feature: nWave Ticket Execution Engine journey
  # Platform: web (OrgOps UI + ticket-scoped channel)
  # Persona: Maria Santos (Senior Product Manager), Devon Park (Support Engineer),
  #          Carlos Mendes (Customer Success Manager) as submitters;
  #          Priya Nair (Engineering Lead) as governance stakeholder.
  # Source: journey-nwave-ticket-execution-engine.yaml (source of truth for shared artifacts)
  # Note: Step 3's invocation mechanism is intentionally unspecified pending a SPIKE
  #       (see wave-decisions.md). Scenarios below describe observable behavior only.

  Scenario: Ticket submission creates a ticket-scoped channel
    Given Maria Santos is signed into OrgOps
    When she submits a ticket titled "Add filter by region to Reports dashboard"
    Then a ticket record is created with a unique ticket id
    And a ticket-scoped channel is created and Maria is subscribed to it

  Scenario: Development ticket is classified and routed toward implementation
    Given Devon Park has submitted ticket TICKET-1042 "Export to CSV button throws 500 error on Safari"
    When the classification step runs
    Then TICKET-1042 is classified as "DEVELOPMENT WORK" with a stated rationale
    And the rationale is posted to the ticket's channel

  Scenario: Non-development ticket is classified away from the engine
    Given Maria Santos has submitted ticket TICKET-1044 "Update Q3 pricing page copy"
    When the classification step runs
    Then TICKET-1044 is classified as "NOT DEVELOPMENT WORK" with a stated rationale
    And Maria is told where this type of ticket should be routed instead
    And no nWave implementation run is triggered for TICKET-1044

  Scenario: Submitter confirms understood intent before implementation starts
    Given TICKET-1043 has been classified as development work
    When the system posts its plain-language restatement of the ticket's intent
    And Maria Santos confirms "Looks right"
    Then an nWave implementation run is triggered for TICKET-1043

  Scenario: Submitter corrects a misunderstood restatement before execution starts
    Given TICKET-1046 "Add Slack notification when invoice payment fails" has been classified as development work
    When the system posts a restatement that omits which Slack channel to notify
    And Carlos Mendes selects "Not quite" and adds the missing detail
    Then implementation does not start until the corrected understanding is confirmed

  @property
  Scenario: Wave status reflects real, current run state
    Given an nWave implementation run is active for TICKET-1043
    When Maria Santos opens the ticket channel at any point during the run
    Then the displayed wave status matches the run's actual current wave
    And "Last activity" reflects a real timestamp from the underlying process/event stream

  Scenario: Raw output remains available for a submitter who wants more detail
    Given Maria Santos is viewing curated wave-by-wave progress for TICKET-1043
    When she selects "View raw output"
    Then she sees the underlying process output stream for the active run

  Scenario: Mid-run note is acknowledged with a concrete pickup point
    Given an nWave implementation run for TICKET-1043 is in the DESIGN wave
    When Maria Santos posts "the region filter should default to the viewer's home region" into the ticket channel
    Then the system acknowledges the message within the same channel
    And the acknowledgment states which wave will incorporate the note

  Scenario: Submitter is warned when a note affects already-completed work
    Given an nWave implementation run for TICKET-1043 has already completed the DESIGN wave
    When Maria Santos posts a note that changes an architectural assumption made in DESIGN
    Then the system tells her this note requires revisiting completed work
    And states the impact before proceeding

  Scenario: Submitter receives a verifiable completion summary
    Given the nWave implementation run for TICKET-1043 has finished successfully
    When the system posts the completion summary to the ticket channel
    Then the summary includes a plain-language description of what changed
    And a link to the branch/PR produced
    And the count of acceptance scenarios passed, traceable to the run's defined scenarios

  Scenario: Failed run still produces a clear, non-blaming summary
    Given the nWave implementation run for TICKET-1042 fails during the DELIVER wave
    When the run terminates
    Then the system posts a failure summary to the ticket channel within 2 minutes
    And the summary explains what was completed, what failed, and a suggested next step
    And Devon Park is never shown a raw stack trace without plain-language context
