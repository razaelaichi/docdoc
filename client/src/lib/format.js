const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export const formatDateTime = (value) => dateTime.format(new Date(value));
export const formatDate = (value) => date.format(new Date(value));

// "Arjun Malhotra" -> "AM"
export const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
