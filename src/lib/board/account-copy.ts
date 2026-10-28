export const DELETE_POST_TITLE = "Delete this post?";
export const DELETE_POST_BODY = "It can't be recovered.";
export const DELETE_POST_CONFIRM = "Delete";
export const DELETE_POST_CANCEL = "Cancel";
export const HELD_POST_ERROR = "This post is held and cannot be deleted.";

/** Design's copy from its review of #90. Needs Josh's OK with the rest of the PR. */
export const DELETION_REQUEST_COPY =
  "An admin reviews your request. When they complete it, the words, photos and videos in your posts are erased, and each post shows only \"Erased.\" from \"Former member\". Posts under a hold, an open report, or a pending appeal are kept, with their files, until that is finished.";
export const completeDeletionTitle = (name: string) => `Erase ${name}'s posts and close the account?`;
export const COMPLETE_DELETION_BODY =
  'Their posts are erased: each one shows only "Erased." from "Former member", and their photos and videos are deleted. This can\'t be undone. Posts under a legal or child-safety hold, an open report, or a pending appeal are kept, with their files, until that is finished.';
export const COMPLETE_DELETION_CONFIRM = "Erase posts and close account";
export const COMPLETE_DELETION_CANCEL = "Cancel";
export const completeDeletionDone = (erased: number, kept: number) =>
  `Done. ${erased} ${erased === 1 ? "post" : "posts"} erased. ${kept} kept for a hold, report, or appeal.`;
