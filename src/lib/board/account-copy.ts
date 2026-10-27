export const DELETE_POST_TITLE = "Delete this post?";
export const DELETE_POST_BODY = "It can't be recovered.";
export const DELETE_POST_CONFIRM = "Delete";
export const DELETE_POST_CANCEL = "Cancel";
export const HELD_POST_ERROR = "This post is held and cannot be deleted.";

/** Design's copy from its review of #90. Needs Josh's OK with the rest of the PR. */
export const DELETION_REQUEST_COPY =
  "An admin reviews your request. When they complete it, your posts are erased and your name is removed from them. Posts under a hold or an open report are kept until that is finished.";
export const completeDeletionTitle = (name: string) => `Erase ${name}'s posts and close the account?`;
export const COMPLETE_DELETION_BODY =
  'Their posts will be erased and show as "Former member". This can\'t be undone. Posts under a legal or child-safety hold, or with an open report, are kept until that is finished.';
export const COMPLETE_DELETION_CONFIRM = "Erase posts and close account";
export const COMPLETE_DELETION_CANCEL = "Cancel";
export const completeDeletionDone = (erased: number, kept: number) =>
  `Done. ${erased} posts erased, ${kept} kept for a hold or open report.`;
