# intent: contributor rules

A Claude Code mod: a plugin whose hooks module is `hooks/register.ts`, with a local review page (`page/`) served by `server/serve.py`. Everything is in English: code, comments, test names, docs (`README.fr.md` is the French copy of `README.md`, kept in step).

## Public repo

This repo is public. Nothing in it may point to the author's employer or to the author as a person:

- never the employer's name, its repos, people, internal tools, URLs or deploy details, and never the author's real name, personal email, machine name or home paths;
- this holds everywhere: code, tests, docs, commit messages, branch names, PR titles and descriptions;
- use fake ones instead: `acme/api`, `/Users/me`, "User";
- commits are authored `hn6pot <22932896+hn6pot@users.noreply.github.com>`.

The maintainer's clone has a local `commit-msg` hook (in `.git/hooks`, not committed) that refuses a commit breaking this. PR titles and descriptions are not checked by it: reread them before opening or merging.

## Tests

Before any commit, all must pass:

```bash
claude plugin test .
claude plugin validate .
/usr/bin/python3 -m unittest discover -s tests/server
```
