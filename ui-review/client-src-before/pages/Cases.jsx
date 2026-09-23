import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "../api.js";
import ErrorMessage from "../components/ErrorMessage.jsx";

export default function Cases() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") ?? 1);
  const search = params.get("search") ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // one key per form lifetime: a double-click or retry can't create two cases
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const cases = useQuery({
    queryKey: ["cases", { page, search }],
    queryFn: () => api(`/cases?${new URLSearchParams({ page, ...(search && { search }) })}`),
    placeholderData: keepPreviousData,
  });

  const create = useMutation({
    mutationFn: (patientName) =>
      api("/cases", { method: "POST", json: { patientName }, headers: { "Idempotency-Key": idempotencyKey } }),
    onSuccess: (created) => {
      setIdempotencyKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      navigate(`/cases/${created.id}`);
    },
  });

  const data = cases.data;
  return (
    <>
      <h2>Cases</h2>
      <form onSubmit={(e) => (e.preventDefault(), create.mutate(new FormData(e.currentTarget).get("patientName")))}>
        <fieldset role="group">
          <input name="patientName" placeholder="New case: patient name" required maxLength={200} />
          <button aria-busy={create.isPending} disabled={create.isPending}>
            Create case
          </button>
        </fieldset>
        <ErrorMessage error={create.error} />
      </form>

      <form onSubmit={(e) => (e.preventDefault(), setParams({ search: new FormData(e.currentTarget).get("search") }))}>
        <input type="search" name="search" placeholder="Search by patient name" defaultValue={search} maxLength={100} />
      </form>

      <ErrorMessage error={cases.error} />
      {data && (
        <>
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/cases/${c.id}`}>{c.patientName}</Link>
                  </td>
                  <td>{new Date(c.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.total === 0 && <p>No cases yet.</p>}
          {data.totalPages > 1 && (
            <div role="group">
              <button className="outline" disabled={page <= 1} onClick={() => setParams({ search, page: page - 1 })}>
                Previous
              </button>
              <button className="outline" disabled={page >= data.totalPages} onClick={() => setParams({ search, page: page + 1 })}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
