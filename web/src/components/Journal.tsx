"use client";

// Trade journal: list, add, edit, delete short notes. Used as a per-token
// tab on the trade page and as a full rollup section on the portfolio page.
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Note, truncAddr } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// token: limit to one token (trade page). showToken: render symbol links (portfolio rollup).
export function Journal({ token, showToken = false }: { token?: string; showToken?: boolean }) {
  const { address } = useAuth();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!address) { setNotes(null); return; }
    let alive = true;
    api.notes(token).then((r) => { if (alive) setNotes(r.notes); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [address, token]);

  if (!address) return <div className="px-3 py-6 text-center text-xs text-term-dim">Sign in to keep a trade journal</div>;

  async function add() {
    if (!token || !draft.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createNote({ token, text: draft.trim() });
      setNotes((n) => [r.note, ...(n ?? [])]);
      setDraft("");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function saveEdit(id: number) {
    if (!editText.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.updateNote(id, editText.trim());
      setNotes((n) => (n ?? []).map((x) => (x.id === id ? r.note : x)));
      setEditing(null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function remove(id: number) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteNote(id);
      setNotes((n) => (n ?? []).filter((x) => x.id !== id));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="p-3">
      {token && (
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 500))}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="Write a journal note for this token..."
            maxLength={500}
            className="flex-1 rounded border border-term-border bg-transparent px-2 py-1.5 text-xs text-term-text placeholder:text-term-faint focus:border-term-accent focus:outline-none"
          />
          <button onClick={add} disabled={busy || !draft.trim()} className="btn btn-ghost text-xs disabled:opacity-40">
            Add
          </button>
        </div>
      )}
      {err && <div className="mb-2 text-xs text-term-red">{err}</div>}
      {notes === null ? (
        <div className="py-4 text-center text-xs text-term-dim">Loading journal...</div>
      ) : notes.length === 0 ? (
        <div className="py-4 text-center text-xs text-term-dim">No journal entries yet</div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded border border-term-line px-3 py-2">
              <div className="mb-1 flex items-center gap-2 text-[10px] text-term-dim">
                {showToken && (
                  <Link href={`/t/${n.token}`} className="font-semibold text-term-accent hover:underline">
                    {n.symbol !== "?" ? n.symbol : truncAddr(n.token)}
                  </Link>
                )}
                <span className="num">{timeAgo(n.createdAt)}</span>
                {n.updatedAt !== n.createdAt && <span>(edited)</span>}
                {n.tradeId != null && <span className="rounded border border-term-border px-1 text-term-faint">trade #{n.tradeId}</span>}
                <span className="ml-auto flex gap-2">
                  <button
                    onClick={() => { setEditing(n.id); setEditText(n.text); }}
                    className="text-term-faint hover:text-term-text"
                  >
                    edit
                  </button>
                  <button onClick={() => remove(n.id)} className="text-term-faint hover:text-term-red">
                    delete
                  </button>
                </span>
              </div>
              {editing === n.id ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value.slice(0, 500))}
                    onKeyDown={(e) => { if (e.key === "Enter") saveEdit(n.id); if (e.key === "Escape") setEditing(null); }}
                    maxLength={500}
                    autoFocus
                    className="flex-1 rounded border border-term-border bg-transparent px-2 py-1 text-xs text-term-text focus:border-term-accent focus:outline-none"
                  />
                  <button onClick={() => saveEdit(n.id)} disabled={busy} className="text-xs text-term-accent hover:underline">save</button>
                  <button onClick={() => setEditing(null)} className="text-xs text-term-dim hover:underline">cancel</button>
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words text-xs text-term-text">{n.text}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
