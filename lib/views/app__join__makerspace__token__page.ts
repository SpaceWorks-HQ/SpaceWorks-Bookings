import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function loadJoinMakerspaceView({ params }: { params: Promise<{ token: string; }>; }) {

  const { token } = await params;
  const session = await auth();
  const joinUrl = `/join/makerspace/${encodeURIComponent(token)}`;
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(joinUrl)}`);
  const invite = await prisma.teamInvite.findUnique({
    where: { token },
    select: { usedAt: true, expiresAt: true, role: true, makerspace: { select: { name: true, logoUrl: true } } },
  });

  return { token, session, invite };
}
