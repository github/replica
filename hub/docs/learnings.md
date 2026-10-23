# Learnings

Learnings turns feedback that keeps coming up in prototype reviews into guidance agents follow. Hub reads a repository's review comments, asks Copilot which points recur, and suggests learnings. A repository administrator accepts, edits, or rejects each suggestion. Agents that build prototypes in that repository get the accepted ones.

```text
Reviewers comment on prototypes
  -> Hub asks Copilot to label new comments, once a day
  -> Hub suggests a learning that two reviewers raised on two prototypes
  -> A repository administrator accepts, edits, or rejects it
  -> Agents get the accepted learnings with their task
```

Learnings is off until a Hub administrator [connects Copilot](copilot.md), after the person who runs Hub gives Hub a token or turns on organization billing. Connecting turns it on for every repository on the Hub.

## Who can do what

| Person | Can |
| --- | --- |
| Hub administrator | Connect or disconnect Copilot, which turns Learnings on or off for the whole Hub |
| Repository administrator | See suggestions and the comments behind them, accept, edit, reject, and retire learnings, start a run, and see runs and their Copilot usage |
| Anyone else | Nothing. The **Learnings** page and its sidebar link stay hidden |

## How Hub finds learnings

Once a day, Hub queues a run for each repository whose review comments changed since its last successful run, or whose last run left comments to label or suggestions to make. The repository that ran least recently goes first. A repository administrator can also choose **Find learnings now**, which goes ahead of the daily runs still waiting, after any runs other people asked for earlier. While the repository's own daily run waits, choosing it moves that run ahead. Runs happen one at a time, and a waiting run keeps its place until its turn comes.

A run:

1. Imports the repository's review comments into its learning store. The store keeps each version of a comment once, so importing the same comments again adds nothing.
2. Asks Copilot to label each new or edited comment from the last 90 days with a design theme, when one fits. Once Hub records a comment version's labeling result, it does not ask about that version again, even if Copilot gave no label. A request or storage failure can leave comments pending for a later run. Copilot also sees the other comments in each thread as context. It gets each comment's text and where on the prototype it points, never who wrote it, and has no tools. A run labels for up to 30 minutes and leaves the remaining comments for the next run.
3. Consolidates the labels on comments from the last 90 days. A theme becomes a suggestion when at least two reviewers raised it, in two threads, on two prototypes. Questions, preferences, and praise do not count. A run makes at most 10 new suggestions and leaves the rest for the next run, so people review a few at a time.

Copilot never decides what agents get. A repository administrator does.

Hub lets each labeling command make at most one request to the configured labeler, keeping its normal comment limit and thread grouping. It rechecks repository and App installation state before starting the next command. If access ends during a request, that request may finish, but the run sends no later request and keeps the usage already reported.

When someone deletes a comment in Hub, a background job removes the text of every version of it, and Copilot's labels on them, from the learning store. The job never asks Copilot and adds nothing else to the store, so it also runs while Learnings is off, and a repository without a store does not get one. The store records the person who deleted the comment as the one who removed its text. If a run is in progress, the job waits for it to finish. The deletion also records that the removal is due, so if the text is still there three hours after the deletion or after the job last tried, because the queue refused the job or it stopped trying, Hub queues the removal again, also while Learnings is off. Until someone deletes a comment, the store keeps the earlier versions of an edited comment as review evidence.

## Decide on suggestions

Each suggestion shows its wording and the exact stored comment versions behind it. It also shows how many reviewers raised it on how many prototypes when the configured consolidator supplies those counts. Opposing comments appear separately, including a count of any Hub cannot show. Later edits in Hub do not replace the evidence you review.

A suggestion that replaces accepted guidance lists each affected learning's ID and its permitted wording beside the decision controls. If the store cannot provide a target's wording for review, Hub shows that explicitly without dropping its ID.

- **Accept** gives the learning to agents as written.
- **Edit and accept** gives agents your wording instead.
- **Reject** needs a reason. Hub suggests the same theme again only if more reviewers raise it.
- **Retire** ends an accepted learning that no longer applies, and also needs a reason.

A decision applies to the suggestion as you saw it. If a run changed the suggestion after you loaded the page, Hub refuses the decision so you can review the new version.

**What an agent gets** previews the default recall within its count and text limits. Each accepted learning says whether that preview includes it, leaves it out for space, or cannot use it. An agent's task can change the order and which learnings fit. The security audit records each run request and decision for the repository.

## How agents get learnings

When a person works with Copilot in a repository that has a Hub connection, the [Replica prototype plugin](prototype-canvas.md#learnings-for-agents) adds the accepted learnings to their prompts. It never sends the prompt to Hub, so agents get the learnings that **What an agent gets** shows, whatever the prompt. Its first successful answer replaces earlier guidance, including after a plugin restart or session resume; later unchanged answers add nothing. When the accepted learnings change, for example when an administrator edits or retires one, the next prompt in that session gets the whole new list, which replaces the earlier one, or a note that no team learnings apply anymore. A session also gets that note when a Hub administrator turns Learnings off. The text tells the agent that each learning is guidance from the team and data, not a command, and that it never overrides the person's request or the repository's instructions. The learning store records each recall as a use by that person. Only connections approved on a page that mentions learnings get them, so a person who connected earlier connects to Hub again to get them. In Copilot CLI 1.0.96, the plugin runs only with experimental features on: start Copilot CLI with `--experimental`, or run `/experimental on`.

## Usage

Copilot bills the usage as the person who runs Hub chose: the Copilot plan of the owner of the token in `REPLICA_COPILOT_TOKEN`, or, with [organization billing](copilot.md#bill-your-organization), the organization that installed Hub's GitHub App. Labeling is the only step that uses Copilot. A run with no new, edited, or still-unprocessed comments makes no model requests. A request also sends the other comments in each thread it asks about, as context. Hub lets Copilot choose the model unless the store's configuration names one.

A run records the requests and AI credits Copilot reported after each request, using the learning command's [whole-unit usage counters](../../packages/learning/README.md#label-with-copilot). A failed request or storage operation can still report known usage; Hub records it before showing the failure. Usage the service did not report is unknown, not estimated. Retrying comments whose result was not recorded can incur another charge. If the store also cannot confirm which comments remain pending, the failure says so. The **Learnings** page shows a repository's runs and its usage over the last 30 days, and the [Copilot](copilot.md) page shows the Hub's total.

Usage ranges follow when a run started, not when someone queued it, so a long wait does not hide recent Copilot use.

## Recovery

| What you see | What to do |
| --- | --- |
| Copilot refused the token or Hub's App | The person who runs Hub replaces `REPLICA_COPILOT_TOKEN` and restarts Hub, or, with organization billing, fixes the App's Copilot requests permission or the organization's settings. A Hub administrator can check again on the **Copilot** page. Decisions and accepted learnings keep working meanwhile |
| A failed run | Its result says what went wrong. Hub tries again the next day if comments changed, or choose **Find learnings now** |
| The learning execution lock stays busy | After 121 lock attempts, about an hour of retries plus queue delays, the job fails visibly in Solid Queue. A waiting run also shows a failed result. An operator must check for a stuck writer before retrying; see [Operations](#operations) |
| Consent to use review comments ended | An operator must explicitly renew the required purposes with `replica-learning grants add`. A run never replaces a withdrawn or expired grant automatically; see the [learning package's consent commands](../../packages/learning/README.md#run-it-yourself) |
| Hub could not read this repository's learnings | Run `replica-learning verify` against the repository's store, as described in [Operations](#operations) |
| Removing a deleted comment's text from the learning store keeps failing | Store errors retry for about four hours; lock contention has its separate bound above. After attempts stop, the durable pending marker lets recovery queue the removal again, also while Learnings is off. To remove the text sooner, retry the failed job in Solid Queue, or run `replica-learning redact --comment` against the repository's store, as described in [Operations](#operations). While Learnings is on, the next run also removes the text of deleted comments |

Disconnecting Copilot turns Learnings off but keeps every learning and decision, so connecting again restores them.

The review and instruction purposes may come from separate active grants. Explicitly renewing only a withdrawn purpose is enough when the other required purpose is still permitted. Hub never records that renewal automatically.

Hub identifies GitHub reviewers by immutable account IDs, not their current logins. Local development uses explicitly local user IDs. When an older store needs identity revalidation, Hub keeps its records and approvals but does not give affected versions to agents or offer stale suggestions for acceptance. Choose **Find learnings now**, then review any rebuilt suggestions. The notice can also appear when there are no current comments; an empty capture still records the stricter identity policy without adding old comments or widening consent. The [learning package](../../packages/learning/README.md) describes the append-only correction and retained history.

## Local development

[Local development](local-development.md) has no Copilot connection and ignores `REPLICA_COPILOT_TOKEN` and `REPLICA_COPILOT_BILLING`. Learnings is on for every local repository and asks Copilot as whoever is signed in to the GitHub CLI or Copilot CLI where Hub runs. In the dev container, sign in with `bin/devcontainer exec gh auth login`. Hub looks for learnings only when you choose **Find learnings now**. A theme needs one reviewer instead of two, because local development signs everyone in as one identity.

## Operations

Each repository's learning data is a store in its own directory under `REPLICA_LEARNING_ROOT`, which defaults to `storage/learning`. The store keeps its data in one SQLite file unless its `config.json` names another provider. Back it up with Hub's other data, as [Backups and restore](backups-and-restore.md) describes. Hub keeps the record of each finished run for 90 days after it ends, regardless of how long it waited.

The learning root must be a dedicated directory outside the public web root, without symbolic links in its path. Hub refuses filesystem, application, shared `storage`, and public roots at startup. Before accessing a repository's store, it also checks every component of that store's path, including `repositories` and the repository directory. This check also applies when Builds use Azure storage; learning files must not become public through Rails.

Within the supported single-container deployment, learning runs and comment removals share an operating-system lock on the private learning root for their whole execution. A waiting job retries without claiming a run or reading its snapshot. The SDK writer inherits the lock, so stopping a Ruby worker or expiring Solid Queue's queue semaphore cannot let another mutation overlap a surviving writer. Keep the learning root on persistent local storage and do not replace its directory while workers are active.

Lock contention stops after 121 attempts. Both jobs then remain as failed executions in Solid Queue, and a waiting run records `execution_lock_busy`. Comment removal remains pending in Hub's database; recovery can queue another attempt after its due time, three hours after the last attempt. A lock timeout never forces the lock open or starts another writer.

For a stuck lock, pause new learning work and inspect the processes with the private learning-root directory open. Inside the Hub container, `lslocks` lists active locks and `fuser -v <absolute-learning-root>` can help identify processes when those diagnostic tools are installed. Inspect each PID, command and parent relationship before acting: a Copilot or Node writer can survive its Ruby worker. Do not use `fuser -k`, kill processes by name, delete a lock path, rename the learning root, or clear a pending-removal marker to bypass the lock.

Stop only a positively identified stuck writer by PID, then confirm it and any learning or SDK child processes have exited. For the default single-container deployment, a full `./replica down` without `-v` and confirmation that the old container and all its children have stopped is a safer alternative when process ownership is unclear; the named data volume is retained. Start Hub again, then retry a failed removal or request a new learning run. Retrying an old failed run job does not restart the failed run record.

Hub names each store's scope `<GitHub host>/repositories/<GitHub repository ID>`, so renaming or transferring the repository keeps its learnings. To inspect a store on the Hub host:

```sh
node /opt/replica/learning/bin/replica-learning.mjs verify \
  --dir storage/learning/repositories/<Hub repository ID> \
  --repository github.com/repositories/<GitHub repository ID>
```

To remove a deleted comment's text yourself, first prevent new learning jobs from starting on every Hub worker and wait for any running import, labeling, or redaction to finish, including SDK processes left by a stopped worker. The direct command does not take Hub's execution lock: overlapping work can leave deleted text in the store without a verification warning. Then run `redact` with the same `--dir` and `--repository`, the comment's Hub ID, and your GitHub login. Running it again changes nothing.

```sh
node /opt/replica/learning/bin/replica-learning.mjs redact --comment <Hub comment ID> --by github:<login> \
  --dir storage/learning/repositories/<Hub repository ID> \
  --repository github.com/repositories/<GitHub repository ID>
```

Resume the workers only after the command finishes. Retrying the queued removal below is preferable when workers should stay active, because the job takes Hub's shared learning lock.

To retry removals that Hub gave up on instead:

```sh
bin/rails runner 'SolidQueue::Job.failed.where(class_name: "ReviewComment::RemoveFromLearningStoreJob").each(&:retry)'
```

Hub writes a `config.json` into each store the first time it runs and never changes an existing one. Edit it to change which signals count, how many reviewers a suggestion needs, which model labels comments, or which provider keeps the data. Hub treats a directory with this file as the repository's store, whichever provider it names. [`packages/learning`](../../packages/learning/) documents the options, including a labeler, consolidator, or provider module of your own.
