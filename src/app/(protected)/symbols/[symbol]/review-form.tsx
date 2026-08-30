"use client";

import { useActionState } from "react";

import { saveReviewAction } from "@/app/(protected)/symbols/[symbol]/review-actions";

export function ReviewForm({ analysisId }: { analysisId: string }) {
  const [state, action, pending] = useActionState(saveReviewAction, { message: "" });
  return (
    <form action={action} className="review-form">
      <input name="analysisId" type="hidden" value={analysisId} />
      <label><span>Assessment</span><select defaultValue="unclear" name="assessment"><option value="correct">Correct</option><option value="incorrect">Incorrect</option><option value="unclear">Unclear</option></select></label>
      <label><span>Notes</span><input maxLength={500} name="notes" placeholder="Optional review note" /></label>
      <label className="toggle-row compact-toggle"><input name="unsupported" type="checkbox" /><span>Contains unsupported claim</span></label>
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save review"}</button>
      {state.message ? <small>{state.message}</small> : null}
    </form>
  );
}
