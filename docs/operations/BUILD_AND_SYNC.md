# Build and Deterministic Sync

This repository uses SKB's deterministic repository knowledge system.

## How it works

1. Every push to `main` triggers `.github/workflows/repo-knowledge-sync.yml`.
2. The workflow runs this repository's own build and test commands.
3. `tools/repo_knowledge sync --ci` writes `.repo/project.yaml` and `.repo/STATUS.md` and
   commits them back to this same repository.
4. This repository does **not** push anything to SKB and holds no SKB write credential.
   SKB reads `.repo/project.yaml` from this repository itself, on its own schedule
   (`soobujmiah/skb`'s `.github/workflows/registry-pull.yml`) — but only after this
   repository has been explicitly registered as a sync participant (see "Registering with
   SKB" below). Being bootstrapped does not by itself make this repository a participant.

## Key files

- `.repo/project.yaml` — current mechanical state (auto-generated, never hand-edited)
- `.repo/STATUS.md` — human-readable summary (auto-generated)
- `.repo/events/` — append-only event history
- `tools/repo_knowledge/cli.py` — the sync CLI (see `SKB_ROOT/tools/repo_knowledge/README.md`)

## Building locally

```bash
python3 -m tools.repo_knowledge collect --build-status passed --test-status passed
python3 -m tools.repo_knowledge verify
python3 -m tools.repo_knowledge status
```

## Registering with SKB

Bootstrapping this repository only installs local `.repo/` state — it does not register
this repository as an SKB sync participant. That is an explicit, separate step run from
the `soobujmiah/skb` repository (SKB's own registry is the authoritative participation
set; nothing auto-discovers a repository into it):

```bash
# from the soobujmiah/skb repo root
python3 scripts/pull_skb_registry.py register --project-id sobkichu --repository soobujmiah/sobkichu
python3 scripts/pull_skb_registry.py --project-id sobkichu
```
