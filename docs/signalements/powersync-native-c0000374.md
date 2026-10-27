# Signalement à poster

Dépôt : https://github.com/powersync-ja/powersync-native
Le commandement poste ce texte. Il n'est pas envoyé depuis ici.

---

## Title

STATUS_HEAP_CORRUPTION (0xC0000374) in StreamingSyncIteration::apply_transition during sqlite3_step (powersync_core 0.5.3 and 0.5.4)

## Body

### Summary

A Windows process using the Rust SDK dies with `0xC0000374` (`STATUS_HEAP_CORRUPTION`) while the PowerSync download loop is inside `sqlite3_step`. The faulting thread is a Tokio worker. The UI thread and WebView2 are not on that stack. The heap is the ordinary process heap (an earlier dump of the same crash had `NTGLOBALFLAG` 0 and `APPLICATION_VERIFIER_FLAGS` 0). The failure is detected in `RtlpCoalesceFreeBlocks` during `RtlFreeHeap`, while dropping sync state from `StreamingSyncIteration::apply_transition`. That is the detection site. The instruction that first wrote past a block is not on the stack.

### Versions

| Component | Version | Published |
| --- | --- | --- |
| powersync_core | 0.5.4 (also reproduced on 0.5.3) | 0.5.4 on 2026-10-16, 0.5.3 before that |
| powersync_sqlite_nostd | 0.5.4 (0.5.3 on the earlier dump) | same dates |
| powersync (Rust SDK) | 0.1.1, with the published `=0.5.3` pin overridden to `=0.5.4` | 0.1.1 on 2026-10-12. The published crate still requires `powersync_core = "=0.5.3"`. |
| tauri-plugin-powersync | 0.1.1 | 2026-10-19 |
| OS | Windows 11 x64, version 10.0.26200 (debugger: "Windows 10 Version 26200") | |
| Rustc | 1.x, rustc hash `48a229ceaefd4985c50990b14116b6d856af0985` (from the symbolizer) | debug build |

PR #218 (0.5.4, transitions and error recovery) does not stop the crash. The 0.5.4 stack frees a `BTreeMap<String, BucketProgress>` inside `SyncDownloadProgress`. The 0.5.3 stack freed a `String` inside `OwnedBucketChecksum`. Both go through `apply_transition`, called from `sqlite3_step`.

### Faulting thread (0.5.4, 2026-10-27, process uptime 34 s)

Thread name: `tokio-rt-worker`. Exception `c0000374` (first chance), then `RtlReportCriticalFailure`.

```
ntdll!RtlpCoalesceFreeBlocks
ntdll!RtlpFreeHeap
ntdll!RtlFreeHeap
alloc::alloc::Global::deallocate
BTreeMap<String, BucketProgress>::drop
SyncDownloadProgress::drop
DownloadSyncStatus::applied_checkpoint
StreamingSyncIteration::handle_checkpoint_applied
StreamingSyncIteration::apply_transition
StreamingSyncIteration::handle_event
SyncClient::push_event
powersync_core::sync::interface::register::control
sqlite3VdbeExec
sqlite3_step
powersync_sqlite_nostd::capi::step
ManagedStmt::step
```

The same scenario on powersync_core 0.5.3 (dump of 2026-10-27 17:49, thread `tokio-rt-worker`, uptime 31 s) stopped in `RtlFreeHeap` while dropping `OwnedBucketChecksum` (`String`) from `OwnedCheckpoint` / `TrackedCheckpoint`, again inside `StreamingSyncIteration::apply_transition` ← `handle_line` ← `SyncClient::push_event` ← `register::control` ← `sqlite3_step` ← `powersync::sync::download::download_loop`.

### How often

Same end-to-end scenario (connect mailboxes, including an OAuth mailbox, against a local PowerSync instance, debug build):

- powersync_core 0.5.3: the crash showed up on pass 5 of an official run (passes 1–4 clean) and again on pass 5 of a later capture run (passes 1–4 clean). It did not show on a 50-iteration bench that only repeated the OAuth revocation step.
- powersync_core 0.5.4: the first pass of the same official scenario died at 34 s of process uptime, after the OAuth mailbox reached "connected", during sync. The series was still running when this report was written, so the 0.5.4 rate is "at least the first pass", not a measured percentage.

### Scenario

Desktop app (Tauri) opens one PowerSync database file and calls `connect` on that database only. `SyncCoordinator::connect` joins the previous download task before starting another. The crash happens while that download loop is applying a checkpoint line inside `sqlite3_step` (`SELECT powersync_control(?, ?)`). No second sync client is opened on the same file. The scenario is a lawyer's mailbox screen: password mailboxes plus one OAuth mailbox against a local test instance. The dump contains no mailbox contents; the corrupted freelist on the 0.5.3 dump pointed into a local schema record (table and column names), not into message text.
