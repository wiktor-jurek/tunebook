export function authReturnPath(value: unknown) {
  return typeof value === "string" && /^\/books\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : "/";
}
