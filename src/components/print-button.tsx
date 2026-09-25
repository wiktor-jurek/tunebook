"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
export function PrintButton() { return <Button variant="outline" className="print-button" onClick={() => window.print()}><Printer size={15} /> Print</Button>; }
