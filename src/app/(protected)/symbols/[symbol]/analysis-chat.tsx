"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useRef, useState } from "react";

type ChatTurn = { id: string; requestId: string; question: string; answer: string | null; status: "pending" | "completed" | "failed"; error: string | null; createdAt: string; completedAt: string | null };
type ChatState = { analysisId: string; conversationId: string; contextExchangeLimit: number; turns: ChatTurn[] };

export function AnalysisChat({ analysisId, capturedAt }: { analysisId: string; capturedAt: string }) {
  const [state, setState] = useState<ChatState | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRequestId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/analyses/${analysisId}/chat`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as ChatState & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Chat could not be loaded.");
      if (!cancelled) setState(payload);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Chat could not be loaded."); });
    return () => { cancelled = true; };
  }, [analysisId]);

  async function send() {
    if (!question.trim() || pending) return;
    setPending(true); setError("");
    pendingRequestId.current ??= crypto.randomUUID();
    const requestId = pendingRequestId.current;
    await Sentry.startNewTrace(() => Sentry.startSpan({
      name: "Submit analysis chat question",
      op: "specialstock.analysis.chat.request",
      forceTransaction: true,
      attributes: {
        "specialstock.telemetry.origin": "client",
        "specialstock.analysis.id": analysisId,
        "specialstock.chat.request_id": requestId,
        "specialstock.chat.question_length": question.trim().length,
      },
    }, async (span) => {
      Sentry.logger.info("chat.client.requested", {
        "specialstock.telemetry.origin": "client",
        "specialstock.analysis.id": analysisId,
        "specialstock.chat.request_id": requestId,
        "specialstock.chat.question_length": question.trim().length,
      });
      try {
        const response = await fetch(`/api/analyses/${analysisId}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, question }) });
        const payload = await response.json() as ChatTurn & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Gemini could not answer the question.");
        setState((current) => current ? { ...current, turns: [...current.turns, payload] } : current);
        setQuestion("");
        pendingRequestId.current = null;
        span.setAttributes({ "specialstock.chat.turn_id": payload.id, "specialstock.chat.status": payload.status });
        span.setStatus({ code: 1 });
        Sentry.logger.info("chat.client.completed", {
          "specialstock.telemetry.origin": "client",
          "specialstock.analysis.id": analysisId,
          "specialstock.chat.request_id": requestId,
          "specialstock.chat.turn_id": payload.id,
          "specialstock.chat.status": payload.status,
        });
      } catch (reason) {
        span.setAttribute("error.type", reason instanceof Error ? reason.constructor.name : "UnknownError");
        span.setStatus({ code: 2, message: "chat_request_failed" });
        Sentry.logger.warn("chat.client.failed", {
          "specialstock.telemetry.origin": "client",
          "specialstock.analysis.id": analysisId,
          "specialstock.chat.request_id": requestId,
          "error.type": reason instanceof Error ? reason.constructor.name : "UnknownError",
        });
        setError(reason instanceof Error ? reason.message : "Gemini could not answer the question.");
      }
    }));
    setPending(false);
  }

  async function retry(turnId: string) {
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/analyses/${analysisId}/chat/turns/${turnId}/retry`, { method: "POST" });
      const payload = await response.json() as ChatTurn & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Chat retry failed.");
      setState((current) => current ? { ...current, turns: current.turns.map((turn) => turn.id === turnId ? payload : turn) } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Chat retry failed."); }
    finally { setPending(false); }
  }

  async function reset() {
    if (!window.confirm("Clear the visible chat and start a new conversation? The prior audit record will be retained until this analysis expires.")) return;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/analyses/${analysisId}/chat/reset`, { method: "POST" });
      const payload = await response.json() as ChatState & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Chat reset failed.");
      setState(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Chat reset failed."); }
    finally { setPending(false); }
  }

  const chooseStarter = (value: string) => {
    pendingRequestId.current = null;
    setQuestion(value);
  };

  return <section className="analysis-chat" aria-labelledby="analysis-chat-heading">
    <div className="section-heading"><div><p className="eyebrow">Gemini · grounded to this run</p><h2 id="analysis-chat-heading">Ask AI</h2></div>{state?.turns.length ? <button className="secondary-button compact" disabled={pending} onClick={() => void reset()} type="button">Clear chat</button> : null}</div>
    <p className="chat-grounding">Answers use only this stored analysis and the frozen chart captured {new Date(capturedAt).toLocaleString()}. Current prices and news are unavailable.</p>
    {!state?.turns.length ? <div className="chat-empty"><p>Explore the reasoning behind this snapshot.</p><div className="chat-starters"><button disabled={pending} onClick={() => chooseStarter("What is the strongest evidence supporting this setup?")} type="button">Strongest evidence</button><button disabled={pending} onClick={() => chooseStarter("What would invalidate this setup first?")} type="button">Invalidation risk</button><button disabled={pending} onClick={() => chooseStarter("Where does the evidence conflict?")} type="button">Conflicting evidence</button></div></div> : null}
    <label className="chat-composer"><span className="sr-only">Question about this analysis</span><textarea data-sentry-mask disabled={pending} maxLength={2000} onChange={(event) => { pendingRequestId.current = null; setQuestion(event.target.value); }} placeholder="Ask about the visible setup, conflicting evidence, or invalidation…" rows={3} value={question} /></label>
    <div className="chat-actions"><span className="muted">{question.length.toLocaleString()} / 2,000</span><button className="primary-button" disabled={pending || !question.trim() || !state} onClick={() => void send()} type="button">{pending ? "Asking Gemini…" : "Ask AI"}</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {state?.turns.length ? <div className="chat-transcript" aria-label="Conversation history" aria-live="polite" data-sentry-mask>{state.turns.map((turn) => <article className="chat-turn" key={turn.id}><div className="chat-question"><strong>You</strong><p>{turn.question}</p></div><div className="chat-answer"><strong>Gemini</strong>{turn.status === "completed" ? <p>{turn.answer}</p> : turn.status === "pending" ? <p className="muted">Gemini is answering…</p> : <div className="warning-banner"><span>{turn.error ?? "The answer failed."}</span><button className="secondary-button compact" disabled={pending} onClick={() => void retry(turn.id)} type="button">Retry</button></div>}</div></article>)}</div> : null}
  </section>;
}
