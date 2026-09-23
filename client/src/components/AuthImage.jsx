import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api.js";
import Spinner from "./Spinner.jsx";

// <img> can't send the bearer token, so images are fetched as blobs and shown from memory
export default function AuthImage({ path, alt }) {
  const blob = useQuery({
    queryKey: ["blob", path],
    queryFn: async ({ signal }) => URL.createObjectURL(await (await api(path, { raw: true, signal })).blob()),
    staleTime: Infinity,
    gcTime: 0, // the object URL is revoked on unmount, so the cache entry must go with it
  });
  useEffect(() => () => blob.data && URL.revokeObjectURL(blob.data), [blob.data]);

  if (blob.error) return <div className="image-missing">Image unavailable</div>;
  if (!blob.data)
    return (
      <div className="image-missing">
        <Spinner />
      </div>
    );
  return <img src={blob.data} alt={alt} width={220} height={200} decoding="async" />;
}
