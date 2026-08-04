import { CinemaExperience } from "../../CinemaExperience";
import { auditoriums, getAuditoriumById } from "../../cinema-data";
import { inventoryHalls } from "../../cinema-inventory";

export function generateStaticParams() {
  const customIds = auditoriums.map((aud) => ({ auditoriumId: aud.id }));
  const inventoryIds = inventoryHalls.map((hall) => ({ auditoriumId: hall.id }));
  return [...customIds, ...inventoryIds];
}

export default async function CinemaPage({
  params,
}: {
  params: Promise<{ auditoriumId: string }>;
}) {
  const { auditoriumId } = await params;
  const auditorium = getAuditoriumById(auditoriumId) || auditoriums[0];

  return <CinemaExperience initialAuditoriumId={auditorium.id} />;
}
