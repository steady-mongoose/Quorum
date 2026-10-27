import { useState } from "react";
import { ConfirmDialog } from "@/components/board/confirm-dialog";
import { btnQuiet } from "@/components/quorum/bits";
import {
  DELETE_POST_BODY,
  DELETE_POST_CANCEL,
  DELETE_POST_CONFIRM,
  DELETE_POST_TITLE,
  HELD_POST_ERROR,
} from "@/lib/board/account-copy";
import { deleteOwnPost } from "@/lib/board/account-api";
import { useBoard } from "@/lib/board/store";

export function DeletePostControl({
  held,
  onDelete,
}: {
  held: boolean;
  onDelete: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button type="button" className={btnQuiet} onClick={() => setOpen(true)}>
        Delete
      </button>
      {error ? (
        <p role="alert" className="self-center text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={open}
        title={DELETE_POST_TITLE}
        description={DELETE_POST_BODY}
        confirmLabel={DELETE_POST_CONFIRM}
        cancelLabel={DELETE_POST_CANCEL}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          if (held) {
            setOpen(false);
            setError(HELD_POST_ERROR);
            return;
          }
          void onDelete().then((result) => {
            setOpen(false);
            if (!result.ok) setError(result.error || HELD_POST_ERROR);
            else setError("");
          });
        }}
      />
    </>
  );
}

/** Drops the author's own post. A local board checks a CSAM removal first. */
export async function dropOwnPost(
  id: string,
  remote: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (remote) {
    const result = await deleteOwnPost(id);
    if (!result.ok) return result;
  }
  useBoard.setState((state) => ({
    posts: state.posts.filter((item) => item.id !== id),
  }));
  return { ok: true };
}
