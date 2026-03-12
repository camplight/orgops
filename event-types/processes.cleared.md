---
type: processes.cleared
---

System event emitted after clearing tracked processes and their output records.

Payload:

- `scope` (`all` or `exited`, indicates which records were targeted)
- `terminatedCount` (number of running/starting OS processes signaled)
- `clearedCount` (number of process records removed)
