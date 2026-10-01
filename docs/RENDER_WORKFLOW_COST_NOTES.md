# Render Workflow cost notes

The default task plan is `flex`.

Render bills workflow task runs by actual CPU time and sampled RAM usage, and deprovisions compute when a task finishes. This is preferable for an intermittently used scientific lab to an always-on background worker.

For very large runs, benchmark `flex` first. Move a specific task to a larger fixed plan only when wall-clock time matters enough to justify the higher fixed compute allocation.
