import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../api.js";

// <img> can't send the bearer token, so images are fetched as blobs and shown from memory
export default function AuthImage({ path, alt }) {
  const blob = useQuery({
    queryKey: ["blob", path],
    queryFn: async () => URL.createObjectURL(await (await api(path, { raw: true })).blob()),
    staleTime: Infinity,
    gcTime: 0, // the object URL is revoked on unmount, so the cache entry must go with it
  });
  useEffect(() => () => blob.data && URL.revokeObjectURL(blob.data), [blob.data]);

  if (blob.error) return <small>Image unavailable</small>;
  return blob.data ? <img src={blob.data} alt={alt} style={{ maxHeight: 360, border: "1px solid var(--pico-muted-border-color)" }} /> : <span aria-busy="true" />;
}
