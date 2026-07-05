import { TeamRoom } from "@/components/teams/team-room";

export default async function TeamRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeamRoom teamId={id} />;
}
