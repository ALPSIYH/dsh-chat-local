# Storage, verified views and cold archives

The service owns one state directory. Every service writer must share one `StorageCapacity`; this is a single-service-instance contract, not an interprocess lock. User-controlled external processes can still consume disk space or mutate files, so filesystem failure remains possible and is reported.

## Admission and recovery

`StorageCapacity.run({peakBytes,recovery,claimId,obligations,agentId,agentBytes}, operation)` serializes admission and settlement. It reserves the worst additional file-byte peak **before** starting I/O. The operation itself runs outside the admission queue so a held write in one room cannot deadlock another room's restore. Actual directory file bytes, every outstanding reservation, and future committed-outbox publication costs are included. In-flight bytes may temporarily count both in usage and their outstanding reservation; this is conservative and can reject a write which a later retry admits.

Default soft/hard limits are 1 GiB/2 GiB, with 128 MiB reserved for recovery and 16 MiB free-filesystem margin for ordinary writes. They are configurable `storage` settings. All regular files below the state directory count, including state, audit pending intents, snapshots, backups, persona history, temporary files, compressed sources and receipts. Symbolic-link entries count by their own size and are never traversed by accounting; targets outside this directory have a different owner. Logical file sizes are measured, not filesystem allocated blocks. The filesystem free-space check uses available blocks, but cannot reserve space against unrelated programs.

A room state document and its future audit obligations are admitted together. Its successful rename publishes the obligation reservation. Publication releases that reservation only after the event is acknowledged. Restart restores obligations from the checksummed state outbox. New writes cannot consume the ordinary recovery reserve. Completing previously committed operations and checkpoints may borrow a bounded reserve above already over-quota data; `recoveryDebtBytes` records the resulting overage. This exception is for repairing committed work, not new dispatch. Existing sources remain readable while over quota.

The per-agent default 256 MiB limit charges canonical event bytes carrying `payload.observerAgentId`, aggregated across every source. Shared message events without that ownership field count once globally. Cold compression does not reduce this logical observation charge. Accounting is rebuilt from source files after restart or changed source signatures; known appends update it incrementally. Pending outbox observations also reserve agent budget. This quota is specifically observation ownership; persona Markdown and shared messages are governed by the global quota.

Rejections use `STORAGE_CAPACITY` or `AGENT_STORAGE_CAPACITY`; unknown observation accounting fails closed for new Agent charges, exposing the underlying accounting error code. Unrelated state changes and already committed observation obligations can still be saved under the global byte limit, so a broken audit source does not itself prevent recording recoverable state. Actual I/O errors such as `ENOSPC` remain visible in health. An event append returning `null` is not a durable-success acknowledgement. Failed state publication leaves the old state file authoritative. No quota policy silently deletes evidence.

## Verified append views

`EventLog.readView(roomId,{after})` and `RoomJournal.readEventView(roomId,{after})` return:

```
{ verified: true, revision: { generation, count, head },
  baseRevision: previousRevisionOrNull, appendOnly, events }
```

`events` is the full source for initialization/replacement and only new events when `appendOnly` is true. No changes yields an empty immutable array. Events and the revision are frozen. Full chain verification happens at first use and after external file changes. Own durable appends update the cache and preserve its generation. Each warm request checks inode, size and nanosecond mtime/ctime signatures; replacement, compression state change, eviction or service restart changes the generation. A broken source or unfinished event intent cannot return cached evidence. RoomJournal additionally fences committed unpublished outbox work.

The event cache uses LRU eviction and a default 256 MiB limit measured in source serialized bytes. This is not an exact V8 heap limit: decoded strings, objects and Maps add overhead. `clearCache()` safely drops all derived source caches; the next access verifies/rebuilds them. `health()` reports full reads, incremental view hits, cache source bytes and evictions.

## Lossless cold storage

`EventLog.archive(roomId,{maxBytes=256MiB})` compresses a whole verified source, writes and syncs a unique gzip, checks its decoded bytes, publishes and syncs `<room>.jsonl.cold`, then truncates the hot JSONL to an empty discovery sentinel. The immutable manifest records codec, byte length, content hash, event count and head; its checksum also covers its archive basename. No path traversal is accepted. The existing `.head` remains in force. Readers transparently validate gzip length/hash and event count/head; chain verification remains required before a verified view is issued.

This actually reduces occupied source-file bytes for compressible histories. It is a reversible representation change, not summarization or logical forgetting. A crash before manifest publication leaves the original JSONL authoritative. A crash afterwards leaves the verified gzip authoritative even if the hot duplicate still exists. Reads never repair or delete files.

`thaw(roomId)` verifies the complete chain, manifest event range and head anchor before writing and syncing the hot source, then revalidates the source before removing its cold manifest. Append performs this automatically; its uncompressed temporary peak must pass admission. Restore writes its selected source behind the existing replacement intent, then removes the old cold manifest, preventing archived pre-restore evidence from reappearing. Broken or missing archives fail closed.

Compression is whole-log maintenance, not random-access segmented storage. It temporarily holds raw/compressed/verification buffers, and an append to a cold source incurs full thaw cost. The size cap limits accepted input, not exact peak heap. A too-large archive request returns `archive-size-limit`; it does not silently drop data. `cleanupArchives(roomId)` verifies the current source before removing only unreferenced generated gzip copies left by interrupted maintenance. It never removes the current manifest's archive or current raw evidence. Raw state temporaries are counted and are not automatically deleted by this method.

## Executed regression coverage

`test/storage-capacity.test.js` covers concurrent admission, reserved recovery space, actual error propagation, unchanged state on refusal, per-agent separation/restart/cold accounting and independent-room liveness. `test/event-view.test.js` covers immutable incremental views, restore/external invalidation and pending-outbox refusal. Cold tests cover transparency, corruption, restore, manifest range claims, orphan cleanup, and actual child-process SIGKILL at gzip publication, manifest publication, hot cleanup, thaw raw rename, manifest removal and cold replacement. Existing crash/restore/order tests remain part of the suite. Passing these finite tests is not a hardware-failure or adversarial multiwriter proof.
