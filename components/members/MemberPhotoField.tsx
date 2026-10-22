"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { setMemberPhoto } from "@/app/actions/member-photo";
import { Avatar } from "@/components/ui/display";
import { Button } from "@/components/ui/button";

/** The member's photo with Change and Remove, for managers. It prints on the member's card. */
export function MemberPhotoField({ slug, memberId, name, photoUrl, canManage }: { slug: string; memberId: string; name: string; photoUrl: string | null; canManage: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const send = (form: FormData) =>
    startTransition(async () => {
      setError(null);
      form.set("organisationSlug", slug);
      form.set("memberId", memberId);
      const result = await setMemberPhoto(form);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });

  return (
    <div className="flex flex-col items-center gap-1.5">
      <Avatar name={name} src={photoUrl} size="lg" />
      {canManage ? (
        <>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label={`Photo for ${name}`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.set("file", file);
              send(form);
              event.target.value = "";
            }}
          />
          <span className="flex gap-1">
            <Button size="sm" variant="quiet" loading={pending} onClick={() => input.current?.click()}>
              <Camera aria-hidden className="size-4" />
              {photoUrl ? "Change photo" : "Add photo"}
            </Button>
            {photoUrl ? (
              <Button size="sm" variant="quiet" disabled={pending} onClick={() => { const form = new FormData(); form.set("remove", "1"); send(form); }}>
                Remove
              </Button>
            ) : null}
          </span>
          {error ? <p role="alert" className="max-w-[180px] text-center text-caption text-danger-fg">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
}
