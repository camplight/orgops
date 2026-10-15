export function formatTime(value?: number) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return new Intl.DateTimeFormat(undefined, {
    ...(isToday
      ? {}
      : {
          day: "numeric",
          month: "short",
          ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" })
        }),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}
