import { redirect } from "next/navigation";

// Sets live in the tunebook of the session they are played at, so there is no list of them on their own.
export default function Sets() {
  redirect("/");
}
