import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchCatalog } from "@/lib/library";
import { importSetting } from "@/app/actions";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const results = await searchCatalog(q);
  return <div className="page-wrap"><header className="page-head"><div><p className="eyebrow">THE SESSION CATALOG</p><h1>Import a tune</h1><p className="page-subtitle">Search by title or paste a The Session tune URL. Choose the setting you want to save.</p></div></header>
    <form className="search-form" method="get"><Search size={18} /><Input name="q" defaultValue={q} placeholder="Tune title or https://thesession.org/tunes/…" aria-label="Search tunes" /><Button>Search</Button></form>
    {q && <><div className="results-heading"><h2>{results.length ? `${results.length} settings` : "No settings found"}</h2><span>Source: <Link href="https://github.com/adactio/TheSession-data" target="_blank">The Session open data</Link></span></div><div className="tune-list">{results.map((setting) => <article className="tune-list-row" key={setting.settingId}><div className="tune-list-main"><a href={setting.sourceUrl} target="_blank" rel="noreferrer" className="tune-list-title">{setting.title}</a><span className="tune-list-meta">{[setting.kind, setting.mode, setting.meter, `Setting #${setting.settingId}`, setting.contributor && `by ${setting.contributor}`].filter(Boolean).join(" · ")}</span></div><form action={importSetting}><input type="hidden" name="settingId" value={setting.settingId} /><Button size="sm">Save setting</Button></form></article>)}</div></>}
    {!q && <p className="hint-panel">The catalog is loaded by the deployment’s sync command. Each setting is saved as a personal, read-only snapshot.</p>}
  </div>;
}
