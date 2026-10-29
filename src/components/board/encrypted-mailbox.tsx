import { useEffect, useId, useMemo, useState } from "react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker, When } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import {
  DM_ENCRYPTED_NOTICE,
  DM_KEYS_MISSING,
  DM_PASSPHRASE_WARNING,
  DM_SAFETY_HINT,
  MESSAGE_RULE,
} from "@/lib/e2ee/copy";
import {
  browserTransport,
  browserVaultStore,
  loadBrowserVault,
  subscribeMessageCache,
} from "@/lib/e2ee/browser";
import { installDmMediaCrypto } from "@/lib/e2ee/media-bridge";
import { createDmMediaCrypto } from "@/lib/e2ee/media-crypto";
import {
  blockMember,
  confirmSafety,
  createLocalDevice,
  findMember,
  listBlockedMembers,
  listDmPeers,
  listEncryptedThreads,
  listOwnDevices,
  openEncryptedThread,
  publishBackup,
  readEncrypted,
  recordAttendance,
  registerDevice,
  restoreFromBackup,
  revokeOtherDevice,
  sendEncrypted,
  unblockMember,
  type DecodedMessage,
  type OwnDevice,
  type ThreadSummary,
  type VaultState,
} from "@/lib/e2ee/mailbox";
import { DM_RETENTION_DAYS, formatWhen, messageableNames, otherIn } from "@/lib/board/model";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { useBoard } from "@/lib/board/store";
import { useServerSession } from "@/lib/server-session-state";
import { DmReportControl } from "@/components/board/dm-report";
import { DmCall } from "@/components/board/dm-call";
import { ConversationBack, ConversationHeading } from "@/components/board/conversation-top";

/**
 * Signed-in mailbox. Plaintext is sealed in the browser. This view never
 * writes the text into the demo board, and it has no likes, reshares, or scores.
 */
export function EncryptedMailbox() {
  const session = useServerSession();
  const me = session.user;
  const boardName = useBoard((state) => state.me.trim());
  const cards = useBoard((state) => state.cards);
  const posts = useBoard((state) => state.posts);
  const rooms = useBoard((state) => state.rooms);
  const openThread = useBoard((state) => state.openThread);
  const setOpenThread = useBoard((state) => state.setOpenThread);
  const dmFrom = useBoard((state) => state.dmFrom);
  const transport = useMemo(() => browserTransport(), []);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const store = useMemo(() => browserVaultStore(setVault), []);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [active, setActive] = useState<ThreadSummary | null>(null);
  const [messages, setMessages] = useState<DecodedMessage[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [devices, setDevices] = useState<OwnDevice[]>([]);
  const [draft, setDraft] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [again, setAgain] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [notice, setNotice] = useState("");
  const mismatchId = useId();
  const mismatch = again.length > 0 && passphrase !== again;
  const [safety, setSafety] = useState("");
  const [choices, setChoices] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const gateName = boardName || me?.name || "";
  const peers = useMemo(
    () => messageableNames(gateName, cards, posts, rooms),
    [gateName, cards, posts, rooms],
  );
  const [blocked, setBlocked] = useState<{ id: string; name: string }[]>([]);
  const [confirmBlock, setConfirmBlock] = useState(false);

  useEffect(() => {
    if (!me?.id) return;
    let cancelled = false;
    setVault(null);
    setMessages([]);
    setLoaded(false);
    void loadBrowserVault(me.id).then((loadedVault) => {
      if (cancelled) return;
      setVault(loadedVault);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [me?.id]);

  useEffect(() => {
    return subscribeMessageCache(() => {
      setMessages([]);
      setUnreadable(0);
      setVault((current) => {
        if (!current?.opened) return current;
        const next = { ...current };
        delete next.opened;
        return next;
      });
    });
  }, []);

  useEffect(() => {
    if (me) return;
    setVault(null);
    setMessages([]);
    setThreads([]);
    setActive(null);
    setUnreadable(0);
  }, [me]);

  async function refreshDevices(current: VaultState) {
    const listed = await listOwnDevices(transport, current.device.deviceId);
    if (listed.ok) setDevices(listed.devices);
  }

  async function refreshThreads(): Promise<ThreadSummary[]> {
    const listed = await listEncryptedThreads(transport);
    if (!listed.ok) {
      setNotice(listed.message);
      return [];
    }
    setThreads(listed.threads);
    return listed.threads;
  }

  async function restoreReadableHistory(rows: ThreadSummary[]) {
    if (!me) return;
    for (const thread of rows) {
      await readEncrypted(
        transport,
        store,
        thread.id,
        me.id,
        me.name,
        thread.otherName,
        thread.otherUserId,
      );
    }
  }

  useEffect(() => {
    if (!loaded || !me || !vault || vault.userId !== me.id) return;
    let cancelled = false;
    void (async () => {
      const registered = await registerDevice(transport, store);
      if (cancelled) return;
      if (!registered.ok) {
        setNotice(registered.message);
        return;
      }
      await installDmMediaCrypto(createDmMediaCrypto({ transport, vault: store }));
      await refreshDevices(store.read() ?? vault);
      await refreshBlocked();
      const rows = await refreshThreads();
      if (cancelled) return;
      await restoreReadableHistory(rows);
      if (cancelled) return;
      setVault(store.read());
    })();
    return () => {
      cancelled = true;
    };
    // Register once when this account's vault is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, me?.id, vault?.device.deviceId]);

  useEffect(() => {
    if (!me || !vault || vault.userId !== me.id || !openThread) return;
    const other = otherIn(
      { id: openThread, between: openThread.split("\u0000") as [string, string] },
      gateName,
    );
    if (!other || other === gateName) return;
    if (boardName && me.name && boardName !== me.name) {
      setNotice(
        "The name on this board and the name on the account do not match. Set them to the same name under About.",
      );
      return;
    }
    // From a room's member list: the server listed this account. It checks again on open.
    const listed = dmFrom && dmFrom.name === other ? dmFrom.userId : null;
    if (listed) {
      void openPeer(listed);
      return;
    }
    if (!peers.has(other)) {
      setNotice(MESSAGE_RULE);
      return;
    }
    let cancelled = false;
    void (async () => {
      const cardIds = cards
        .filter((card) => card.kind === "meeting" && card.wentBy.includes(gateName))
        .map((card) => card.id);
      const recorded = await recordAttendance(transport, cardIds);
      if (cancelled) return;
      if (!recorded.ok) {
        setNotice(recorded.message);
        return;
      }
      const found = await listDmPeers(transport);
      if (cancelled) return;
      if (!found.ok) {
        setNotice(found.message);
        return;
      }
      let matches = found.peers.filter((peer) => peer.name === other);
      if (matches.length === 0) {
        // Not someone from a meeting: look them up by name. The server decides
        // whether you share a room and may start a conversation.
        const named = await findMember(transport, other);
        if (cancelled) return;
        matches = named.ok ? named.matches : [];
      }
      if (matches.length === 0) {
        setChoices([]);
        setNotice("That person does not have an account yet.");
        return;
      }
      if (matches.length > 1) {
        setChoices(matches);
        setNotice("More than one member has that name. Choose the account.");
        return;
      }
      const match = matches[0];
      if (!match) return;
      await openPeer(match.id);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThread, me?.id, vault?.device.deviceId, gateName]);

  async function refreshBlocked() {
    const listed = await listBlockedMembers(transport);
    if (listed.ok) setBlocked(listed.blocked);
  }

  async function block(thread: ThreadSummary) {
    const done = await blockMember(transport, thread.otherUserId);
    if (!done.ok) {
      setNotice(done.message);
      return;
    }
    setActive(null);
    setMessages([]);
    setNotice(`${thread.otherName} is blocked.`);
    await refreshBlocked();
  }

  async function unblock(userId: string) {
    const done = await unblockMember(transport, userId);
    if (!done.ok) {
      setNotice(done.message);
      return;
    }
    await refreshBlocked();
  }

  async function openPeer(userId: string) {
    setChoices([]);
    const opened = await openEncryptedThread(transport, userId);
    if (!opened.ok) {
      setNotice(opened.message);
      return;
    }
    setNotice("");
    setActive(opened.thread);
    await loadThread(opened.thread);
  }

  async function loadThread(thread: ThreadSummary) {
    if (!me) return;
    const read = await readEncrypted(
      transport,
      store,
      thread.id,
      me.id,
      me.name,
      thread.otherName,
      thread.otherUserId,
    );
    if (!read.ok) {
      setNotice(read.message);
      return;
    }
    setMessages(read.messages);
    setUnreadable(read.unreadable);
    if (read.warnings[0]) setNotice(read.warnings[0]);
    setVault(store.read());
  }

  async function createKeys() {
    if (!me) return;
    setBusy(true);
    setNotice("");
    const created = await createLocalDevice(me.id);
    store.write(created);
    setVault(created);
    const registered = await registerDevice(transport, store);
    setBusy(false);
    if (!registered.ok) setNotice(registered.message);
  }

  async function restore() {
    if (!me) return;
    setBusy(true);
    setNotice("");
    const restored = await restoreFromBackup(transport, me.id, passphrase);
    setBusy(false);
    if (!restored.ok) {
      setNotice(restored.message);
      return;
    }
    store.write(restored.vault);
    setVault(restored.vault);
    setPassphrase("");
    const registered = await registerDevice(transport, store);
    if (!registered.ok) setNotice(registered.message);
  }

  async function saveBackup() {
    if (passphrase !== again) {
      setNotice("Type the passphrase the same way twice.");
      return;
    }
    setBusy(true);
    setNotice("");
    const saved = await publishBackup(transport, store, passphrase);
    setBusy(false);
    setPassphrase("");
    setAgain("");
    if (!saved.ok) setNotice(saved.message);
    else setVault(store.read());
  }

  async function send() {
    if (!active) return;
    setBusy(true);
    setNotice("");
    const sent = await sendEncrypted(transport, store, active.id, active.otherUserId, draft);
    setBusy(false);
    if (!sent.ok) {
      setNotice(sent.message);
      if (sent.safety) setSafety(sent.safety);
      return;
    }
    setDraft("");
    setSafety("");
    if (sent.warning) setNotice(sent.warning);
    await loadThread(active);
  }

  if (!me) return null;
  if (!loaded) return <p className="text-sm text-muted">Preparing encryption.</p>;

  const vaultForAccount = vault && vault.userId === me.id ? vault : null;

  if (!vaultForAccount) {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <Kicker>Messages</Kicker>
        <h1 className="font-display text-4xl text-fg">Keys stay on this device</h1>
        <p className="text-base text-muted">{DM_KEYS_MISSING}</p>
        <p className="text-sm text-muted">{DM_PASSPHRASE_WARNING}</p>
        {vault && vault.userId !== me.id ? (
          <p className="text-sm text-muted">
            This browser has keys for another account. Create keys for {me.name}, or restore that
            account's backup.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Create keys here, or restore a backup with the passphrase you chose on another device.
          </p>
        )}
        <button
          type="button"
          className={btnSignal}
          disabled={busy}
          aria-busy={busy}
          onClick={() => void createKeys()}
        >
          {busy ? "Saving…" : "Create keys on this device"}
        </button>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void restore();
          }}
        >
          <label className="flex flex-col gap-2 text-sm text-muted">
            Backup passphrase
            <input
              className={fieldClass}
              type={showPassphrase ? "text" : "password"}
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={btnQuiet}
            aria-pressed={showPassphrase}
            onClick={() => setShowPassphrase((current) => !current)}
          >
            {showPassphrase ? "Hide passphrase" : "Show passphrase"}
          </button>
          <button type="submit" className={btnGhost} disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : "Restore a backup"}
          </button>
        </form>
        {notice ? <p className="text-sm text-muted">{notice}</p> : null}
      </div>
    );
  }

  if (active) {
    return (
      <div className="flex flex-col gap-4 lg:max-w-3xl">
        <ConversationBack
          onAllMessages={() => {
            setActive(null);
            setOpenThread(null);
            setSafety("");
            void refreshThreads();
          }}
        />
        <ConversationHeading name={active.otherName} className="font-display text-3xl text-fg" />
        <p className="text-sm text-muted">
          Account {active.otherUserId.slice(0, 8)}. Encrypted on this device, deleted after{" "}
          {DM_RETENTION_DAYS} days.
        </p>
        <DmCall threadId={active.id} otherName={active.otherName} />
        <button
          type="button"
          className={cn(btnQuiet, "self-start px-0")}
          onClick={() => setConfirmBlock(true)}
        >
          Block {active.otherName}
        </button>
        <ConfirmDialog
          open={confirmBlock}
          title={`Block ${active.otherName}?`}
          description={`${active.otherName} will not be able to message or call you, and you will not be able to message them. They are not told. You can unblock them from Messages.`}
          confirmLabel="Block"
          cancelLabel="Not now"
          onConfirm={() => {
            setConfirmBlock(false);
            void block(active);
          }}
          onCancel={() => setConfirmBlock(false)}
        />
        {safety ? (
          <div className="rounded-md border border-line bg-surface px-3 py-3">
            <p className="text-sm font-semibold text-fg">Safety number</p>
            <p className="mt-1 font-mono text-base text-fg">{safety}</p>
            <p className="mt-1 text-sm text-muted">{DM_SAFETY_HINT}</p>
            <button
              type="button"
              className={cn(btnSignal, "mt-3")}
              onClick={() => {
                confirmSafety(store, active.otherUserId, safety);
                setVault(store.read());
                setNotice("When you send, this device will use that number.");
              }}
            >
              The numbers match
            </button>
          </div>
        ) : null}
        <ul className="flex flex-col gap-2">
          {messages.length === 0 ? <li className="text-sm text-muted">Nothing yet.</li> : null}
          {messages.map((message) => (
            <li
              key={message.id}
              className={cn(
                "max-w-xl rounded-md border border-line px-3 py-2",
                message.from === me.name ? "self-end bg-raised" : "self-start bg-surface",
              )}
            >
              <p className="text-base text-fg">{message.text}</p>
              <p className="mt-1 text-[0.8125rem] text-muted">
                {message.from} · <When at={message.at} format={formatWhen} />
              </p>
              {message.from !== me.name ? <DmReportControl messageId={message.id} text={message.text} /> : null}
            </li>
          ))}
        </ul>
        {unreadable > 0 ? (
          <p className="text-sm text-muted">
            Some messages could not be read on this device. Restore the key backup if this is a new
            browser.
          </p>
        ) : null}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <input
            className={fieldClass}
            value={draft}
            placeholder={`To ${active.otherName}`}
            aria-label={`Message to ${active.otherName}`}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className={btnSignal} disabled={busy} aria-busy={busy}>
            {busy ? "Sending…" : "Send"}
          </button>
        </form>
        {notice ? <p className="text-sm text-muted">{notice}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <Kicker>Messages</Kicker>
        <h1 className="max-w-xl font-display text-4xl text-balance text-fg lg:text-5xl">
          Messages
        </h1>
        <p className="max-w-prose text-base text-muted">{DM_ENCRYPTED_NOTICE}</p>
      </section>
      {threads.length === 0 ? (
        <p className="text-sm text-muted">
          No messages yet. Open one from someone in one of your rooms, or someone you have been to a
          meeting with.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 lg:max-w-2xl">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                aria-label={`Conversation with ${thread.otherName}`}
                className="flex min-h-[44px] w-full flex-col items-start gap-1 rounded-md border border-line bg-surface px-3 py-3 text-left"
                onClick={() => {
                  setActive(thread);
                  setNotice("");
                  void loadThread(thread);
                }}
              >
                <span className="text-base font-semibold text-fg">
                  {thread.otherName} · {thread.otherUserId.slice(0, 8)}
                </span>
                <span className="text-sm text-muted">Open to read. Nothing is previewed here.</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {blocked.length > 0 ? (
        <section className="flex max-w-xl flex-col gap-2">
          <h2 className="text-lg text-fg">Blocked</h2>
          <ul className="flex flex-col gap-2">
            {blocked.map((person) => (
              <li
                key={person.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
              >
                <span className="text-sm text-fg">
                  {person.name} · {person.id.slice(0, 8)}
                </span>
                <button
                  type="button"
                  className={btnQuiet}
                  onClick={() => void unblock(person.id)}
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex max-w-xl flex-col gap-3 rounded-md border border-line bg-surface px-3 py-3">
        <h2 className="text-lg text-fg">Key backup</h2>
        {vaultForAccount.backup ? (
          <p className="text-sm text-muted">
            A backup is on the server, encrypted with your passphrase. The server does not have the
            passphrase. A new device can restore it.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Without a backup, a new device cannot read messages already sent. Choose a passphrase.
            It never leaves this device.
          </p>
        )}
        <p className="text-sm text-muted">{DM_PASSPHRASE_WARNING}</p>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveBackup();
          }}
        >
          <label className="flex flex-col gap-2 text-sm text-muted">
            {vaultForAccount.backup ? "New passphrase" : "Passphrase"}
            <input
              className={fieldClass}
              type={showPassphrase ? "text" : "password"}
              autoComplete="new-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            Type it again
            <input
              className={fieldClass}
              type={showPassphrase ? "text" : "password"}
              autoComplete="new-password"
              value={again}
              aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? mismatchId : undefined}
              onChange={(event) => setAgain(event.target.value)}
            />
          </label>
          {mismatch ? (
            <p id={mismatchId} role="alert" className="text-sm text-[#f0b4a4]">
              Type the passphrase the same way twice.
            </p>
          ) : null}
          <button
            type="button"
            className={btnQuiet}
            aria-pressed={showPassphrase}
            onClick={() => setShowPassphrase((current) => !current)}
          >
            {showPassphrase ? "Hide passphrase" : "Show passphrase"}
          </button>
          <button type="submit" className={btnGhost} disabled={busy} aria-busy={busy}>
            {busy
              ? "Saving…"
              : vaultForAccount.backup
                ? "Change the passphrase"
                : "Save a key backup"}
          </button>
        </form>
      </section>

      <section className="flex max-w-xl flex-col gap-2">
        <h2 className="text-lg text-fg">Devices</h2>
        <ul className="flex flex-col gap-2">
          {devices.map((device) => (
            <li
              key={device.id}
              className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
            >
              <span className="text-sm text-fg">
                {device.label} · {device.id.slice(0, 4)}
                {device.current ? " · this device" : ""}
              </span>
              {device.current ? null : (
                <button
                  type="button"
                  className={btnQuiet}
                  onClick={() => {
                    void (async () => {
                      const revoked = await revokeOtherDevice(transport, device.id);
                      if (!revoked.ok) setNotice(revoked.message);
                      else if (vault) await refreshDevices(vault);
                    })();
                  }}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {choices.length > 1 ? (
        <ul className="flex max-w-xl flex-col gap-2">
          {choices.map((peer) => (
            <li key={peer.id}>
              <button
                type="button"
                aria-label={`Conversation with ${peer.name}`}
                className="flex min-h-[44px] w-full flex-col items-start gap-1 rounded-md border border-line bg-surface px-3 py-3 text-left"
                onClick={() => void openPeer(peer.id)}
              >
                <span className="text-base font-semibold text-fg">{peer.name}</span>
                <span className="text-sm text-muted">Account {peer.id.slice(0, 8)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? <p className="text-sm text-muted">{notice}</p> : null}
    </div>
  );
}
