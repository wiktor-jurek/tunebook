import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";

export function PublicHeader({ next = "/" }: { next?: string }) {
  const query = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return <header className="public-header"><Link href="/" className="brand"><BrandMark />Tune Companion</Link>
    <nav className="public-nav"><Link href="/tunes/finder">Tune finder</Link><Link href={`/sign-in${query}`}>Log in</Link><Button asChild size="sm"><Link href={`/sign-up${query}`}>Sign up free</Link></Button></nav>
  </header>;
}
