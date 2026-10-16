# CommandFlow Gemini evaluation preflight

Generated: 2026-10-16T06:20:03.753Z

This report is offline-only. No Gemini request, MCP execution, database access, approval, or MFA operation was performed.

| Check | Status | Detail |
|---|---|---|
| dataset_has_63_cases | PASS | 63 cases |
| dataset_case_ids_unique | PASS | IDs are unique |
| dataset_case_structure | PASS | required fields present |
| isolated_import_graph | PASS | no MCP/database/security imports |
| tool_dispatch_absent | PASS | no dispatch calls |
| function_calling_absent | PASS | no callable tool declarations |
| api_key_not_printed | PASS | key is never printed |
| no_automatic_retries | PASS | one attempt per case |
| output_directory_ignored | PASS | C:\Users\Nisarg\Documents\MAJOR PROJECT FINAL\Commander main\evaluation-results |
| configured_model | PASS | gemini-3.6-flash |
| api_key_presence | BLOCKED | missing (value withheld) |
| request_count_policy | PASS | one recorded attempt per case by default |

Dataset expected-tool label coverage observed in this audit: 34. Full registered-tool coverage remains validated by the existing evaluator command.
