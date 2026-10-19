import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { btnGhost, btnQuiet, btnSignal, fieldClass, Kicker, When } from "@/components/quorum/bits";
import { cn } from "@/lib/cn";
import { DM_ENCRYPTED_NOTICE, DM_SAFETY_HINT } from "@/lib/e2ee/copy";
import { browserTransport, browserVaultStore, readBrowserVault } from "@/lib/e2ee/browser";
import { installDmMediaCrypto } from "@/lib/e2ee/media-bridge";
import { createDmMediaCrypto } from "@/lib/e2ee/media-crypto";
import {
  confirmSafety,
  createLocalDevice,
  findMember,
  listEncryptedThreads,
  listOwnDevices,
  openEncryptedThread,
  publishBackup,
  readEncrypted,
  registerDevice,
  restoreFromBackup,
  revokeOtherDevice,
  sendEncrypted,
  type DecodedMessage,
  type OwnDevice,
  type ThreadSummary,
  type VaultState,
} from "@/lib/e2ee/mailbox";
import { DM_RETENTION_DAYS, formatWhen, otherIn, stoodWith } from "@/lib/board/model";
import { useBoard } from "@/lib/board/store";
import { useServerSession } from "@/lib/server-session-state";

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
  const openThread = useBoard((state) => state.openThread);
  const setOpenThread = useBoard((state) => state.setOpenThread);
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
  const [notice, setNotice] = useState("");
  const [safety, setSafety] = useState("");
  const [busy, setBusy] = useState(false);

  const gateName = boardName || me?.name || "";
  const peers = useMemo(() => stoodWith(gateName, cards, posts), [gateName, cards, posts]);

  useEffect(() => {
    setVault(readBrowserVault());
    setLoaded(true);
  }, []);

  async function refreshDevices(current: VaultState) {
    const listed = await listOwnDevices(transport, current.device.deviceId);
    if (listed.ok) setDevices(listed.devices);
  }

  async function refreshThreads() {
    const listed = await listEncryptedThreads(transport);
    if (listed.ok) setThreads(listed.threads);
    else setNotice(listed.message);
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
      await refreshThreads();
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
    if (!peers.has(other)) {
      setNotice("You can message someone you have been to a meeting with.");
      return;
    }
    let cancelled = false;
    void (async () => {
      const found = await findMember(transport, other);
      if (cancelled) return;
      if (!found.ok) {
        setNotice(found.message);
        return;
      }
      if (found.matches.length !== 1) {
        setNotice(
          found.matches.length === 0
            ? "That person does not have an account yet."
            : "More than one member has that name.",
        );
        return;
      }
      const opened = await openEncryptedThread(transport, found.matches[0].id);
      if (cancelled) return;
      if (!opened.ok) {
        setNotice(opened.message);
        return;
      }
      setNotice("");
      setActive(opened.thread);
      await loadThread(opened.thread);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThread, me?.id, vault?.device.deviceId, gateName]);

  async function loadThread(thread: ThreadSummary) {
    if (!me) return;
    const read = await readEncrypted(transport, store, thread.id, me.id, me.name, thread.otherName);
    if (!read.ok) {
      setNotice(read.message);
      return;
    }
    setMessages(read.messages);
    setUnreadable(read.unreadable);
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
        <p className="text-base text-muted">{DM_ENCRYPTED_NOTICE}</p>
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
          onClick={() => void createKeys()}
        >
          Create keys on this device
        </button>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void restore();
          }}
        >
          <input
            className={fieldClass}
            type="password"
            autoComplete="current-password"
            value={passphrase}
            placeholder="Backup passphrase"
            aria-label="Backup passphrase"
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <button type="submit" className={btnGhost} disabled={busy}>
            Restore a backup
          </button>
        </form>
        {notice ? <p className="text-sm text-muted">{notice}</p> : null}
      </div>
    );
  }

  if (active) {
    return (
      <div className="flex flex-col gap-4 lg:max-w-3xl">
        <button
          type="button"
          className={cn(btnQuiet, "self-start px-0")}
          onClick={() => {
            setActive(null);
            setOpenThread(null);
            setSafety("");
            void refreshThreads();
          }}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          All messages
        </button>
        <h1 className="font-display text-3xl text-fg">{active.otherName}</h1>
        <p className="text-sm text-muted">
          Encrypted on this device, deleted after {DM_RETENTION_DAYS} days.
        </p>
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
              <p className="mt-1 text-xs text-muted">
                {message.from} · <When at={message.at} format={formatWhen} />
              </p>
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
          <button type="submit" className={btnSignal} disabled={busy}>
            Send
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
          No messages yet. Open one from a person you have been to a meeting with.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 lg:max-w-2xl">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-1 rounded-md border border-line bg-surface px-3 py-3 text-left"
                onClick={() => {
                  setActive(thread);
                  setNotice("");
                  void loadThread(thread);
                }}
              >
                <span className="text-base font-semibold text-fg">{thread.otherName}</span>
                <span className="text-sm text-muted">Open to read. Nothing is previewed here.</span>
              </button>
            </li>
          ))}
        </ul>
      )}

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
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveBackup();
          }}
        >
          <input
            className={fieldClass}
            type="password"
            autoComplete="new-password"
            value={passphrase}
            placeholder={vaultForAccount.backup ? "New passphrase" : "Passphrase"}
            aria-label="Backup passphrase"
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <input
            className={fieldClass}
            type="password"
            autoComplete="new-password"
            value={again}
            placeholder="Type it again"
            aria-label="Backup passphrase again"
            onChange={(event) => setAgain(event.target.value)}
          />
          <button type="submit" className={btnGhost} disabled={busy}>
            {vaultForAccount.backup ? "Change the passphrase" : "Save a key backup"}
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
      {notice ? <p className="text-sm text-muted">{notice}</p> : null}
    </div>
  );
}
