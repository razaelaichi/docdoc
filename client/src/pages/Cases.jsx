import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "../lib/api.js";
import ErrorMessage from "../components/ErrorMessage.jsx";
import { ChevronIcon, PlusIcon } from "../components/Icons.jsx";
import Spinner from "../components/Spinner.jsx";
import { fieldProps } from "../lib/fieldProps.js";
import { useFlag } from "../lib/flags.js";
import { formatDateTime, initials, plural } from "../lib/format.js";
import { prefetchCase } from "../lib/prefetch.js";
import { reportWorkflow } from "../lib/telemetry.js";
import { usePageTitle } from "../lib/usePageTitle.js";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// Ctrl/Cmd+K focuses search. A modifier chord, not a single key, so it can't fire while typing (WCAG 2.1.4).
function useSearchShortcut(inputRef, enabled) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inputRef, enabled]);
}

export default function Cases() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const search = params.get("search") ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // one key per form lifetime: a double-click or retry can't create two cases
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const searchRef = useRef(null);
  const shortcuts = useFlag("keyboard-shortcuts");
  const prefetch = useFlag("intent-prefetch");
  useSearchShortcut(searchRef, shortcuts);
  usePageTitle(search ? `Cases matching “${search}”` : "Cases");

  const cases = useQuery({
    queryKey: ["cases", { page, search }],
    queryFn: ({ signal }) => api(`/cases?${new URLSearchParams({ page, ...(search && { search }) })}`, { signal }),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: (patientName) =>
      api("/cases", { method: "POST", json: { patientName }, headers: { "Idempotency-Key": idempotencyKey } }),
    onError: () => reportWorkflow("create-case", "failure"),
    onSuccess: (created) => {
      reportWorkflow("create-case", "success");
      setIdempotencyKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      navigate(`/cases/${created.id}`);
    },
  });

  const data = cases.data;
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="title">Cases</h1>
          <p className="meta">{data ? (search ? `${plural(data.total, "match", "matches")} for “${search}”` : plural(data.total, "patient")) : " "}</p>
        </div>
        <form
          className="inline-form create-case"
          onSubmit={(e) => (e.preventDefault(), create.mutate(new FormData(e.currentTarget).get("patientName")))}
        >
          <input name="patientName" aria-label="Patient name" placeholder="New case: patient name" required maxLength={200} {...fieldProps(create.error, "patientName", "create-error")} />
          <button className="btn-primary" aria-busy={create.isPending} disabled={create.isPending}>
            {!create.isPending && <PlusIcon />}
            Create case
          </button>
        </form>
      </div>
      {create.error && (
        <div style={{ marginBottom: 20 }}>
          <ErrorMessage error={create.error} id="create-error" />
        </div>
      )}

      <section className="panel">
        <div className="cases-toolbar">
          <form role="search" onSubmit={(e) => (e.preventDefault(), setParams({ search: new FormData(e.currentTarget).get("search") }))}>
            <input
              ref={searchRef}
              type="search"
              name="search"
              aria-label="Search by patient name"
              aria-keyshortcuts={shortcuts ? (isMac ? "Meta+K" : "Control+K") : undefined}
              placeholder="Search by patient name"
              defaultValue={search}
              maxLength={100}
            />
          </form>
          {shortcuts && (
            <span className="kbd-hint" aria-hidden="true">
              <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
              <kbd>K</kbd>
            </span>
          )}
        </div>
        {cases.error && (
          <div className="panel-body">
            <ErrorMessage error={cases.error} />
          </div>
        )}
        {cases.isPending && (
          <div className="empty">
            <Spinner />
          </div>
        )}
        {data && data.total === 0 && (
          <div className="empty">
            {search ? (
              <>
                <strong>No patients match “{search}”</strong>
                <button className="btn-link" onClick={() => setParams({})}>
                  Clear search
                </button>
              </>
            ) : (
              <>
                <strong>No cases yet</strong>
                Create a case with the patient’s name, then send them an upload link from the case page.
              </>
            )}
          </div>
        )}
        {data?.items.length > 0 && (
          <div className="table-wrap">
            <table className="table-hover">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Opened</th>
                  <th className="chevron-cell">
                    <span className="visually-hidden">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="row-click">
                    <td>
                      <span className="patient-cell">
                        <span className="initials" aria-hidden="true">
                          {initials(c.patientName)}
                        </span>
                        <Link
                          className="row-link"
                          to={`/cases/${c.id}`}
                          onMouseEnter={prefetch ? () => prefetchCase(queryClient, c.id) : undefined}
                          onFocus={prefetch ? () => prefetchCase(queryClient, c.id) : undefined}
                        >
                          {c.patientName}
                        </Link>
                      </span>
                    </td>
                    <td className="muted nowrap" style={{ verticalAlign: "middle" }}>
                      {formatDateTime(c.createdAt)}
                    </td>
                    <td className="chevron-cell" style={{ verticalAlign: "middle" }}>
                      <ChevronIcon />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.totalPages > 1 && (
          <div className="panel-foot">
            <span>
              Page {page} of {data.totalPages}
            </span>
            <div className="pager">
              <button className="btn-sm" disabled={page <= 1} onClick={() => setParams({ search, page: page - 1 })}>
                Previous
              </button>
              <button className="btn-sm" disabled={page >= data.totalPages} onClick={() => setParams({ search, page: page + 1 })}>
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
