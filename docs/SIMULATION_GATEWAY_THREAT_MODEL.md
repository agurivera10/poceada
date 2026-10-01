# Simulation Gateway threat model

Primary risks addressed:

- browser exposure of privileged database credentials;
- compromised compute host gaining broad database access;
- duplicated remote dispatch executing one scientific job twice;
- untrusted visitor launching costly jobs;
- silent result mutation without traceability.

Controls:

- publishable key only in browser;
- HttpOnly admin session before job mutation;
- APP/WORKER tokens with distinct scopes;
- only token hashes stored in Postgres;
- exact atomic job claim;
- idempotent Render dispatch;
- frozen seeds/Git SHA/config and result hashes;
- RLS plus explicit grants;
- immutable prospective experiment layer remains separate from exploratory compute.
