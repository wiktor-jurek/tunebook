"use client";

import { trackEvent } from "@/lib/analytics";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
export function PrintButton() { return <Button variant="ghost" size="icon" className="print-button" aria-label="Print" title="Print" onClick={() => { trackEvent("print_requested", {}); window.print(); }}><Printer size={16} /></Button>; }
