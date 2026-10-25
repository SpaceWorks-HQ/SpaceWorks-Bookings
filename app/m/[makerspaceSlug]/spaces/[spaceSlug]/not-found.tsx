"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";

export default function SpaceNotFound() {
  const { makerspaceSlug } = useParams<{ makerspaceSlug: string }>();
  return <div className="mx-auto max-w-xl px-4 py-12"><Card><h1 className="text-h1">Space not found</h1><p className="my-4">This space is not available to book here.</p>
    <Link href={`/m/${encodeURIComponent(makerspaceSlug)}`} className={buttonClasses({ variant: "primary" })}>View available spaces</Link></Card></div>;
}
